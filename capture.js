// Dev tool: render src/index.html in a real Electron window and save a PNG,
// so we can actually see the UI. Uses the renderer's built-in mock fallback
// (no preload => window.battery undefined => sample data).
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

app.disableHardwareAcceleration();

const OUT = process.argv[2] || path.join(__dirname, "capture.png");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 374,
    height: 986,
    show: false,
    backgroundColor: "#2b2b2b", // neutral behind rounded corners
    webPreferences: {},
  });
  await win.loadFile(path.join(__dirname, "src", "index.html"));
  await new Promise((r) => setTimeout(r, 1600));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log("wrote " + OUT);
  app.quit();
});
