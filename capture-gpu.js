// Same as capture.js but WITH hardware acceleration (matches the installed app),
// so we can reproduce GPU-only compositing artifacts.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const OUT = process.argv[2] || path.join(__dirname, "capture-gpu.png");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 374,
    height: 986,
    show: false,
    backgroundColor: "#2b2b2b",
    webPreferences: {},
  });
  await win.loadFile(path.join(__dirname, "src", "index.html"));
  await new Promise((r) => setTimeout(r, 1800));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log("wrote " + OUT);
  app.quit();
});
