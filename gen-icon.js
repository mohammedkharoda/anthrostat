// Generates build/icon.png (256x256) and build/icon.ico with no dependencies.
// Draws a warm circular "battery" glyph with a lightning bolt — the app icon.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const S = 256;
const buf = Buffer.alloc(S * S * 4); // RGBA

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const ia = a / 255;
  buf[i] = Math.round(buf[i] * (1 - ia) + r * ia);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - ia) + g * ia);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - ia) + b * ia);
  buf[i + 3] = Math.min(255, buf[i + 3] + a);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// --- circle with radial warm gradient ---
const cx = 128,
  cy = 128,
  R = 120;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const dx = x - cx,
      dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= R + 1) {
      const t = Math.min(1, d / R);
      // center #e8895c -> edge #c2410c
      const r = Math.round(lerp(0xe8, 0xc2, t));
      const g = Math.round(lerp(0x89, 0x41, t));
      const b = Math.round(lerp(0x5c, 0x0c, t));
      const edge = d > R ? 255 * (R + 1 - d) : 255; // 1px antialias
      set(x, y, r, g, b, Math.max(0, Math.min(255, edge)));
    }
  }
}

// --- lightning bolt (cream) via point-in-polygon ---
const bolt = [
  [150, 44],
  [92, 138],
  [124, 138],
  [104, 214],
  [176, 104],
  [138, 104],
];
function inPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1],
      xj = poly[j][0],
      yj = poly[j][1];
    const hit =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}
for (let y = 30; y < 226; y++) {
  for (let x = 80; x < 190; x++) {
    // supersample 2x2 for smooth edges
    let hits = 0;
    for (const oy of [0.25, 0.75])
      for (const ox of [0.25, 0.75])
        if (inPoly(x + ox, y + oy, bolt)) hits++;
    if (hits) set(x, y, 0xff, 0xf3, 0xe6, Math.round((hits / 4) * 255));
  }
}

// ---------- PNG encode ----------
function png(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const comp = zlib.deflateSync(raw, { level: 9 });
  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", comp),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const pngBuf = png(buf, S, S);
const outDir = path.join(__dirname, "build");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "icon.png"), pngBuf);

// ---------- ICO wrapper (PNG-embedded, Vista+) ----------
const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type = icon
dir.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry[0] = 0; // width 256 -> 0
entry[1] = 0; // height 256 -> 0
entry[2] = 0; // colors
entry[3] = 0; // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(pngBuf.length, 8);
entry.writeUInt32LE(6 + 16, 12); // offset
fs.writeFileSync(
  path.join(outDir, "icon.ico"),
  Buffer.concat([dir, entry, pngBuf])
);

console.log("wrote build/icon.png and build/icon.ico (" + pngBuf.length + " bytes png)");
