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

/**
 * Mermaid lays out a screen with no arrows in or out as one self-contained
 * block, and centres such blocks vertically against the tallest one. Move them
 * up so all screens start at the same height, like pages laid side by side.
 * They have no arrows attached, so nothing else needs to move with them.
 */
function topAlign(host: HTMLElement): boolean {
  const nodes = host.querySelector("svg")?.querySelector(":scope > g > .root > .nodes");
  if (!nodes) return false;
  const blocks = [...nodes.children]
    .filter((el): el is SVGGElement => el.classList.contains("root"))
    .flatMap((el) => {
      const at = /translate\(\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*\)/.exec(
        el.getAttribute("transform") ?? "",
      );
      if (!at) return [];
      const box = el.getBBox();
      const x = Number(at[1]);
      const y = Number(at[2]);
      // Offsets from the block's own origin to its visible box.
      return [{ el, x, y, dx: box.x, dy: box.y, width: box.width, height: box.height }];
    });
  if (blocks.length < 2) return false;

  const tallest = blocks.reduce((a, b) => (b.height > a.height ? b : a));
  const top = tallest.y + tallest.dy;
  let moved = false;
  for (const block of blocks) {
    // Only blocks sharing the tallest one's row; anything below sits in a later row.
    const blockTop = block.y + block.dy;
    if (blockTop <= top + 0.5 || blockTop + block.height > top + tallest.height + 0.5) continue;
    block.y -= blockTop - top;
    moved = true;
  }

  // With no links between screens at all, Mermaid lines them up right to left.
  // Put them back in script order: screen boxes have ids b<n>, numbered in order.
  if (blocks.length === nodes.children.length) {
    const order = (el: Element) =>
      Number(
        [...el.querySelectorAll(".cluster")].map((c) => /-b(\d+)$/.exec(c.id)?.[1]).find(Boolean) ??
          0,
      );
    const byX = [...blocks].sort((a, b) => a.x + a.dx - (b.x + b.dx));
    const gap = Math.max(0, byX[1].x + byX[1].dx - (byX[0].x + byX[0].dx + byX[0].width));
    let left = byX[0].x + byX[0].dx;
    for (const block of [...blocks].sort((a, b) => order(a.el) - order(b.el))) {
      if (Math.abs(block.x + block.dx - left) > 0.5) moved = true;
      block.x = left - block.dx;
      left += block.width + gap;
    }
  }

  if (moved) {
    for (const block of blocks)
      block.el.setAttribute("transform", `translate(${block.x}, ${block.y})`);
  }
  return moved;
}

/**
 * Turn a path around: "M a C b c d L e" becomes "M e L d C c b a". Only the
 * absolute M/L/C commands Mermaid draws edges with; anything else is left alone.
 */
export function reversePath(d: string): string | null {
  if (!/^\s*M/.test(d) || /[^MLC\d\s,.eE+-]/.test(d)) return null;
  type Seg = { from: number[]; to: number[]; c?: [number[], number[]] };
  const segs: Seg[] = [];
  let at: number[] | null = null;
  for (const [, cmd, args] of d.matchAll(/([MLC])([^MLC]*)/g)) {
    const n = args
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const step = cmd === "C" ? 6 : 2;
    if (n.length % step || n.some(Number.isNaN)) return null;
    for (let i = 0; i < n.length; i += step) {
      const p = n.slice(i, i + step);
      if (cmd === "M" && i === 0) at = p;
      else if (cmd === "C")
        segs.push({ from: at!, to: p.slice(4), c: [p.slice(0, 2), p.slice(2, 4)] });
      else segs.push({ from: at!, to: p });
      at = cmd === "C" ? p.slice(4) : p;
    }
  }
  if (!at || !segs.length) return null;
  const pt = (p: number[]) => `${p[0]},${p[1]}`;
  return (
    `M${pt(at)}` +
    segs
      .reverse()
      .map((s) => (s.c ? `C${pt(s.c[1])},${pt(s.c[0])},${pt(s.from)}` : `L${pt(s.from)}`))
      .join("")
  );
}

// Buttons get a hard offset shadow (neobrutalist) so they read as pressable.
const BUTTON_SHADOW =
  ".node.button > rect, .node.button > path { filter: drop-shadow(4px 4px 0 #f4efe6); }";

function buttonShadows(host: HTMLElement): boolean {
  const svg = host.querySelector("svg");
  if (!svg?.querySelector(".node.button")) return false;
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = BUTTON_SHADOW;
  svg.prepend(style);
  return true;
}

// "For each" groups (subgraph ids e<n>) get two offset copies of their box
// behind them, so a repeated part looks like a stack of cards.
const STACK_CARDS: [number, string][] = [
  [16, "fill:#141310;stroke:#4a4335;stroke-width:1.5px"],
  [8, "fill:#191812;stroke:#7a705f;stroke-width:1.5px"],
];

function stackRepeats(host: HTMLElement): boolean {
  let stacked = false;
  for (const group of host.querySelectorAll<SVGGElement>("g.cluster")) {
    if (!/-e\d+$/.test(group.id)) continue;
    const box = group.querySelector<SVGRectElement>(":scope > rect");
    if (!box) continue;
    // Back card first, so the nearer one is drawn over it.
    for (const [offset, style] of STACK_CARDS) {
      const card = box.cloneNode() as SVGRectElement;
      card.setAttribute("x", String(Number(box.getAttribute("x")) + offset));
      card.setAttribute("y", String(Number(box.getAttribute("y")) + offset));
      card.setAttribute("style", style);
      group.insertBefore(card, box);
    }
    stacked = true;
  }
  return stacked;
}

// Layout fixes applied to every rendered diagram (live view and exports).
function tidy(svg: string): string {
  const host = document.createElement("div");
  host.style.cssText = "position:absolute;left:-100000px;top:0;visibility:hidden";
  host.innerHTML = svg;
  document.body.append(host);
  try {
    let changed = topAlign(host);
    changed = buttonShadows(host) || changed;
    changed = stackRepeats(host) || changed;
    // Links written backwards for layout (see Writer.edge) get their arrow turned round.
    for (const path of host.querySelectorAll<SVGPathElement>('path[id*="-back"]')) {
      if (!/-back\d+$/.test(path.id)) continue;
      const reversed = reversePath(path.getAttribute("d") ?? "");
      if (reversed) path.setAttribute("d", reversed);
      changed = true;
    }
    return changed ? host.innerHTML : svg;
  } finally {
    host.remove();
  }
}

export async function renderMermaid(code: string): Promise<string> {
  const [mermaid] = await Promise.all([load(), fonts()]);
  const id = `plainpath${++seq}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return tidy(svg);
  } finally {
    document.getElementById(id)?.remove();
  }
}

/** Same diagram with SVG text labels instead of HTML ones, so it can be saved or rasterised. */
export function plainLabels(code: string): string {
  const config = "config:\n  htmlLabels: false\n  flowchart:\n    htmlLabels: false\n";
  // Diagrams from toMermaid always carry a config block in their front matter.
  return code.includes("\nconfig:\n")
    ? code.replace("\nconfig:\n", `\n${config}`)
    : `---\n${config}---\n${code}`;
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
