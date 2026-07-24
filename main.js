const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  Notification,
} = require("electron");
const path = require("path");
const { getUsageData } = require("./src/data");
const settings = require("./src/settings");
const account = require("./src/account");

let tray = null;
let popover = null;
let iconRenderer = null; // hidden window used only to rasterise the tray icon

// A tiny transparent placeholder so the tray has something before the first
// real icon arrives from the renderer.
const PLACEHOLDER = nativeImage.createFromDataURL(
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
);

function createPopover() {
  popover = new BrowserWindow({
    width: 374,
    height: 986,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popover.loadFile(path.join(__dirname, "src", "index.html"));

  // Hide when it loses focus, just like a real menu-bar popover.
  popover.on("blur", () => {
    if (popover && popover.isVisible()) popover.hide();
  });
}

function positionPopover() {
  const { x, y } = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint({ x, y });
  const { width, height, x: dx, y: dy } = display.workArea;
  const bounds = popover.getBounds();
  // Anchor to the bottom-right (where the Windows tray lives), with a margin.
  const posX = Math.round(dx + width - bounds.width - 12);
  const posY = Math.round(dy + height - bounds.height - 12);
  popover.setPosition(posX, posY, false);
}

function togglePopover() {
  if (!popover) return;
  if (popover.isVisible()) {
    popover.hide();
  } else {
    positionPopover();
    popover.show();
    popover.focus();
  }
}

let trayMenu = null;

function buildTrayMenu() {
  trayMenu = Menu.buildFromTemplate([
    { label: "Open", click: () => togglePopover() },
    {
      label: "Start at login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) =>
        app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  return trayMenu;
}

function createTray() {
  tray = new Tray(PLACEHOLDER);
  tray.setToolTip("Anthrostat");
  buildTrayMenu();
  tray.on("click", () => togglePopover());
  tray.on("right-click", () => tray.popUpContextMenu(trayMenu));
}

// The hidden window renders a canvas battery-glyph and hands us a data URL,
// so the tray icon shows the live percentage with no native dependencies.
function createIconRenderer() {
  iconRenderer = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  iconRenderer.loadFile(path.join(__dirname, "src", "icon.html"));
}

// IPC: renderer asks for data.
ipcMain.handle("get-usage", () => getUsageData());

// IPC: a renderer sends a rasterised tray icon (data URL).
ipcMain.on("tray-icon", (_e, dataUrl) => {
  if (!tray) return;
  const img = nativeImage.createFromDataURL(dataUrl);
  tray.setImage(img);
});

// IPC: update the tooltip text.
ipcMain.on("tray-tooltip", (_e, text) => {
  if (tray) tray.setToolTip(text);
});

// IPC: popover asked to close itself.
ipcMain.on("hide-popover", () => {
  if (popover) popover.hide();
});

// IPC: reconnect (retry live; refresh the token if needed).
ipcMain.handle("reconnect", () => account.reconnect());

// ---- Usage alerts ----
// Per-metric armed state: true = currently over (already alerted),
// false = under & re-armed, null = unknown (startup).
const alertState = { session: null, weekly: null };
const ICON_PATH = path.join(__dirname, "build", "icon.png");

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON_PATH, silent: false });
  n.on("click", () => {
    if (popover) {
      positionPopover();
      popover.show();
      popover.focus();
    }
  });
  n.show();
}

function checkMetric(key, label, pct, thr) {
  if (pct == null || Number.isNaN(pct)) return;
  const over = pct >= thr;
  const prev = alertState[key];
  if (over && prev !== true) {
    notify(
      `Claude ${label} at ${pct}%`,
      `You've crossed ${thr}% of your ${label.toLowerCase()} limit.`
    );
    alertState[key] = true;
  } else if (!over) {
    // Re-arm once it drops a few points below (hysteresis avoids flapping).
    if (pct < thr - 3) alertState[key] = false;
    else if (prev === null) alertState[key] = false;
  }
}

function checkAlerts(data) {
  if (!settings.get("alertsEnabled")) return;
  const thr = Number(settings.get("alertThreshold")) || 80;
  checkMetric("session", "Session (5h)", data.session && data.session.usedPct, thr);
  checkMetric("weekly", "Weekly (7d)", data.weekly && data.weekly.usedPct, thr);
}

let monitorTimer = null;
async function pollAndAlert() {
  try {
    checkAlerts(await getUsageData());
  } catch {
    /* ignore transient errors */
  }
}
function startMonitor() {
  if (monitorTimer) clearInterval(monitorTimer);
  pollAndAlert(); // initial check shortly after launch
  monitorTimer = setInterval(pollAndAlert, 60000);
}

// IPC: settings read/write (only whitelisted keys are exposed).
ipcMain.handle("get-settings", () => ({
  liveEnabled: settings.get("liveEnabled"),
  liveTtlSeconds: settings.get("liveTtlSeconds"),
  monthlyBudgetUSD: settings.get("monthlyBudgetUSD"),
  alertsEnabled: settings.get("alertsEnabled"),
  alertThreshold: settings.get("alertThreshold"),
  startAtLogin: app.getLoginItemSettings().openAtLogin,
}));

ipcMain.handle("set-settings", (_e, patch) => {
  if (patch && "startAtLogin" in patch) {
    app.setLoginItemSettings({ openAtLogin: !!patch.startAtLogin, openAsHidden: true });
    delete patch.startAtLogin;
  }
  settings.update(patch || {});
  // Keep the tray checkbox in sync.
  if (tray) buildTrayMenu();
  return {
    liveEnabled: settings.get("liveEnabled"),
    liveTtlSeconds: settings.get("liveTtlSeconds"),
    monthlyBudgetUSD: settings.get("monthlyBudgetUSD"),
    alertsEnabled: settings.get("alertsEnabled"),
    alertThreshold: settings.get("alertThreshold"),
    startAtLogin: app.getLoginItemSettings().openAtLogin,
  };
});

app.whenReady().then(() => {
  // Required on Windows so notifications show the app name/icon correctly.
  app.setAppUserModelId("com.local.anthrostat");

  createTray();
  createPopover();
  createIconRenderer();
  startMonitor();

  // On Windows, avoid a dock/taskbar entry.
  if (app.dock) app.dock.hide();
});

// Keep running with no windows — it's a tray app.
app.on("window-all-closed", (e) => {
  e.preventDefault();
});
