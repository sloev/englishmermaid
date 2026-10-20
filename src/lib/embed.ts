// Keeps the Plainpath script inside exported pictures, so an exported SVG or
// PNG can be opened again and edited. Pure functions, no DOM.

const KEYWORD = "plainpath";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// ------------------------------------------------------------------- SVG

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");

/** Adds the script as a <metadata> element right inside the root <svg>. */
export function addSvgSource(svg: string, source: string): string {
  const open = /<svg\b[^>]*>/.exec(svg);
  if (!open) return svg;
  const at = open.index + open[0].length;
  const metadata = `<metadata id="${KEYWORD}-source">${escapeXml(source)}</metadata>`;
  return svg.slice(0, at) + metadata + svg.slice(at);
}

export function readSvgSource(svg: string): string | null {
  const match = new RegExp(`<metadata id="${KEYWORD}-source"[^>]*>([\\s\\S]*?)</metadata>`).exec(
    svg,
  );
  return match ? unescapeXml(match[1]) : null;
}

// ------------------------------------------------------------------- PNG

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const isPng = (bytes: Uint8Array) => PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);

/** Inserts an uncompressed UTF-8 iTXt chunk ("plainpath" → script) before IEND. */
export function addPngSource(png: Uint8Array, source: string): Uint8Array<ArrayBuffer> {
  if (!isPng(png)) return new Uint8Array(png);
  const encoder = new TextEncoder();
  // keyword \0, compression flag 0, method 0, empty language \0, empty translated keyword \0, text
  const data = new Uint8Array([
    ...encoder.encode(KEYWORD),
    0,
    0,
    0,
    0,
    0,
    ...encoder.encode(source),
  ]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(encoder.encode("iTXt"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  // IEND is always the last 12 bytes of a PNG.
  const end = png.length - 12;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, end));
  out.set(chunk, end);
  out.set(png.subarray(end), end + chunk.length);
  return out;
}

export function readPngSource(png: Uint8Array): string | null {
  if (!isPng(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const decoder = new TextDecoder();
  for (let at = 8; at + 12 <= png.length;) {
    const length = view.getUint32(at);
    const type = decoder.decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "iTXt" || type === "tEXt") {
      const zero = data.indexOf(0);
      if (decoder.decode(data.subarray(0, zero)) === KEYWORD) {
        if (type === "tEXt") return new TextDecoder("latin1").decode(data.subarray(zero + 1));
        // Skip compression flag and method, then the language tag and translated keyword.
        if (data[zero + 1] !== 0) return null;
        let text = zero + 3;
        text = data.indexOf(0, text) + 1;
        text = data.indexOf(0, text) + 1;
        return decoder.decode(data.subarray(text));
      }
    }
    if (type === "IEND") break;
    at += 12 + length;
  }
  return null;
}

// ------------------------------------------------------------------ files

/**
 * The script inside a file the user opened or dropped: a saved script, or a
 * Plainpath SVG / PNG export. Null when it is a picture without one.
 */
export function scriptFromFile(bytes: Uint8Array): string | null {
  if (isPng(bytes)) return readPngSource(bytes);
  const text = new TextDecoder().decode(bytes);
  if (/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/.test(text)) return readSvgSource(text);
  return text;
}
