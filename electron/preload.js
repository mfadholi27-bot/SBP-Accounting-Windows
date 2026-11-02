const {contextBridge,ipcRenderer}=require("electron");
contextBridge.exposeInMainWorld("sbpDesktop",{
  backup:()=>ipcRenderer.invoke("sbp:backup"),
  restore:()=>ipcRenderer.invoke("sbp:restore"),
  onMenuBackup:(callback)=>ipcRenderer.on("sbp:menu-backup",callback),
  onMenuRestore:(callback)=>ipcRenderer.on("sbp:menu-restore",callback)
});