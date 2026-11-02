const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
let mainWindow;
let quitting = false;
app.setName("SBP Accounting V19");
function backupName(){return "SBP-V19-Windows-Backup-"+new Date().toISOString().replace(/[:.]/g,"-")+".json";}
async function readState(){
  if(!mainWindow) throw new Error("Jendela aplikasi belum siap");
  return mainWindow.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const r=indexedDB.open("sbp-accounting-v19",1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains("app")){resolve(null);return;}const q=db.transaction("app","readonly").objectStore("app").get("main");q.onsuccess=()=>resolve(q.result||null);q.onerror=()=>reject(q.error);};})`,true);
}
async function writeState(payload){
  const encoded=JSON.stringify(payload);
  const script=`new Promise((resolve,reject)=>{const data=${encoded};const r=indexedDB.open("sbp-accounting-v19",1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("app"))r.result.createObjectStore("app");};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction("app","readwrite");tx.objectStore("app").put(data,"main");tx.oncomplete=()=>{db.close();resolve(true);};tx.onerror=()=>reject(tx.error);};})`;
  await mainWindow.webContents.executeJavaScript(script,true);
}
function makePayload(state,type="desktop-manual"){
  const safe=JSON.parse(JSON.stringify(state));
  if(Array.isArray(safe?.npTemplate?.fields))safe.npTemplate.fields.forEach(f=>{if(f.raw&&typeof f.raw==="object"&&!Array.isArray(f.raw))f.raw=Object.values(f.raw);});
  return {app:"SBP Accounting",version:19,exportedAt:new Date().toISOString(),backupType:type,state:safe};
}
async function saveManualBackup(){
  const state=await readState();
  if(!state)return {ok:false,message:"Data V19 belum ditemukan pada penyimpanan aplikasi ini."};
  const choice=await dialog.showSaveDialog(mainWindow,{title:"Backup SBP Accounting V19",defaultPath:backupName(),filters:[{name:"Backup SBP V19",extensions:["json"]}]});
  if(choice.canceled||!choice.filePath)return {canceled:true};
  fs.writeFileSync(choice.filePath,JSON.stringify(makePayload(state),null,2),"utf8");
  return {ok:true,filePath:choice.filePath};
}
ipcMain.handle("sbp:backup",saveManualBackup);
ipcMain.handle("sbp:restore",async()=>{
  const choice=await dialog.showOpenDialog(mainWindow,{title:"Pulihkan Backup SBP V19",properties:["openFile"],filters:[{name:"Backup SBP V19",extensions:["json"]}]});
  if(choice.canceled||!choice.filePaths[0])return {canceled:true};
  const payload=JSON.parse(fs.readFileSync(choice.filePaths[0],"utf8"));
  if(payload?.app!=="SBP Accounting"||payload?.version!==19||!payload?.state||!Array.isArray(payload.state.accounts)||!Array.isArray(payload.state.journals))throw new Error("File bukan backup SBP Accounting V19 yang valid.");
  const current=await readState();
  if(current){const confirm=await dialog.showMessageBox(mainWindow,{type:"warning",buttons:["Batal","Buat backup lalu pulihkan"],defaultId:0,cancelId:0,title:"Lindungi data saat ini",message:"Database Windows berisi data. Sebelum restore, buat backup data saat ini?",detail:"Restore hanya mengganti data aplikasi Windows. Data GitHub/browser tidak disentuh."});if(confirm.response!==1)return {canceled:true};const backup=await dialog.showSaveDialog(mainWindow,{title:"Backup data Windows sebelum restore",defaultPath:backupName(),filters:[{name:"JSON",extensions:["json"]}]});if(backup.canceled||!backup.filePath)return {canceled:true};fs.writeFileSync(backup.filePath,JSON.stringify(makePayload(current,"pre-restore"),null,2),"utf8");}
  await writeState(payload.state);
  await mainWindow.webContents.reload();
  return {ok:true};
});
async function automaticBackup(){
  try{const state=await readState();if(!state)return;const dir=path.join(app.getPath("userData"),"Backups");fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,backupName());fs.writeFileSync(file,JSON.stringify(makePayload(state,"automatic-on-exit"),null,2),"utf8");const files=fs.readdirSync(dir).filter(n=>n.endsWith(".json")).map(n=>({n,p:path.join(dir,n),t:fs.statSync(path.join(dir,n)).mtimeMs})).sort((a,b)=>b.t-a.t);for(const old of files.slice(30))fs.unlinkSync(old.p);}catch(e){console.error("Automatic backup failed:",e);}
}
function createWindow(){
  mainWindow=new BrowserWindow({width:1500,height:950,minWidth:1100,minHeight:700,show:false,backgroundColor:"#f8faf9",webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.loadFile(path.join(__dirname,"../src/v19/index.html"));
  mainWindow.once("ready-to-show",()=>mainWindow.show());
  mainWindow.on("close",event=>{if(!quitting){event.preventDefault();quitting=true;automaticBackup().finally(()=>{if(mainWindow)mainWindow.destroy();});}});
  mainWindow.on("closed",()=>{mainWindow=null;});
}
const template=[{label:"File",submenu:[{label:"Backup Data Windows...",click:()=>mainWindow?.webContents.send("sbp:menu-backup")},{label:"Restore Backup...",click:()=>mainWindow?.webContents.send("sbp:menu-restore")},{type:"separator"},{role:"quit"}]},{label:"View",submenu:[{role:"reload"},{role:"toggleDevTools"},{type:"separator"},{role:"resetZoom"},{role:"zoomIn"},{role:"zoomOut"},{type:"separator"},{role:"togglefullscreen"}]}];
app.whenReady().then(()=>{Menu.setApplicationMenu(Menu.buildFromTemplate(template));createWindow();app.on("activate",()=>{if(BrowserWindow.getAllWindows().length===0)createWindow();});});
app.on("before-quit",event=>{if(quitting)return;event.preventDefault();quitting=true;automaticBackup().finally(()=>{if(mainWindow)mainWindow.destroy();else app.quit();});});
app.on("window-all-closed",()=>{if(process.platform!=="darwin"&&!quitting)app.quit();});
