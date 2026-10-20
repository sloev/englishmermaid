import type { Mermaid } from "mermaid";

let ready: Promise<Mermaid> | null = null;
let seq = 0;

// Mermaid is large, so it is split into its own chunk and loaded on first render.
function load(): Promise<Mermaid> {
  ready ??= import("mermaid")
    .then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: "base",
        fontFamily: "Outfit, sans-serif",
        flowchart: {
          curve: "basis",
          htmlLabels: true,
          // Labels arrive pre-wrapped; this only stops Mermaid wrapping them again.
          wrappingWidth: 400,
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
          lineColor: "#a39888",
          textColor: "#f4efe6",
          titleColor: "#f4efe6",
          edgeLabelBackground: "#17150f",
          clusterBkg: "#13120e",
          clusterBorder: "#342f26",
        },
      });
      return mermaid;
    })
    .catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}

// Mermaid sizes boxes by measuring text, so the real font must be loaded first
// or the text overflows (and gets clipped) once it swaps in.
const fonts = () =>
  Promise.all(
    ["400 16px Outfit", "600 16px Outfit", "700 18px Outfit"].map((font) =>
      document.fonts?.load(font).catch(() => undefined),
    ),
  );

export async function renderMermaid(code: string): Promise<string> {
  const [mermaid] = await Promise.all([load(), fonts()]);
  const id = `plainpath${++seq}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    document.getElementById(id)?.remove();
  }
}

/** Same diagram with SVG text labels instead of HTML ones, so it can be saved or rasterised. */
export function plainLabels(code: string): string {
  const config = "config:\n  htmlLabels: false\n  flowchart:\n    htmlLabels: false";
  return code.startsWith("---\n")
    ? `---\n${config}\n${code.slice(4)}`
    : `---\n${config}\n---\n${code}`;
}

// At most one render runs at a time. While it runs, only the newest request
// waits; older waiting ones resolve to null so the caller skips them.
let busy = false;
let waiting: {
  code: string;
  resolve: (svg: string | null) => void;
  reject: (e: unknown) => void;
} | null = null;

export function renderLatest(code: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    waiting?.resolve(null);
    waiting = { code, resolve, reject };
    void pump();
  });
}

async function pump() {
  if (busy || !waiting) return;
  const job = waiting;
  waiting = null;
  busy = true;
  try {
    job.resolve(await renderMermaid(job.code));
  } catch (error) {
    job.reject(error);
  } finally {
    busy = false;
    void pump();
  }
}
