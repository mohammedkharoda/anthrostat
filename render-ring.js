// Renders ring-design candidates to a PNG so we can actually see them.
// Pure Node (no deps): supersampled arc drawing + minimal PNG encoder.
const fs = require("fs");
const zlib = require("zlib");

const BG = [0xf7, 0xec, 0xe3];
const TRACK = [196, 130, 96, 0.22];
const ACC = [0xd1, 0x60, 0x3d];
const ACC_LITE = [0xd9, 0x8a, 0x5f];

function blend(dst, i, rgb, a) {
  dst[i] = Math.round(dst[i] * (1 - a) + rgb[0] * a);
  dst[i + 1] = Math.round(dst[i + 1] * (1 - a) + rgb[1] * a);
  dst[i + 2] = Math.round(dst[i + 2] * (1 - a) + rgb[2] * a);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(c1, c2, t) { return [lerp(c1[0],c2[0],t), lerp(c1[1],c2[1],t), lerp(c1[2],c2[2],t)]; }

// Draw an arc ring into buf(W*H*3). angleStart/End in radians, 0 = top, clockwise.
function drawArc(buf, W, cx, cy, R, hw, aStart, aEnd, colorFn, cap) {
  const SS = 3; // supersample
  const x0 = Math.floor(cx - R - hw - 2), x1 = Math.ceil(cx + R + hw + 2);
  const y0 = Math.floor(cy - R - hw - 2), y1 = Math.ceil(cy + R + hw + 2);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      let hits = 0, cr = 0, cg = 0, cb = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          const dx = px - cx, dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < R - hw || dist > R + hw) continue;
          // angle from top, clockwise
          let ang = Math.atan2(dx, -dy); // 0 at top, + clockwise
          if (ang < 0) ang += Math.PI * 2;
          let inside = ang >= aStart && ang <= aEnd;
          if (!inside && cap === "round") {
            // round caps: circle at each end centre
            for (const a of [aStart, aEnd]) {
              const ex = cx + R * Math.sin(a), ey = cy - R * Math.cos(a);
              if ((px - ex) ** 2 + (py - ey) ** 2 <= hw * hw) { inside = true; break; }
            }
          }
          if (inside) {
            const t = aEnd > aStart ? (ang - aStart) / (aEnd - aStart) : 0;
            const col = colorFn(Math.max(0, Math.min(1, t)));
            hits++; cr += col[0]; cg += col[1]; cb += col[2];
          }
        }
      }
      if (hits) {
        const a = hits / (SS * SS);
        const i = (y * W + x) * 3;
        blend(buf, i, [cr / hits, cg / hits, cb / hits], a);
      }
    }
  }
}

function drawRing(buf, W, cx, cy, pct, opts) {
  const R = opts.R, hw = opts.hw;
  const ta = opts.trackAlpha != null ? opts.trackAlpha : TRACK[3];
  // track (full ring)
  drawArc(buf, W, cx, cy, R, hw, 0, Math.PI * 2, () => [
    BG[0] * (1 - ta) + TRACK[0] * ta,
    BG[1] * (1 - ta) + TRACK[1] * ta,
    BG[2] * (1 - ta) + TRACK[2] * ta,
  ], "butt");
  // progress — near-full snaps to a clean closed ring to avoid cap crowding
  let end = (pct / 100) * Math.PI * 2;
  const cap = pct >= 99 ? "butt" : opts.cap;
  if (pct >= 99) end = Math.PI * 2;
  const colorFn = opts.gradient ? (t) => lerpC(ACC_LITE, ACC, t) : () => ACC;
  drawArc(buf, W, cx, cy, R, hw, 0.0001, Math.max(0.0002, end), colorFn, cap);
  // Optional: round only the LEADING tip (flat start stays anchored at top).
  if (opts.leadCap && pct > 1 && pct < 99) {
    const ex = cx + R * Math.sin(end), ey = cy - R * Math.cos(end);
    const col = opts.gradient ? lerpC(ACC_LITE, ACC, 1) : ACC;
    const SS = 3;
    for (let y = Math.floor(ey - hw - 2); y < Math.ceil(ey + hw + 2); y++)
      for (let x = Math.floor(ex - hw - 2); x < Math.ceil(ex + hw + 2); x++) {
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if ((px - ex) ** 2 + (py - ey) ** 2 <= hw * hw) hits++;
        }
        if (hits) blend(buf, (y * W + x) * 3, col, hits / (SS * SS));
      }
  }
}

// ---- compose a grid: rows = designs, cols = [24%, 93%] ----
const CW = 130, CH = 130, COLS = 5, ROWS = 1, PAD = 6;
const W = CW * COLS, H = CH * ROWS;
const buf = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { buf[i*3]=BG[0]; buf[i*3+1]=BG[1]; buf[i*3+2]=BG[2]; }

// FINAL app spec (matches r37/stroke6 proportions).
const FINAL = { R: 50, hw: 4, cap: "butt", gradient: true, trackAlpha: 0.34, leadCap: true };
const pcts = [5, 24, 60, 93, 100];
pcts.forEach((p, c) => drawRing(buf, W, c * CW + CW / 2, CH / 2, p, FINAL));

// ---- PNG encode (RGB) ----
function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const comp = zlib.deflateSync(raw, { level: 9 });
  const T = (() => { const t = new Uint32Array(256); for (let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t; })();
  const crc = (b) => { let c=0xffffffff; for (let i=0;i<b.length;i++) c=T[(c^b[i])&0xff]^(c>>>8); return (c^0xffffffff)>>>0; };
  const chunk = (type, data) => { const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0); const t=Buffer.from(type,"ascii"); const cc=Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t,data]))>>>0,0); return Buffer.concat([len,t,data,cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR",ihdr), chunk("IDAT",comp), chunk("IEND",Buffer.alloc(0))]);
}
fs.writeFileSync(__dirname + "/ring-preview.png", png(buf, W, H));
console.log("wrote ring-preview.png  (rows: A=butt, B=round, C=thin+round+gradient; cols: 24%, 93%)");
