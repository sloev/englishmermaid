// Saving, opening, exporting and share links. Uses the File System Access API
// where the browser has it (save back to the same file) and falls back to
// plain downloads / file inputs everywhere else.

import { scriptFromFile } from "./embed";

export const EXTENSION = ".plainpath";

type Handle = {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
};

type PickerWindow = Window & {
  showSaveFilePicker?: (options: unknown) => Promise<Handle>;
  showOpenFilePicker?: (options: unknown) => Promise<Handle[]>;
  launchQueue?: { setConsumer(consumer: (params: { files: Handle[] }) => void): void };
};

export type FileHandle = Handle;

const TYPES = [{ description: "Plainpath script", accept: { "text/plain": [EXTENSION, ".txt"] } }];
// Exported SVGs and PNGs carry their script, so they open for editing too.
const OPEN_TYPES = [
  {
    description: "Plainpath script or exported picture",
    accept: {
      "text/plain": [EXTENSION, ".txt", ".md"],
      "image/svg+xml": [".svg"],
      "image/png": [".png"],
    },
  },
];

export type Opened = { text: string | null; handle: Handle | null; name: string };

/** The script in a file; pictures never get a handle, so Save can't overwrite them. */
export async function readScript(file: File, handle: Handle | null = null): Promise<Opened> {
  const text = scriptFromFile(new Uint8Array(await file.arrayBuffer()));
  const picture = /\.(?:svg|png)$/i.test(file.name) || /^image\//.test(file.type);
  return { text, handle: picture ? null : handle, name: file.name };
}

const picker = () => window as PickerWindow;

export function fileName(title: string | null) {
  const base =
    (title ?? "untitled")
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "untitled";
  return base.toLowerCase();
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function download(name: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves to `handle` if given, otherwise asks where. Returns the handle (null after a plain download, undefined if cancelled). */
export async function saveText(
  text: string,
  suggested: string,
  handle: Handle | null,
): Promise<Handle | null | undefined> {
  const show = picker().showSaveFilePicker;
  if (!handle && !show) {
    download(suggested + EXTENSION, text);
    return null;
  }
  try {
    const target = handle ?? (await show!({ suggestedName: suggested + EXTENSION, types: TYPES }));
    const writable = await target.createWritable();
    await writable.write(text);
    await writable.close();
    return target;
  } catch (error) {
    if (isAbort(error)) return undefined;
    throw error;
  }
}

export async function openText(): Promise<Opened | null> {
  const show = picker().showOpenFilePicker;
  if (show) {
    try {
      const [handle] = await show({ types: OPEN_TYPES, multiple: false });
      return readScript(await handle.getFile(), handle);
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: `${EXTENSION},.txt,.md,text/plain,.svg,image/svg+xml,.png,image/png`,
    });
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      resolve(file ? await readScript(file) : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** Files opened from the OS when Plainpath is installed as an app. */
export function onLaunchFile(open: (text: string, handle: Handle) => void) {
  picker().launchQueue?.setConsumer(async ({ files }) => {
    const handle = files[0];
    if (handle) open(await (await handle.getFile()).text(), handle);
  });
}

/** Rasterises a Mermaid SVG (rendered without HTML labels) to a PNG at 2x. */
export async function svgToPng(svg: string): Promise<Blob> {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const box = doc
    .getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  const width = box?.[2] || Number.parseFloat(doc.getAttribute("width") ?? "") || 800;
  const height = box?.[3] || Number.parseFloat(doc.getAttribute("height") ?? "") || 600;
  doc.setAttribute("width", String(width));
  doc.setAttribute("height", String(height));
  const url = URL.createObjectURL(new Blob([doc.outerHTML], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = 2;
    const pad = 24;
    const canvas = Object.assign(document.createElement("canvas"), {
      width: (width + pad * 2) * scale,
      height: (height + pad * 2) * scale,
    });
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0e0d0b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, pad * scale, pad * scale, width * scale, height * scale);
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ------------------------------------------------------------- share links
//   #text=<url-encoded script>   plain, easy for people and agents to build
//   #s=<base64url deflate>       compact, what the app itself produces
//   &view=flow|story             optional starting view

const toBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function shareUrl(text: string, view: string): Promise<string> {
  const base = location.href.split("#")[0];
  try {
    const packed = await pipe(new TextEncoder().encode(text), new CompressionStream("deflate-raw"));
    return `${base}#s=${toBase64Url(packed)}&view=${view}`;
  } catch {
    return `${base}#text=${encodeURIComponent(text)}&view=${view}`;
  }
}

export async function readShareHash(hash: string): Promise<{ text?: string; view?: string }> {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const view = params.get("view") ?? undefined;
  const plain = params.get("text");
  if (plain != null) return { text: plain, view };
  const packed = params.get("s");
  if (!packed) return { view };
  try {
    const bytes = await pipe(fromBase64Url(packed), new DecompressionStream("deflate-raw"));
    return { text: new TextDecoder().decode(bytes), view };
  } catch {
    return { view };
  }
}
