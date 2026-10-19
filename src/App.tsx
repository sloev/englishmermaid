import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
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
  EXAMPLES,
  insertSnippet,
  parse,
  SNIPPETS,
  STARTER,
  toMermaid,
  type SnippetId,
  type ViewKind,
} from "./lib/plainpath";
import { renderMermaid } from "./lib/mermaid";
import { usePanZoom } from "./lib/use-pan-zoom";

const STORAGE_KEY = "plainpath-script";
const VIEW_KEY = "plainpath-view";

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
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
  const [copied, setCopied] = useState(false);
  const [undoSource, setUndoSource] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const pendingCursor = useRef<number | null>(null);
  const map = usePanZoom(stageRef, hostRef);

  const journey = useMemo(() => parse(source), [source]);
  const mermaid = useMemo(() => toMermaid(journey, viewKind), [journey, viewKind]);
  const badLines = useMemo(() => new Set(journey.issues.map((issue) => issue.line)), [journey]);
  const screenCount = journey.blocks.filter((block) => block.kind === "screen").length;
  const ghostCount = journey.blocks.filter((block) => block.kind === "ghost").length;

  useEffect(() => store(STORAGE_KEY, source), [source]);
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
    const timer = window.setTimeout(() => {
      renderMermaid(mermaid)
        .then((drawn) => {
          if (cancel) return;
          setSvg(drawn);
          setMapNote(null);
        })
        .catch(() => {
          if (!cancel) setMapNote("The map could not be drawn from these lines yet.");
        });
    }, 120);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [mermaid]);

  const { autoFit } = map;
  useEffect(() => {
    if (svg) autoFit();
  }, [svg, autoFit]);

  // Cmd/Ctrl+E toggles from anywhere; Escape leaves the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setEditorOpen((open) => !open);
      } else if (event.key === "Escape" && editorOpen) {
        if (helpOpen) setHelpOpen(false);
        else setEditorOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, helpOpen]);

  useEffect(() => {
    if (editorOpen) areaRef.current?.focus({ preventScroll: true });
    else stageRef.current?.focus({ preventScroll: true });
  }, [editorOpen]);

  function onInsert(id: SnippetId) {
    const area = areaRef.current;
    const { text, cursor } = SNIPPETS[id];
    const result = insertSnippet(
      source,
      area?.selectionStart ?? source.length,
      area?.selectionEnd ?? source.length,
      text,
      cursor,
    );
    pendingCursor.current = result.cursor;
    setSource(result.next);
  }

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

  async function onCopy() {
    if (!mermaid) return;
    await navigator.clipboard.writeText(mermaid).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function switchView(next: ViewKind) {
    map.resetFit();
    setViewKind(next);
  }

  const activeExample = EXAMPLES.find((example) => example.source === source)?.id;
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
        className={`map-stage map-canvas absolute inset-0 outline-none ${map.grabbing ? "cursor-grabbing" : "cursor-grab"}`}
        {...map.handlers}
      >
        <div
          className="map-layer"
          style={{
            transform: `translate(${map.view.x}px, ${map.view.y}px) scale(${map.view.scale})`,
          }}
        >
          {svg ? (
            <div ref={hostRef} className="mermaid-host" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : null}
        </div>
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
              <ViewSwitch value={viewKind} onChange={switchView} />
              <button
                type="button"
                onClick={() => setHelpOpen((open) => !open)}
                aria-expanded={helpOpen}
                className={helpOpen ? `${chip} border-accent text-accent` : plainChip}
              >
                <BookOpen aria-hidden="true" className="size-4" />
                How to
              </button>
              <button
                type="button"
                onClick={onCopy}
                disabled={!mermaid}
                className={`${plainChip} disabled:opacity-40`}
              >
                {copied ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : (
                  <Copy aria-hidden="true" className="size-4" />
                )}
                {copied ? "Copied" : "Mermaid"}
              </button>
            </div>
          </header>

          {helpOpen ? <HowTo onClose={() => setHelpOpen(false)} /> : null}

          <div className="flex gap-2 overflow-x-auto pb-1">
            {EXAMPLES.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() => loadSource(example.source)}
                className={
                  activeExample === example.id
                    ? `${chip} border-accent bg-accent text-accent-ink`
                    : plainChip
                }
              >
                {example.label}
              </button>
            ))}
            <button type="button" onClick={() => loadSource(BLANK)} className={plainChip}>
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
          </div>

          <div className="flex gap-2 overflow-x-auto">
            {(Object.keys(SNIPPETS) as SnippetId[]).map((id) => (
              <button
                key={id}
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onInsert(id)}
                className="tap flex h-10 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-2/80 px-3"
                aria-label={`Insert ${SNIPPETS[id].label}: ${SNIPPETS[id].hint}`}
              >
                <span className={`tok-${SNIPPETS[id].kind} font-mono text-sm`}>
                  {SNIPPETS[id].label}
                </span>
                <span className="text-xs text-muted">{SNIPPETS[id].hint}</span>
              </button>
            ))}
          </div>

          <div className="editor-stack script-text rounded-card" translate="no">
            <div className="editor-lines" aria-hidden="true">
              {journey.lines.map((line, index) => (
                <div
                  key={index}
                  className={badLines.has(index + 1) ? "editor-row is-bad" : "editor-row"}
                >
                  <span className="editor-gutter">{index + 1}</span>
                  <span className="editor-code">
                    {line.tokens.map((token, tokenIndex) => (
                      <span key={tokenIndex} className={`tok-${token.kind}`}>
                        {token.text}
                      </span>
                    ))}
                  </span>
                </div>
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
    </main>
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
    const opens =
      /^\s*(screen:|page:|component:|show\b|for each\b|if\b|else\b|otherwise\b|on\b|when\b)/i.test(
        line,
      );
    const inline = /\s(go\s+to|show)\s+\S/i.test(line.replace(/^\s*show\s/i, " "));
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

const HELP: { code: [string, string][]; text: string }[] = [
  {
    code: [
      ["Screen: ", "screen"],
      ["Cart", "name"],
    ],
    text: "A page or a step. Everything indented under it belongs to it.",
  },
  {
    code: [
      ["Show ", "show"],
      ["Header, Search", "name"],
    ],
    text: "Parts of the layout. Indent under a Show to nest parts inside it.",
  },
  {
    code: [
      ["For each ", "each"],
      ["product in products ", "name"],
      ["show ", "show"],
      ["Product Card", "name"],
    ],
    text: "A repeated part, like a list. Or put the Show lines indented below.",
  },
  {
    code: [
      ["If ", "if"],
      ["cart is empty", "cond"],
      [" / ", "plain"],
      ["Else if ", "if"],
      ["… / ", "cond"],
      ["Else", "if"],
    ],
    text: "Choices. Indent what happens below each one, or end the line with 'go to …' or 'show …'.",
  },
  {
    code: [
      ["On ", "on"],
      ["tap Buy ", "cond"],
      ["go to ", "go"],
      ["Cart", "name"],
    ],
    text: "An interaction. Can hold If / Else lines indented below it.",
  },
  {
    code: [
      ["Go to ", "go"],
      ["Home", "name"],
    ],
    text: "A plain link to another screen.",
  },
  {
    code: [
      ["Component: ", "screen"],
      ["Product Card", "name"],
    ],
    text: "A reusable part. Any 'Show Product Card' links to it.",
  },
  {
    code: [
      ["Loop ", "loop"],
      ["bank checks ", "cond"],
      ["until ", "loop"],
      ["it answers ", "cond"],
      ["then go to ", "go"],
      ["Receipt", "name"],
    ],
    text: "Wait or repeat until something happens, then move on.",
  },
];

function HowTo({ onClose }: { onClose: () => void }) {
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
      <ul className="mt-3 flex flex-col gap-3">
        {HELP.map((item) => (
          <li key={item.text}>
            <span className="font-mono">
              {item.code.map(([text, kind]) => (
                <span key={text} className={`tok-${kind}`}>
                  {text}
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
    </section>
  );
}
