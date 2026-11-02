// Generates simple placeholder PNG icons (built-in modules only).
// Usage: node web/scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
mkdirSync(out, { recursive: true });

const BG = [0x1f, 0x5f, 0x8b];
const FG = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// A "page" glyph: white rounded rectangle with three blue text lines.
// `scale` shrinks the glyph (maskable icons need content inside the safe zone).
function png(size, scale) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const half = (size * scale) / 2;
  const w = half * 0.72;
  const r = half * 0.12;
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      let inPage = dx <= w && dy <= half;
      if (inPage && dx > w - r && dy > half - r) {
        inPage = Math.hypot(dx - (w - r), dy - (half - r)) <= r;
      }
      let colour = inPage ? FG : BG;
      if (inPage) {
        const t = (y - (c - half)) / (half * 2); // 0..1 down the page
        const onLine = [0.25, 0.45, 0.65].some((l) => Math.abs(t - l) < 0.04);
        const lineW = t > 0.6 ? w * 0.6 : w * 0.7;
        if (onLine && dx <= lineW) colour = BG;
      }
      raw.set(colour, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const files = [
  ["icon-192.png", 192, 0.7],
  ["icon-512.png", 512, 0.7],
  ["icon-maskable-512.png", 512, 0.5],
  ["apple-touch-icon.png", 180, 0.7],
];
for (const [name, size, scale] of files) writeFileSync(join(out, name), png(size, scale));
console.log("wrote", files.map((f) => f[0]).join(", "));
