import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync, inflateSync } from "node:zlib";
import {
  addPngSource,
  addSvgSource,
  readPngSource,
  readSvgSource,
  scriptFromFile,
} from "./embed.ts";

const SOURCE = 'Title: Fish & <chips>\nScreen: Home\n  Text: "æøå" → ✓\n';

// A real, valid 1x1 PNG built here so the test needs no fixture files.
function tinyPng(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "latin1");
    Buffer.from(data).copy(out, 8);
    // CRC over type + data, computed the slow, obvious way.
    let crc = 0xffffffff;
    for (const byte of out.subarray(4, 8 + data.length)) {
      crc ^= byte;
      for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

test("svg exports carry the script", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g/></svg>';
  const tagged = addSvgSource(svg, SOURCE);
  assert.match(
    tagged,
    /^<svg[^>]*><metadata id="plainpath-source">Title: Fish &amp; &lt;chips&gt;/,
  );
  assert.equal(readSvgSource(tagged), SOURCE);
  assert.equal(scriptFromFile(new TextEncoder().encode(tagged)), SOURCE);
  assert.equal(readSvgSource(svg), null);
});

test("png exports carry the script and stay valid", () => {
  const png = tinyPng();
  const tagged = addPngSource(png, SOURCE);
  assert.equal(readPngSource(tagged), SOURCE);
  assert.equal(scriptFromFile(tagged), SOURCE);
  assert.equal(readPngSource(png), null);
  // Every chunk still has a correct CRC, the image data is untouched and IEND stays last.
  const types: string[] = [];
  const bytes = Buffer.from(tagged);
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    types.push(bytes.subarray(at + 4, at + 8).toString("latin1"));
    assert.equal(
      bytes.readUInt32BE(at + 8 + length),
      crc32(bytes.subarray(at + 4, at + 8 + length)),
    );
    at += 12 + length;
  }
  assert.deepEqual(types, ["IHDR", "IDAT", "iTXt", "IEND"]);
  const idat = Buffer.from(tagged.subarray(8 + 25 + 8, 8 + 25 + 8 + 12));
  assert.deepEqual([...inflateSync(idat)], [0, 255, 0, 0]);
});

test("plain scripts open as they are", () => {
  assert.equal(scriptFromFile(new TextEncoder().encode(SOURCE)), SOURCE);
});
