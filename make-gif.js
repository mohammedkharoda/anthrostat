// Dev tool: stitch the captured PNG frames into an animated demo GIF.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const { GIFEncoder, quantize, applyPalette } = require("gifenc");

const DIR = process.argv[2];
const OUT = process.argv[3];

// [filename, hold-ms]
const SEQUENCE = [
  ["01-main.png", 1400],
  ["02-hover-refresh.png", 500],
  ["03-settings-mid.png", 120],
  ["04-settings-open.png", 1300],
  ["05-alerts-off.png", 900],
  ["06-alerts-on.png", 900],
  ["07-back-main.png", 300],
  ["08-hold.png", 1600],
];

function loadPNG(file) {
  const data = fs.readFileSync(path.join(DIR, file));
  return PNG.sync.read(data);
}

async function main() {
  const gif = GIFEncoder();
  let w, h;

  for (const [file, delayMs] of SEQUENCE) {
    const png = loadPNG(file);
    if (!w) {
      w = png.width;
      h = png.height;
    }
    const rgba = png.data; // already RGBA
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, w, h, { palette, delay: delayMs });
  }

  gif.finish();
  const bytes = gif.bytes();
  fs.writeFileSync(OUT, Buffer.from(bytes));
  console.log(`wrote ${OUT} (${(bytes.length / 1e6).toFixed(2)} MB, ${w}x${h})`);
}

main();
