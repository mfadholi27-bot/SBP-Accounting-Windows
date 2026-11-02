const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sbp", {
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  saveDatabase: () => ipcRenderer.invoke("db:save"),
  query: (sql, params = []) => ipcRenderer.invoke("db:query", sql, params),
  createBackup: () => ipcRenderer.invoke("backup:create")
});
