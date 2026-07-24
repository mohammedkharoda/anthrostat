// Dev tool: capture a sequence of PNG frames of the popover UI in different
// states, for stitching into a demo GIF. Uses the renderer's mock data.
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const OUT_DIR = process.argv[2] || path.join(__dirname, "gif-frames");
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 374,
    height: 986,
    x: -3000,
    y: -3000,
    show: false,
    frame: false,
    backgroundColor: "#2b2b2b",
    webPreferences: {},
  });
  await win.loadFile(path.join(__dirname, "src", "index.html"));
  // Show (off-screen, inactive) so Chromium treats the page as visible and
  // runs CSS transitions in real time instead of throttling a hidden window.
  win.showInactive();
  await new Promise((r) => setTimeout(r, 1200));

  async function shot(name) {
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: 374, height: 986 });
    fs.writeFileSync(path.join(OUT_DIR, name), img.toPNG());
    console.log("captured " + name);
  }

  // 1) Idle main view.
  await shot("01-main.png");
  await new Promise((r) => setTimeout(r, 200));

  // 2) Hover the refresh icon (visual feedback state).
  await win.webContents.executeJavaScript(`
    document.getElementById("refresh").dispatchEvent(new MouseEvent("mouseover", {bubbles:true}));
  `);
  await new Promise((r) => setTimeout(r, 150));
  await shot("02-hover-refresh.png");

  // 3) Open settings panel (mid-slide, sampled quickly after click).
  await win.webContents.executeJavaScript(`
    document.getElementById("settings-btn").click();
  `);
  await new Promise((r) => setTimeout(r, 90));
  await shot("03-settings-mid.png");
  await new Promise((r) => setTimeout(r, 300));
  await shot("04-settings-open.png");

  // 4) Toggle "Usage alerts" off, to show interactivity.
  await win.webContents.executeJavaScript(`
    document.getElementById("opt-alerts").click();
  `);
  await new Promise((r) => setTimeout(r, 200));
  await shot("05-alerts-off.png");

  // 5) Toggle it back on.
  await win.webContents.executeJavaScript(`
    document.getElementById("opt-alerts").click();
  `);
  await new Promise((r) => setTimeout(r, 200));
  await shot("06-alerts-on.png");

  // 6) Close settings, back to main view.
  await win.webContents.executeJavaScript(`
    document.getElementById("settings-back").click();
  `);
  await new Promise((r) => setTimeout(r, 350));
  await shot("07-back-main.png");
  await shot("08-hold.png");

  app.quit();
});
