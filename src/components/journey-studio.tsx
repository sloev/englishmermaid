import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Maximize,
  Minus,
  PenLine,
  Plus,
  RotateCcw,
  Route,
  X,
} from "lucide-react";
import {
  BLANK,
  EXAMPLES,
  insertSnippet,
  parseJourney,
  SNIPPETS,
  STARTER,
  type SnippetId,
} from "@/lib/plainpath";

const STORAGE_KEY = "plainpath-script";
const MERMAID_SRC = "https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js";

type MermaidApi = {
  initialize: (config: unknown) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

let mermaidPromise: Promise<MermaidApi> | null = null;
let mermaidReady = false;
let renderSeq = 0;

function ensureMermaid(): Promise<MermaidApi> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.mermaid?.render && mermaidReady) return Promise.resolve(window.mermaid);
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = new Promise((resolve, reject) => {
    const finish = () => {
      try {
        const api = window.mermaid;
        if (!api?.render) {
          mermaidPromise = null;
          reject(new Error("Could not load the map renderer"));
          return;
        }
        if (!mermaidReady) {
          api.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            suppressErrorRendering: true,
            theme: "base",
            look: "classic",
            fontFamily: "Outfit, sans-serif",
            flowchart: {
              curve: "basis",
              htmlLabels: true,
              wrappingWidth: 180,
              padding: 14,
              nodeSpacing: 32,
              rankSpacing: 46,
              useMaxWidth: false,
              diagramPadding: 8,
            },
            themeVariables: {
              darkMode: true,
              background: "transparent",
              fontFamily: "Outfit, sans-serif",
              fontSize: "16px",
              primaryColor: "#211e17",
              primaryTextColor: "#f4efe6",
              primaryBorderColor: "#e4a04a",
              secondaryColor: "#17211c",
              secondaryTextColor: "#f4efe6",
              secondaryBorderColor: "#8fbf9f",
              tertiaryColor: "#211e17",
              tertiaryTextColor: "#f4efe6",
              tertiaryBorderColor: "#e7c27a",
              lineColor: "#a39888",
              textColor: "#f4efe6",
              mainBkg: "#211e17",
              nodeBorder: "#e4a04a",
              titleColor: "#f4efe6",
              edgeLabelBackground: "#17150f",
              clusterBkg: "#17150f",
              nodeTextColor: "#f4efe6",
            },
          });
          mermaidReady = true;
        }
        resolve(api);
      } catch {
        mermaidPromise = null;
        mermaidReady = false;
        reject(new Error("Could not start the map renderer"));
      }
    };

    if (window.mermaid?.render) {
      finish();
      return;
    }

    let script = document.querySelector<HTMLScriptElement>(`script[src="${MERMAID_SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = MERMAID_SRC;
      script.async = true;
      script.dataset.plainpathMermaid = "1";
      document.head.appendChild(script);
    }

    const onLoad = () => finish();
    const onError = () => {
      mermaidPromise = null;
      reject(new Error("Could not load the map renderer"));
    };
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
  });

  return mermaidPromise;
}

const KEY_CLASS: Record<SnippetId, string> = {
  screen: "text-accent",
  go: "text-go",
  if: "text-if",
  loop: "text-loop",
};

type View = { x: number; y: number; scale: number };

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const FIT_PADDING = 48;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function presentSvg(raw: string) {
  return raw.replace(/style="([^"]*)"/, (_match, style: string) => {
    const next = style.replace(/max-width\s*:\s*[^;"]+;?/g, "").trim();
    return next ? `style="${next}"` : "";
  });
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

export function JourneyStudio() {
  const [source, setSource] = useState(STARTER);
  const [ready, setReady] = useState(false);
  const [svg, setSvg] = useState("");
  const [mapNote, setMapNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [editorOpen, setEditorOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [grabbing, setGrabbing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<string | null>(null);
  const pendingCursor = useRef<number | null>(null);
  const viewRef = useRef(view);
  // Once the user pans or zooms we stop auto-fitting new renders.
  const userMoved = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{
    dist: number;
    scale: number;
    cx: number;
    cy: number;
    ox: number;
    oy: number;
  } | null>(null);
  viewRef.current = view;

  const model = useMemo(() => parseJourney(source), [source]);
  const explicitCount = model.screens.filter((screen) => !screen.implicit).length;
  const ghostCount = model.screens.length - explicitCount;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved != null) setSource(saved);
    } catch {
      /* private mode */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, source);
    } catch {
      /* ignore quota */
    }
  }, [source, ready]);

  useEffect(() => {
    if (pendingCursor.current == null) return;
    const cursor = pendingCursor.current;
    pendingCursor.current = null;
    const area = areaRef.current;
    if (!area) return;
    area.focus();
    area.setSelectionRange(cursor, cursor);
  }, [source]);

  useEffect(() => {
    if (!model.mermaid) {
      setSvg("");
      setMapNote(null);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      ensureMermaid()
        .then(async (api) => {
          const id = `plainpath${++renderSeq}`;
          try {
            const drawn = await api.render(id, model.mermaid);
            document.getElementById(id)?.remove();
            if (!cancel) {
              setSvg(presentSvg(drawn.svg));
              setMapNote(null);
            }
          } catch {
            document.getElementById(id)?.remove();
            if (!cancel) setMapNote("The map could not be drawn from these steps yet.");
          }
        })
        .catch(() => {
          if (!cancel) setMapNote("The map renderer did not load. Check your connection.");
        });
    }, 90);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [model.mermaid]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    const drawn = hostRef.current?.querySelector("svg");
    if (!stage || !drawn) return;
    const width = drawn.getBoundingClientRect().width / viewRef.current.scale;
    const height = drawn.getBoundingClientRect().height / viewRef.current.scale;
    if (!width || !height) return;
    const scale = clamp(
      Math.min(
        (stage.clientWidth - FIT_PADDING * 2) / width,
        (stage.clientHeight - FIT_PADDING * 2) / height,
        1.6,
      ),
      MIN_SCALE,
      MAX_SCALE,
    );
    userMoved.current = false;
    setView({
      x: (stage.clientWidth - width * scale) / 2,
      y: (stage.clientHeight - height * scale) / 2,
      scale,
    });
  }, []);

  useEffect(() => {
    if (svg && !userMoved.current) fit();
  }, [svg, fit]);

  useEffect(() => {
    const onResize = () => {
      if (!userMoved.current) fit();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fit]);

  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    const current = viewRef.current;
    const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = scale / current.scale;
    userMoved.current = true;
    setView({ x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio, scale });
  }, []);

  function zoomCenter(factor: number) {
    const stage = stageRef.current;
    if (!stage) return;
    zoomAt(factor, stage.clientWidth / 2, stage.clientHeight / 2);
  }

  // Wheel must be non-passive so we can stop the page from scrolling.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      if (event.ctrlKey || event.metaKey || event.deltaMode !== 0 || Math.abs(event.deltaY) >= 50) {
        zoomAt(Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), px, py);
      } else {
        // Trackpad two-finger scroll pans.
        userMoved.current = true;
        setView((current) => ({
          ...current,
          x: current.x - event.deltaX,
          y: current.y - event.deltaY,
        }));
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = viewRef.current;
    if (pointers.current.size === 1) {
      drag.current = { x: event.clientX, y: event.clientY, ox: current.x, oy: current.y };
      setGrabbing(true);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current = null;
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: current.scale,
        cx: (a.x + b.x) / 2 - rect.left,
        cy: (a.y + b.y) / 2 - rect.top,
        ox: current.x,
        oy: current.y,
      };
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = event.currentTarget.getBoundingClientRect();
      const start = pinch.current;
      const scale = clamp(
        start.scale * (Math.hypot(a.x - b.x, a.y - b.y) / start.dist),
        MIN_SCALE,
        MAX_SCALE,
      );
      const ratio = scale / start.scale;
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      userMoved.current = true;
      setView({
        x: cx - (start.cx - start.ox) * ratio,
        y: cy - (start.cy - start.oy) * ratio,
        scale,
      });
    } else if (drag.current) {
      const start = drag.current;
      userMoved.current = true;
      setView((current) => ({
        ...current,
        x: start.ox + event.clientX - start.x,
        y: start.oy + event.clientY - start.y,
      }));
    }
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      const current = viewRef.current;
      drag.current = { x: rest.x, y: rest.y, ox: current.x, oy: current.y };
    } else if (pointers.current.size === 0) {
      drag.current = null;
      setGrabbing(false);
    }
  }

  function onStageKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = 60;
    const pan = (dx: number, dy: number) => {
      userMoved.current = true;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    };
    const actions: Record<string, () => void> = {
      "+": () => zoomCenter(1.25),
      "=": () => zoomCenter(1.25),
      "-": () => zoomCenter(0.8),
      "0": fit,
      ArrowLeft: () => pan(step, 0),
      ArrowRight: () => pan(-step, 0),
      ArrowUp: () => pan(0, step),
      ArrowDown: () => pan(0, -step),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  const toggleEditor = useCallback(() => setEditorOpen((open) => !open), []);

  // Cmd/Ctrl+E toggles from anywhere; Escape leaves the editor.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "e") {
        event.preventDefault();
        toggleEditor();
      } else if (event.key === "Escape" && editorOpen) {
        if (helpOpen) setHelpOpen(false);
        else setEditorOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editorOpen, helpOpen, toggleEditor]);

  useEffect(() => {
    if (editorOpen) areaRef.current?.focus({ preventScroll: true });
    else stageRef.current?.focus({ preventScroll: true });
  }, [editorOpen]);

  function onInsert(id: SnippetId) {
    const area = areaRef.current;
    const snippet = SNIPPETS[id];
    const start = area?.selectionStart ?? source.length;
    const end = area?.selectionEnd ?? source.length;
    const result = insertSnippet(source, start, end, snippet.text, snippet.cursor);
    pendingCursor.current = result.cursor;
    setSource(result.next);
  }

  function loadSource(next: string) {
    undoRef.current = source;
    setCanUndo(true);
    userMoved.current = false;
    setSource(next);
    pendingCursor.current = next.length;
  }

  function undo() {
    if (undoRef.current == null) return;
    setSource(undoRef.current);
    undoRef.current = null;
    setCanUndo(false);
  }

  function selectLine(line: number) {
    const area = areaRef.current;
    if (!area) return;
    const parts = source.split("\n");
    let start = 0;
    for (let i = 0; i < line - 1 && i < parts.length; i += 1) start += parts[i].length + 1;
    const end = start + (parts[line - 1]?.length ?? 0);
    area.focus();
    area.setSelectionRange(start, end);
  }

  async function onCopy() {
    if (!model.mermaid) return;
    await copyText(model.mermaid);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const activeExample = EXAMPLES.find((example) => example.source === source)?.id;
  const chip =
    "tap inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium";

  return (
    <main className="fixed inset-0 overflow-hidden bg-bg text-fg">
      {/* Background: the live map. Takes pointer input whenever the editor is hidden. */}
      <div
        ref={stageRef}
        tabIndex={-1}
        aria-label={model.title ? `${model.title} journey map` : "Journey map"}
        role="application"
        className={`map-stage map-canvas absolute inset-0 outline-none ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={fit}
        onKeyDown={onStageKey}
      >
        <div
          className="map-layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
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

      {/* Foreground: translucent editor. Hidden layer is inert so it can't steal input. */}
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
                  {model.title ? (
                    <span className="text-fg">{model.title}</span>
                  ) : (
                    "Untitled journey"
                  )}
                  <span aria-hidden="true"> · </span>
                  {explicitCount} {explicitCount === 1 ? "screen" : "screens"}
                  <span aria-hidden="true"> · </span>
                  {model.edges.length} {model.edges.length === 1 ? "step" : "steps"}
                  {ghostCount > 0 ? ` · ${ghostCount} not written yet` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHelpOpen((open) => !open)}
                aria-expanded={helpOpen}
                className={`${chip} ${helpOpen ? "border-accent text-accent" : "border-border bg-surface/80 text-fg"}`}
              >
                <BookOpen aria-hidden="true" className="size-4" />
                How to
              </button>
              <button
                type="button"
                onClick={onCopy}
                disabled={!model.mermaid}
                className={`${chip} border-border bg-surface/80 text-fg disabled:opacity-40`}
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
                className={`${chip} ${
                  activeExample === example.id
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-border bg-surface/80 text-fg"
                }`}
              >
                {example.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => loadSource(BLANK)}
              className={`${chip} border-border bg-surface/80 text-fg`}
            >
              <Plus aria-hidden="true" className="size-4" />
              New
            </button>
            {canUndo ? (
              <button
                type="button"
                onClick={undo}
                className={`${chip} border-border bg-surface/80 text-fg`}
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
                className="tap flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface-2/80 px-3"
                aria-label={`Insert ${SNIPPETS[id].label}. ${SNIPPETS[id].hint}`}
              >
                <span className={`font-mono text-sm font-semibold ${KEY_CLASS[id]}`}>
                  {SNIPPETS[id].label}
                </span>
                <span className="text-xs text-muted">{SNIPPETS[id].hint}</span>
              </button>
            ))}
          </div>

          <div className="editor-stack script-text rounded-card" translate="no">
            <div className="editor-lines" aria-hidden="true">
              {model.lines.map((line, index) => (
                <div
                  key={index}
                  className={
                    model.badLines.includes(index + 1) ? "editor-row is-bad" : "editor-row"
                  }
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
            <label className="sr-only" htmlFor="journey-script">
              Journey script
            </label>
            <textarea
              ref={areaRef}
              id="journey-script"
              className="editor-input script-text"
              value={source}
              spellCheck={false}
              autoCapitalize="sentences"
              autoCorrect="off"
              autoComplete="off"
              enterKeyHint="enter"
              wrap="soft"
              aria-describedby="journey-errors"
              onChange={(event) => {
                setCanUndo(false);
                setSource(event.target.value);
              }}
            />
          </div>

          <div id="journey-errors" role="status" aria-live="polite" className="flex flex-col gap-2">
            {model.issues.map((issue) => (
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

      {/* Map controls, only while the map has the input. */}
      {!editorOpen ? (
        <div className="absolute right-4 bottom-4 z-30 flex flex-col overflow-hidden rounded-full border border-border bg-surface/90 backdrop-blur">
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => zoomCenter(1.25)}
            className="tap grid size-11 place-items-center"
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => zoomCenter(0.8)}
            className="tap grid size-11 place-items-center"
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Fit map to screen"
            onClick={fit}
            className="tap grid size-11 place-items-center"
          >
            <Maximize aria-hidden="true" className="size-4" />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggleEditor}
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
        {!editorOpen && model.issues.length > 0 ? (
          <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-xs font-semibold text-bg tabular-nums">
            {model.issues.length}
          </span>
        ) : null}
      </button>
    </main>
  );
}

function HowTo({ onClose }: { onClose: () => void }) {
  return (
    <section
      className="rounded-card border border-border bg-surface/90 px-4 py-4 text-sm text-pretty"
      aria-label="How to write"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted">One step per line. Say it the way you would text a teammate.</p>
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
        <li>
          <span className="font-mono font-semibold text-accent">Screen: Home</span>
          <p className="text-muted">A page, a state, or a moment.</p>
        </li>
        <li>
          <span className="font-mono font-semibold text-go">Go to Coffee List</span>
          <p className="text-muted">A plain link to another screen.</p>
        </li>
        <li>
          <span className="font-mono text-fg">
            <span className="font-semibold text-if">If</span>
            <span className="text-muted"> chooses data coffee </span>
            <span className="font-semibold text-go">go to</span>
            <span> Fetch Beans</span>
          </span>
          <p className="text-muted">A branch. The condition is normal words.</p>
        </li>
        <li>
          <span className="font-mono text-fg">
            <span className="font-semibold text-loop">Loop</span>
            <span className="text-muted"> roaster runs </span>
            <span className="font-semibold text-loop">until</span>
            <span className="text-muted"> timer ends </span>
            <span className="font-semibold text-loop">then</span>
            <span className="font-semibold text-go"> go to</span>
            <span> Success</span>
          </span>
          <p className="text-muted">Repeat something until an event, then move on.</p>
        </li>
      </ul>
      <p className="mt-3 text-muted">
        Optional: <span className="font-mono text-fg">Title: Morning coffee</span> names the map.{" "}
        <span className="font-mono text-fg">Note: later</span> is a comment and stays off the map.
      </p>
      <p className="mt-3 text-muted">
        Map: tap the round button bottom-left (or press Esc) to explore. Drag to move, scroll or
        pinch to zoom, double-click to fit. Ctrl+E switches back.
      </p>
    </section>
  );
}
