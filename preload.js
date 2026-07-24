const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("battery", {
  getUsage: () => ipcRenderer.invoke("get-usage"),
  setTrayIcon: (dataUrl) => ipcRenderer.send("tray-icon", dataUrl),
  setTrayTooltip: (text) => ipcRenderer.send("tray-tooltip", text),
  hidePopover: () => ipcRenderer.send("hide-popover"),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (patch) => ipcRenderer.invoke("set-settings", patch),
  reconnect: () => ipcRenderer.invoke("reconnect"),
});
