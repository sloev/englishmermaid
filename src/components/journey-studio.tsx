import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Copy,
  Map as MapIcon,
  PenLine,
  Plus,
  RotateCcw,
  Route,
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
            useMaxWidth: true,
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
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const [grabbing, setGrabbing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<string | null>(null);
  const pendingCursor = useRef<number | null>(null);
  const viewRef = useRef(view);
  const editorOpenRef = useRef(editorOpen);
  const fitted = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const pinch = useRef<{ dist: number; scale: number; x: number; y: number } | null>(null);
  viewRef.current = view;
  editorOpenRef.current = editorOpen;

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
            if (!cancel) {
              setSvg("");
              setMapNote("The map could not be drawn from these steps yet.");
            }
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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    area.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }

  async function onCopy() {
    if (!model.mermaid) return;
    await copyText(model.mermaid);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const activeExample = EXAMPLES.find((example) => example.source === source)?.id;

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 pb-16 lg:px-6 lg:py-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-card bg-accent text-accent-ink">
              <Route aria-hidden="true" className="size-5" strokeWidth={2.25} />
            </span>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-balance">Plainpath</h1>
              <p className="max-w-md text-sm text-pretty text-muted">
                Map a website in plain English. Spaces and new lines only — no arrows or brackets.
              </p>
            </div>
          </div>
          <p className="text-sm tabular-nums text-muted">
            {model.title ? <span className="text-fg">{model.title}</span> : "Untitled journey"}
            <span aria-hidden="true"> · </span>
            {explicitCount} {explicitCount === 1 ? "screen" : "screens"}
            <span aria-hidden="true"> · </span>
            {model.edges.length} {model.edges.length === 1 ? "step" : "steps"}
            {ghostCount > 0 ? ` · ${ghostCount} not written yet` : ""}
          </p>
        </header>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              onClick={() => loadSource(example.source)}
              className={
                "tap h-11 shrink-0 rounded-full border px-4 text-sm font-medium " +
                (activeExample === example.id
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-border bg-surface text-fg")
              }
            >
              {example.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => loadSource(BLANK)}
            className="tap inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-fg"
          >
            <Plus aria-hidden="true" className="size-4" />
            New
          </button>
          {canUndo ? (
            <button
              type="button"
              onClick={undo}
              className="tap inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-4 text-sm font-medium text-fg"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Undo
            </button>
          ) : null}
        </div>

        <div className="sticky top-0 z-20 rounded-card border border-border bg-bg px-2 py-2">
          <div className="flex gap-2 overflow-x-auto">
            {(Object.keys(SNIPPETS) as SnippetId[]).map((id) => (
              <button
                key={id}
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => onInsert(id)}
                className="tap flex h-12 shrink-0 flex-col items-start justify-center rounded-xl border border-border bg-surface-2 px-4"
                aria-label={`Insert ${SNIPPETS[id].label}. ${SNIPPETS[id].hint}`}
              >
                <span className={`font-mono text-base font-semibold ${KEY_CLASS[id]}`}>
                  {SNIPPETS[id].label}
                </span>
                <span className="text-xs text-muted">{SNIPPETS[id].hint}</span>
              </button>
            ))}
          </div>
          <p className="px-2 pt-2 text-xs text-muted">Tap a word to drop it in. The colon is typed for you.</p>
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <section className="flex min-w-0 flex-col gap-3" aria-label="Journey script">
            <div className="overflow-hidden rounded-card border border-border focus-within:border-accent">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
                <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Script</h2>
                <div className="flex items-center gap-3">
                  <span className={`text-sm tabular-nums ${model.issues.length ? "text-danger" : "text-muted"}`}>
                    {model.issues.length ? `${model.issues.length} to fix` : "Reads clean"}
                  </span>
                  <button
                    type="button"
                    className="tap h-10 rounded-full border border-border px-3 text-sm font-medium text-fg lg:hidden"
                    onClick={() => {
                      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                      document.getElementById("map")?.scrollIntoView({
                        behavior: reduce ? "auto" : "smooth",
                        block: "start",
                      });
                    }}
                  >
                    See map
                  </button>
                </div>
              </div>
              <div className="editor-stack script-text" translate="no">
                <div className="editor-lines" aria-hidden="true">
                  {model.lines.map((line, index) => (
                    <div
                      key={index}
                      className={model.badLines.includes(index + 1) ? "editor-row is-bad" : "editor-row"}
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
            </div>

            <div id="journey-errors" role="status" aria-live="polite" className="flex flex-col gap-2">
              {model.issues.length === 0 ? (
                <p className="text-sm text-muted">Every line is a screen, a link, a choice, or a loop.</p>
              ) : (
                model.issues.map((issue) => (
                  <button
                    key={`${issue.line}-${issue.message}`}
                    type="button"
                    onClick={() => selectLine(issue.line)}
                    className="tap flex min-h-11 items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft px-3 py-2 text-left text-sm text-fg"
                  >
                    <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
                    <span>{issue.message}</span>
                  </button>
                ))
              )}
            </div>

            <details className="group rounded-card border border-border bg-surface">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <BookOpen aria-hidden="true" className="size-4 text-accent" />
                  How to write
                </span>
                <span className="text-muted group-open:hidden">Show</span>
                <span className="hidden text-muted group-open:inline">Hide</span>
              </summary>
              <div className="flex flex-col gap-3 border-t border-border px-4 py-4 text-sm text-pretty">
                <p className="text-muted">One step per line. Say it the way you would text a teammate.</p>
                <ul className="flex flex-col gap-3">
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
                <p className="text-muted">
                  Optional: <span className="font-mono text-fg">Title: Morning coffee</span> names the map.{" "}
                  <span className="font-mono text-fg">Note: later</span> is a comment and stays off the map.
                </p>
              </div>
            </details>
          </section>

          <section id="map" className="min-w-0 scroll-mt-24 lg:sticky lg:top-4">
            <div className="overflow-hidden rounded-card border border-border bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                <h2 className="inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
                  <MapIcon aria-hidden="true" className="size-4" />
                  Map
                </h2>
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={!model.mermaid}
                  className="tap inline-flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
                >
                  {copied ? (
                    <Check aria-hidden="true" className="size-4" />
                  ) : (
                    <Copy aria-hidden="true" className="size-4" />
                  )}
                  {copied ? "Copied" : "Copy Mermaid code"}
                </button>
              </div>
              <div className="map-canvas min-h-72 px-2 py-4">
                {svg ? (
                  <div
                    className="mermaid-host"
                    role="img"
                    aria-label={model.title ? `${model.title} journey map` : "Journey map"}
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                ) : (
                  <StepReadout />
                )}
                {mapNote ? <p className="px-3 pt-3 text-sm text-danger">{mapNote}</p> : null}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted">
                <li className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-accent" />
                  Start
                </li>
                <li className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full border border-accent" />
                  Screen
                </li>
                <li className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-if" />
                  If
                </li>
                <li className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-go" />
                  Loop
                </li>
                <li className="inline-flex items-center gap-2">
                  <span className="size-2.5 rounded-full border border-dashed border-muted" />
                  Not written yet
                </li>
              </ul>
              {model.mermaid ? (
                <details className="border-t border-border">
                  <summary className="min-h-11 cursor-pointer list-none px-4 py-3 text-sm font-medium text-muted">
                    Mermaid code
                  </summary>
                  <pre className="max-h-64 overflow-auto px-4 pb-4 font-mono text-xs leading-relaxed text-fg">
                    {model.mermaid}
                  </pre>
                </details>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );

  function StepReadout() {
    if (model.screens.length === 0) {
      return (
        <p className="px-3 py-8 text-center text-sm text-pretty text-muted">
          Tap Screen: and name the first page. The map draws itself as you type.
        </p>
      );
    }
    return (
      <ol className="flex flex-col gap-4 px-3 py-2">
        {model.screens
          .filter((screen) => !screen.implicit)
          .map((screen) => (
            <li key={screen.name}>
              <p className="font-medium">{screen.name}</p>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
                {model.edges
                  .filter((edge) => edge.from === screen.name)
                  .map((edge) => (
                    <li key={`${edge.kind}-${edge.line}`}>
                      {edge.kind === "go"
                        ? `Go to ${edge.to}`
                        : edge.kind === "if"
                          ? `If ${edge.condition} go to ${edge.to}`
                          : `Loop ${edge.action} until ${edge.until} then go to ${edge.to}`}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
      </ol>
    );
  }
}
