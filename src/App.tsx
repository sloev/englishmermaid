import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  Copy,
  Download,
  FileDown,
  FolderOpen,
  Image,
  Link,
  MonitorDown,
  Save,
  LayoutTemplate,
  Maximize,
  Minus,
  PenLine,
  Plus,
  RotateCcw,
  Route,
  Workflow,
  X,
} from "lucide-react";
import {
  BLANK,
  classifyLine,
  EXAMPLES,
  parse,
  STARTER,
  toMermaid,
  type Token,
  type ViewKind,
} from "./lib/plainpath";
import { plainLabels, renderLatest, renderMermaid } from "./lib/mermaid";
import {
  download,
  EXTENSION,
  fileName,
  onLaunchFile,
  openText,
  readShareHash,
  saveText,
  shareUrl,
  svgToPng,
  type FileHandle,
} from "./lib/files";
import { usePanZoom } from "./lib/use-pan-zoom";

const STORAGE_KEY = "plainpath-script";
const VIEW_KEY = "plainpath-view";
const SAVED_KEY = "plainpath-saved";
const RENDER_DELAY = 300;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function forget(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or full */
  }
}

export function App() {
  const [source, setSource] = useState(() => stored(STORAGE_KEY) ?? STARTER);
  const [viewKind, setViewKind] = useState<ViewKind>(() =>
    stored(VIEW_KEY) === "flow" ? "flow" : "story",
  );
  const [svg, setSvg] = useState("");
  const [mapNote, setMapNote] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [handle, setHandle] = useState<FileHandle | null>(null);
  // The script as last saved to (or opened from) a file; null if it never was.
  const [saved, setSaved] = useState<string | null>(() => stored(SAVED_KEY));
  const [menuOpen, setMenuOpen] = useState(false);
  const [install, setInstall] = useState<{ prompt(): Promise<void> } | null>(null);
  const [undoSource, setUndoSource] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pendingCursor = useRef<number | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const map = usePanZoom(stageRef, layerRef, hostRef);

  const journey = useMemo(() => parse(source), [source]);
  const mermaid = useMemo(() => toMermaid(journey, viewKind), [journey, viewKind]);
  const badLines = useMemo(() => new Set(journey.issues.map((issue) => issue.line)), [journey]);
  const screenCount = journey.blocks.filter((block) => block.kind === "screen").length;
  const ghostCount = journey.blocks.filter((block) => block.kind === "ghost").length;

  useEffect(() => store(STORAGE_KEY, source), [source]);
  useEffect(() => (saved == null ? forget(SAVED_KEY) : store(SAVED_KEY, saved)), [saved]);

  // Share links (#text= / #s=) and files opened from the OS replace the script.
  useEffect(() => {
    const fromHash = () =>
      readShareHash(location.hash).then(({ text, view }) => {
        if (view === "flow" || view === "story") setViewKind(view);
        if (text == null) return;
        setSource((current) => {
          if (current !== text) setUndoSource(current);
          return text;
        });
        setHandle(null);
        setSaved(null);
        history.replaceState(null, "", location.pathname + location.search);
      });
    fromHash();
    window.addEventListener("hashchange", fromHash);
    onLaunchFile((text, launched) => {
      setSource(text);
      setHandle(launched);
      setSaved(text);
    });
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as unknown as { prompt(): Promise<void> });
    };
    window.addEventListener("beforeinstallprompt", onInstall);
    return () => {
      window.removeEventListener("hashchange", fromHash);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);
  useEffect(() => store(VIEW_KEY, viewKind), [viewKind]);

  useEffect(() => {
    if (pendingCursor.current == null) return;
    const cursor = pendingCursor.current;
    pendingCursor.current = null;
    areaRef.current?.focus();
    areaRef.current?.setSelectionRange(cursor, cursor);
  }, [source]);

  useEffect(() => {
    if (!mermaid) {
      setSvg("");
      setMapNote(null);
      return;
    }
    let cancel = false;
    // Redraw once typing pauses; Mermaid layout is the expensive part on big charts.
    const timer = window.setTimeout(() => {
      renderLatest(mermaid)
        .then((drawn) => {
          if (cancel || drawn == null) return;
          setSvg(drawn);
          setMapNote(null);
        })
        .catch(() => {
          if (!cancel) setMapNote("The map could not be drawn from these lines yet.");
        });
    }, RENDER_DELAY);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [mermaid]);

  const { refresh } = map;
  useEffect(() => {
    if (svg) refresh();
  }, [svg, refresh]);

  // Cmd/Ctrl+E toggles from anywhere; Escape leaves the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "e") {
        event.preventDefault();
        setEditorOpen((open) => !open);
      } else if (mod && key === "s") {
        event.preventDefault();
        actions.current.save(event.shiftKey);
      } else if (mod && key === "o") {
        event.preventDefault();
        actions.current.open();
      } else if (event.key === "Escape" && editorOpen) {
        if (helpOpen) setHelpOpen(false);
        else if (menuOpen) setMenuOpen(false);
        else setEditorOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, helpOpen, menuOpen]);

  useEffect(() => {
    if (editorOpen) areaRef.current?.focus({ preventScroll: true });
    else stageRef.current?.focus({ preventScroll: true });
  }, [editorOpen]);

  function loadSource(next: string) {
    setUndoSource(source);
    map.resetFit();
    pendingCursor.current = next.length;
    setSource(next);
  }

  function selectLine(line: number) {
    const area = areaRef.current;
    if (!area) return;
    const parts = source.split("\n");
    const start = parts.slice(0, line - 1).reduce((sum, part) => sum + part.length + 1, 0);
    area.focus();
    area.setSelectionRange(start, start + (parts[line - 1]?.length ?? 0));
  }

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2200);
  }

  async function run(task: () => Promise<unknown>) {
    try {
      await task();
    } catch {
      flash("That did not work in this browser");
    }
  }

  const base = fileName(journey.title);

  async function save(asNew = false) {
    const target = await saveText(source, base, asNew ? null : handle);
    if (target === undefined) return;
    setHandle(target);
    setSaved(source);
    flash(target ? `Saved ${target.name}` : `Downloaded ${base}${EXTENSION}`);
  }

  function startNew() {
    loadSource(BLANK);
    setHandle(null);
    setSaved(null);
  }

  function loadExample(next: string) {
    loadSource(next);
    setHandle(null);
    setSaved(null);
    setHelpOpen(false);
  }

  async function open() {
    const opened = await openText();
    if (!opened) return;
    loadSource(opened.text);
    setHandle(opened.handle);
    setSaved(opened.text);
    setMenuOpen(false);
  }

  async function exportImage(kind: "svg" | "png") {
    if (!mermaid) return;
    // HTML labels can't be rasterised, so exports use plain SVG text labels.
    const drawn = await renderMermaid(plainLabels(mermaid));
    if (kind === "svg") download(`${base}.svg`, drawn, "image/svg+xml");
    else download(`${base}.png`, await svgToPng(drawn));
  }

  async function copy(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    flash(message);
  }

  // Latest save/open for the global keyboard shortcuts.
  const actions = useRef({ save: (_asNew: boolean) => {}, open: () => {} });
  actions.current = { save: (asNew) => run(() => save(asNew)), open: () => run(open) };
  const dirty = saved !== source;

  function switchView(next: ViewKind) {
    map.resetFit();
    setViewKind(next);
  }

  const chip =
    "tap inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium";
  const plainChip = `${chip} border-border bg-surface/80 text-fg`;

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-fg">
      {/* Background: the live map. Gets all pointer input while the editor is hidden. */}
      <div
        ref={stageRef}
        tabIndex={-1}
        role="application"
        aria-label={journey.title ? `${journey.title} map` : "Map"}
        className="map-stage map-canvas absolute inset-0 outline-none"
        {...map.handlers}
      >
        <MapLayer svg={svg} layerRef={layerRef} hostRef={hostRef} />
        {!svg ? (
          <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-pretty text-muted">
            Write a Screen: in the editor and the map draws itself here.
          </p>
        ) : null}
      </div>

      {/* Foreground: translucent editor. Inert while hidden so it can't steal input. */}
      <div
        className={`editor-layer absolute inset-0 overflow-y-auto ${editorOpen ? "is-open" : ""}`}
        inert={!editorOpen}
        aria-hidden={!editorOpen}
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-3 px-4 pt-4 pb-28 lg:pt-8">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-card bg-accent text-accent-ink">
                <Route aria-hidden="true" className="size-5" strokeWidth={2.25} />
              </span>
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Plainpath</h1>
                <p className="text-xs tabular-nums text-muted">
                  {journey.title ? <span className="text-fg">{journey.title}</span> : "Untitled"}
                  {` · ${screenCount} ${screenCount === 1 ? "screen" : "screens"}`}
                  {ghostCount > 0 ? ` · ${ghostCount} not written yet` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={startNew} className={plainChip}>
                <Plus aria-hidden="true" className="size-4" />
                New
              </button>
              {undoSource != null ? (
                <button
                  type="button"
                  onClick={() => {
                    setSource(undoSource);
                    setUndoSource(null);
                  }}
                  className={plainChip}
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                  Undo
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => run(() => save())}
                disabled={!dirty}
                title="Ctrl+S"
                className={
                  dirty
                    ? `${chip} border-accent bg-accent text-accent-ink`
                    : `${plainChip} disabled:opacity-60`
                }
              >
                {dirty ? (
                  <Save aria-hidden="true" className="size-4" />
                ) : (
                  <Check aria-hidden="true" className="size-4" />
                )}
                {dirty ? "Save" : "Saved"}
              </button>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                className={menuOpen ? `${chip} border-accent text-accent` : plainChip}
              >
                <FolderOpen aria-hidden="true" className="size-4" />
                File
              </button>
              <button
                type="button"
                onClick={() => setHelpOpen((open) => !open)}
                aria-expanded={helpOpen}
                className={helpOpen ? `${chip} border-accent text-accent` : plainChip}
              >
                <BookOpen aria-hidden="true" className="size-4" />
                How to
              </button>
            </div>
          </header>

          {menuOpen ? (
            <section
              aria-label="File"
              className="rounded-card border border-border bg-surface/90 p-3 text-sm"
            >
              <p className="px-1 pb-3 text-xs text-muted">
                {handle
                  ? `${dirty ? "Unsaved changes to" : "Saved to"} ${handle.name}.`
                  : "Kept in this browser automatically. Save to a file to keep it anywhere."}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <MenuButton
                  icon={FolderOpen}
                  label="Open…"
                  hint="Ctrl+O"
                  onClick={() => run(open)}
                />
                <MenuButton
                  icon={Download}
                  label="Save as…"
                  hint="⇧Ctrl+S"
                  onClick={() => run(() => save(true))}
                />
                <MenuButton
                  icon={FileDown}
                  label="Export SVG"
                  disabled={!mermaid}
                  onClick={() => run(() => exportImage("svg"))}
                />
                <MenuButton
                  icon={Image}
                  label="Export PNG"
                  disabled={!mermaid}
                  onClick={() => run(() => exportImage("png"))}
                />
                <MenuButton
                  icon={FileDown}
                  label="Export Mermaid"
                  hint=".mmd"
                  disabled={!mermaid}
                  onClick={() => download(`${base}.mmd`, mermaid)}
                />
                <MenuButton
                  icon={Copy}
                  label="Copy Mermaid"
                  disabled={!mermaid}
                  onClick={() => run(() => copy(mermaid, "Mermaid code copied"))}
                />
                <MenuButton
                  icon={Link}
                  label="Copy share link"
                  onClick={() =>
                    run(async () => copy(await shareUrl(source, viewKind), "Link copied"))
                  }
                />
                {install ? (
                  <MenuButton
                    icon={MonitorDown}
                    label="Install app"
                    onClick={() =>
                      run(async () => {
                        await install.prompt();
                        setInstall(null);
                      })
                    }
                  />
                ) : null}
              </div>
            </section>
          ) : null}

          {helpOpen ? <HowTo onClose={() => setHelpOpen(false)} onExample={loadExample} /> : null}

          <div className="editor-stack script-text rounded-card" translate="no">
            <div className="editor-lines" aria-hidden="true">
              {journey.lines.map((line, index) => (
                <EditorRow
                  key={index}
                  number={index + 1}
                  tokens={line.tokens}
                  signature={signature(line.tokens)}
                  bad={badLines.has(index + 1)}
                />
              ))}
            </div>
            <label className="sr-only" htmlFor="script">
              Script
            </label>
            <textarea
              ref={areaRef}
              id="script"
              className="editor-input script-text"
              value={source}
              spellCheck={false}
              autoCapitalize="sentences"
              autoCorrect="off"
              autoComplete="off"
              wrap="soft"
              aria-describedby="script-issues"
              onKeyDown={(event) => onEditorKey(event, setSource, pendingCursor)}
              onChange={(event) => {
                setUndoSource(null);
                setSource(event.target.value);
              }}
            />
          </div>

          <div id="script-issues" role="status" aria-live="polite" className="flex flex-col gap-2">
            {journey.issues.map((issue) => (
              <button
                key={`${issue.line}-${issue.message}`}
                type="button"
                onClick={() => selectLine(issue.line)}
                className="tap flex min-h-10 items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft/90 px-3 py-2 text-left text-sm text-fg"
              >
                <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
                <span>
                  <span className="text-muted tabular-nums">Line {issue.line}: </span>
                  {issue.message}
                </span>
              </button>
            ))}
            {mapNote ? <p className="text-sm text-danger">{mapNote}</p> : null}
          </div>
        </div>
      </div>

      {!editorOpen ? (
        <>
          <div className="absolute top-4 right-4 z-30">
            <ViewSwitch value={viewKind} onChange={switchView} />
          </div>
          <div className="absolute right-4 bottom-4 z-30 flex flex-col overflow-hidden rounded-full border border-border bg-surface/90 backdrop-blur">
            <MapButton label="Zoom in" onClick={() => map.zoom(1.25)} icon={Plus} />
            <MapButton label="Zoom out" onClick={() => map.zoom(0.8)} icon={Minus} />
            <MapButton label="Fit map to screen" onClick={map.fit} icon={Maximize} />
          </div>
        </>
      ) : null}

      <button
        type="button"
        onClick={() => setEditorOpen((open) => !open)}
        aria-pressed={editorOpen}
        aria-label={editorOpen ? "Hide editor and explore the map" : "Show editor"}
        title={editorOpen ? "Explore map (Esc / Ctrl+E)" : "Edit (Ctrl+E)"}
        className={`tap absolute bottom-4 left-4 z-40 grid size-14 place-items-center rounded-full shadow-lg ${
          editorOpen ? "bg-surface-2 text-fg ring-1 ring-border" : "bg-accent text-accent-ink"
        }`}
      >
        {editorOpen ? (
          <X aria-hidden="true" className="size-6" />
        ) : (
          <PenLine aria-hidden="true" className="size-6" />
        )}
        {!editorOpen && journey.issues.length > 0 ? (
          <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-xs font-semibold text-bg tabular-nums">
            {journey.issues.length}
          </span>
        ) : null}
      </button>
      {toast ? (
        <p
          role="status"
          className="absolute bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-border bg-surface-2 px-4 py-2 text-sm shadow-lg"
        >
          {toast}
        </p>
      ) : null}
    </main>
  );
}

// The chart only re-renders when its SVG changes; panning moves the layer directly.
const MapLayer = memo(function MapLayer({
  svg,
  layerRef,
  hostRef,
}: {
  svg: string;
  layerRef: React.RefObject<HTMLDivElement | null>;
  hostRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div ref={layerRef} className="map-layer">
      {svg ? (
        <div ref={hostRef} className="mermaid-host" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : null}
    </div>
  );
});

const signature = (tokens: Token[]) => tokens.map((t) => `${t.kind}\u0001${t.text}`).join("\u0002");

// One highlighted line. Only rows whose text or colouring changed re-render while typing.
const EditorRow = memo(
  function EditorRow({
    number,
    tokens,
    bad,
  }: {
    number: number;
    tokens: Token[];
    signature: string;
    bad: boolean;
  }) {
    return (
      <div className={bad ? "editor-row is-bad" : "editor-row"}>
        <span className="editor-gutter">{number}</span>
        <span className="editor-code">
          {tokens.map((token, index) => (
            <span key={index} className={`tok-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </span>
      </div>
    );
  },
  (a, b) => a.number === b.number && a.bad === b.bad && a.signature === b.signature,
);

function MenuButton({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: typeof Save;
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="tap flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-2/80 px-3 text-left disabled:opacity-40"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="hidden text-xs text-muted sm:inline">{hint}</span> : null}
    </button>
  );
}

// Enter keeps the indent (one level deeper after a block opener); Tab indents.
function onEditorKey(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  setSource: (next: string) => void,
  pendingCursor: React.RefObject<number | null>,
) {
  const area = event.currentTarget;
  const { value, selectionStart: start, selectionEnd: end } = area;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const line = value.slice(lineStart, start);
  let insert: string | null = null;
  if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    const indent = line.match(/^[ \t]*/)![0];
    // One level deeper after a line that opens a block, unless it already ends in an action.
    const opens =
      /^\s*(?:(?:screen|page|view|component|modal|popup|pop-up|dialog|sheet):|show\b|for each\b|if\b|else\b|otherwise\b|on\b|when\b|after\b|once\b|step\b|button\b|choose\b|select\b|pick\b)/i.test(
        line,
      ) || /^\s*(?:text|headline|heading|label|message|says?)\s*:\s*$/i.test(line);
    const inline = /\s(go(es)?\s+to|opens?|show)\s+\S/i.test(line.replace(/^\s*show\s/i, " "));
    insert = `\n${indent}${opens && !inline ? "  " : ""}`;
  } else if (event.key === "Tab" && !event.shiftKey && start === end) {
    insert = "  ";
  }
  if (insert == null) return;
  event.preventDefault();
  pendingCursor.current = start + insert.length;
  setSource(value.slice(0, start) + insert + value.slice(end));
}

function ViewSwitch({ value, onChange }: { value: ViewKind; onChange: (next: ViewKind) => void }) {
  const options: { id: ViewKind; label: string; icon: typeof Workflow }[] = [
    { id: "story", label: "Storyboard", icon: LayoutTemplate },
    { id: "flow", label: "Flow", icon: Workflow },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Map view"
      className="flex rounded-full border border-border bg-surface/90 p-0.5 backdrop-blur"
    >
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`tap inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${
            value === id ? "bg-accent text-accent-ink" : "text-muted"
          }`}
        >
          <Icon aria-hidden="true" className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

function MapButton({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: typeof Plus;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="tap grid size-11 place-items-center"
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}

// Example lines are coloured by the real parser; "|" separates several on one row.
const HELP: { code: string; text: string }[] = [
  {
    code: "Screen: Cart|Popup: Coffee Type",
    text: "A page, or a modal that opens on top. Indented lines belong to it.",
  },
  {
    code: "Show Header, Search",
    text: "Parts of the layout. Indent under a Show to nest parts inside it.",
  },
  {
    code: "Text: Free shipping|Headline: Pick a blend",
    text: "Words on the screen. For several lines, leave the rest of the line empty after 'Text:' and write the lines indented below it; they are taken word for word.",
  },
  {
    code: "Image: hero photo of the beans|Video: how to roast (square)",
    text: "A picture or video placeholder. Add (square) or (tall) for the shape. 'Show Hero Image' or 'Show Logo' are drawn as pictures too.",
  },
  { code: "Button Datakaffe goes to Roasting", text: "A button and where it leads." },
  {
    code: "Choose roast flow:",
    text: "A select. Put one option per line below it: 'Datakaffe: weigh first, goes to Roasting'. The description and the 'goes to' are optional.",
  },
  {
    code: "For each blend in my library show Blend Card",
    text: "A list. Or put the Show lines indented below.",
  },
  {
    code: "If cart is empty|Else if …|Else",
    text: "Choices. Indent what happens below each one, or end the line with 'go to …' or 'show …'.",
  },
  {
    code: "When they tap Buy go to Cart",
    text: "An event: a tap, a timer, a device finishing. Also On, After. Can hold If / Else below it.",
  },
  {
    code: "Step: Weigh 200 g of beans",
    text: "Numbered steps inside a screen (Step 1 of n). Move on with 'When … go to next step' or 'go to step 3'; a step that says nothing about moving on continues to the next step by itself.",
  },
  {
    code: "Go to Home|Open Coffee Type",
    text: "A plain link. 'goes to', 'opens', 'you are taken to' work too.",
  },
  { code: "Component: Blend Card", text: "A reusable part. Any 'Show Blend Card' links to it." },
  {
    code: "Loop bank checks until it answers then go to Receipt",
    text: "Wait or repeat until something happens, then move on.",
  },
];

function HowTo({
  onClose,
  onExample,
}: {
  onClose: () => void;
  onExample: (source: string) => void;
}) {
  return (
    <section
      className="rounded-card border border-border bg-surface/90 px-4 py-4 text-sm text-pretty"
      aria-label="How to write"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted">
          One thing per line. Indent with two spaces (or Tab) to put things inside each other.
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close how to"
          className="tap -m-2 grid size-9 shrink-0 place-items-center text-muted"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-muted">Examples:</span>
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onExample(example.source)}
            className="tap inline-flex h-9 items-center rounded-full border border-border bg-surface-2/80 px-4 font-medium text-fg"
          >
            {example.label}
          </button>
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {HELP.map((item) => (
          <li key={item.text}>
            <span className="font-mono">
              {item.code.split("|").map((example, i) => (
                <span key={example}>
                  {i > 0 ? <span className="text-muted"> / </span> : null}
                  {classifyLine(example).tokens.map((token, j) => (
                    <span key={j} className={`tok-${token.kind}`}>
                      {token.text}
                    </span>
                  ))}
                </span>
              ))}
            </span>
            <p className="text-muted">{item.text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-muted">
        <span className="font-mono text-fg">Title: Shop</span> names the map. Lines starting with{" "}
        <span className="font-mono text-fg">//</span> or{" "}
        <span className="font-mono text-fg">Note:</span> are comments.
      </p>
      <p className="mt-3 text-muted">
        Storyboard shows each screen with its layout; Flow shows only how screens connect. Press the
        round button (or Esc) to explore the map: drag to move, scroll or pinch to zoom,
        double-click to fit. Ctrl+E switches back.
      </p>
      <div className="mt-4 rounded-xl border border-border bg-surface-2/60 p-3">
        <p className="inline-flex items-center gap-2 font-medium text-fg">
          <Bot aria-hidden="true" className="size-4 text-accent" />
          For AI agents
        </p>
        <p className="mt-1 text-muted">
          Write a script, then open{" "}
          <span className="font-mono break-all text-fg">{location.href.split("#")[0]}#text=</span>
          <span className="text-fg">&lt;url-encoded script&gt;</span> (add{" "}
          <span className="font-mono text-fg">&amp;view=flow</span> for the flow view). The full
          guide is at{" "}
          <a className="text-accent underline" href="agents.md" target="_blank" rel="noreferrer">
            agents.md
          </a>
          .
        </p>
      </div>
    </section>
  );
}
