const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sbpDesktop", {
  version: () => ipcRenderer.invoke("app:version"),
  summary: () => ipcRenderer.invoke("db:summary"),
  backup: () => ipcRenderer.invoke("db:backup")
});
