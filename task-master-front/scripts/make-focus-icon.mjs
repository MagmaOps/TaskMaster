// Generates a tiny placeholder "focus" icon (concentric target) PNG for the
// Focus selector pill. Replace with real art in the branding pass.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

const SIZE = 64;
const cx = (SIZE - 1) / 2;
const cy = (SIZE - 1) / 2;
const indigo = [79, 70, 229];
const transparent = [0, 0, 0, 0];

// RGBA target: filled center dot + a ring, indigo on transparent.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0; // filter byte
  for (let x = 0; x < SIZE; x++) {
    const d = Math.hypot(x - cx, y - cy);
    const isDot = d <= 9;
    const isRing = d >= 18 && d <= 24;
    const [r, g, b, a] = isDot || isRing ? [...indigo, 255] : transparent;
    const px = rowStart + 1 + x * 4;
    raw[px] = r;
    raw[px + 1] = g;
    raw[px + 2] = b;
    raw[px + 3] = a;
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });
writeFileSync(new URL('focus.png', outDir), png);
console.log('Focus icon written to public/icons/focus.png');
