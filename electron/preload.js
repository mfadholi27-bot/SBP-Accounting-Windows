const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sbpDesktop", {
  version: () => ipcRenderer.invoke("app:version"),
  summary: () => ipcRenderer.invoke("db:summary"),
  backup: () => ipcRenderer.invoke("db:backup"),
  listAccounts: (keyword) => ipcRenderer.invoke("accounts:list", keyword || ""),
  saveAccount: (account) => ipcRenderer.invoke("accounts:save", account),
  setAccountActive: (payload) => ipcRenderer.invoke("accounts:set-active", payload),
  deleteAccount: (id) => ipcRenderer.invoke("accounts:delete", id),
  listJournals: (filters) => ipcRenderer.invoke("journals:list", filters || {}),
  saveJournal: (journal) => ipcRenderer.invoke("journals:save", journal),
  deleteDraftJournal: (id) => ipcRenderer.invoke("journals:delete-draft", id),
  listBudgets: (year) => ipcRenderer.invoke("budgets:list", year),
  saveBudget: (payload) => ipcRenderer.invoke("budgets:save", payload),
  deleteBudget: (payload) => ipcRenderer.invoke("budgets:delete", payload),
  importAccounts: (payload) => ipcRenderer.invoke("imports:accounts", payload),
  listNptrans: (filters) => ipcRenderer.invoke("nptrans:list", filters),
  importNptrans: (payload) => ipcRenderer.invoke("nptrans:import", payload),
  importOpeningBalances: (payload) => ipcRenderer.invoke("imports:opening-balances", payload),
  listOpeningBalances: (period) => ipcRenderer.invoke("opening:list", period),
  saveOpeningBalance: (payload) => ipcRenderer.invoke("opening:save", payload)
});
