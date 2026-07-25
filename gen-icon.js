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

// ---------- downsample (box filter) for the small ICO frames ----------
function downsample(src, srcSize, dstSize) {
  const dst = Buffer.alloc(dstSize * dstSize * 4);
  const scale = srcSize / dstSize;
  for (let y = 0; y < dstSize; y++) {
    const y0 = Math.floor(y * scale),
      y1 = Math.max(y0 + 1, Math.floor((y + 1) * scale));
    for (let x = 0; x < dstSize; x++) {
      const x0 = Math.floor(x * scale),
        x1 = Math.max(x0 + 1, Math.floor((x + 1) * scale));
      let r = 0,
        g = 0,
        b = 0,
        a = 0,
        n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const si = (sy * srcSize + sx) * 4;
          r += src[si];
          g += src[si + 1];
          b += src[si + 2];
          a += src[si + 3];
          n++;
        }
      }
      const di = (y * dstSize + x) * 4;
      dst[di] = Math.round(r / n);
      dst[di + 1] = Math.round(g / n);
      dst[di + 2] = Math.round(b / n);
      dst[di + 3] = Math.round(a / n);
    }
  }
  return dst;
}

// ---------- classic uncompressed 32bpp DIB frame (for small ICO sizes) ----------
// Explorer's small-icon paths (Desktop, Start Menu, taskbar) often fail to
// downscale a lone PNG-compressed ICO frame and silently show a blank icon,
// so 16/32/48 ship as plain bitmaps; only the 256 frame uses PNG (Vista+).
function dibFrame(rgba, size) {
  const rowBytes = size * 4; // 32bpp rows are always 4-byte aligned
  const andRowBytes = Math.ceil(size / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // doubled: XOR + AND mask
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(size * size * 4, 20);

  const xor = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y; // DIB rows are bottom-up
    for (let x = 0; x < size; x++) {
      const si = (srcY * size + x) * 4;
      const di = y * rowBytes + x * 4;
      xor[di] = rgba[si + 2]; // B
      xor[di + 1] = rgba[si + 1]; // G
      xor[di + 2] = rgba[si]; // R
      xor[di + 3] = rgba[si + 3]; // A
    }
  }
  const and = Buffer.alloc(andRowBytes * size); // all-zero: alpha channel handles transparency
  return Buffer.concat([header, xor, and]);
}

// ---------- assemble multi-resolution ICO ----------
const smallSizes = [16, 32, 48];
const frames = smallSizes.map((size) => ({
  size,
  data: dibFrame(downsample(buf, S, size), size),
}));
frames.push({ size: 256, data: pngBuf });

const dir = Buffer.alloc(6);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type = icon
dir.writeUInt16LE(frames.length, 4);

let offset = 6 + frames.length * 16;
const entries = [];
for (const f of frames) {
  const entry = Buffer.alloc(16);
  entry[0] = f.size === 256 ? 0 : f.size;
  entry[1] = f.size === 256 ? 0 : f.size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(f.data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += f.data.length;
  entries.push(entry);
}

fs.writeFileSync(
  path.join(outDir, "icon.ico"),
  Buffer.concat([dir, ...entries, ...frames.map((f) => f.data)])
);

console.log(
  "wrote build/icon.png and build/icon.ico (sizes: " +
    frames.map((f) => f.size).join(", ") +
    ")"
);
