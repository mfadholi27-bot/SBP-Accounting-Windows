/* BUILD V85 — Debit Note module and linked journal workflow */
/* SBP Accounting V19 — browser-only accounting core.
   Local persistence: IndexedDB. DBF export reuses a real source DBF schema as a safety requirement. */
const DB_NAME='sbp-accounting-v19', STORE='app', STATE_KEY='main';
const emptyState=()=>({accounts:[],journals:[],nptrans:[],openingBalances:[],debitNotes:[],annualBudgets:[],auditLogs:[],npTemplate:null,meta:{version:19}});
let state=emptyState(), editingId=null, editingAccountCode=null, pendingNpImport=null, auditBaseline=null;
const $=id=>document.getElementById(id);
const money=n=>'Rp '+Number(n||0).toLocaleString('id-ID',{maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),3000)}
function requireImportPassword(action){const value=prompt('Masukkan password PKS untuk '+action+':');if(value===null)return false;if(value!=='PKS123'){toast('Password salah. Proses import dibatalkan.');return false}return true}
function setMessage(id,msg,type=''){const el=$(id);el.textContent=msg;el.className='inline-message'+(type?' '+type:'')}
function dbOpen(){return new Promise((resolve,reject)=>{if(!('indexedDB'in window)){reject(new Error('IndexedDB tidak tersedia di browser ini'));return}const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
async function loadState(){try{const db=await dbOpen();const value=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get(STATE_KEY);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();state=value||emptyState()}catch(e){console.warn(e);try{state=JSON.parse(localStorage.getItem(DB_NAME))||emptyState()}catch{state=emptyState()}toast('Penyimpanan IndexedDB tidak tersedia; mode cadangan browser aktif.')} }
function auditClone(v){try{return JSON.parse(JSON.stringify(v))}catch{return String(v)}}
function auditKey(type,row,index){if(type==='accounts')return String(row.code??index);if(type==='journals')return String(row.id??row.number??index);if(type==='openingBalances')return String(row.period??'')+'|'+String(row.accountCode??index);if(type==='annualBudgets')return String(row.year??'')+'|'+String(row.accountCode??index);if(type==='nptrans')return String(row.id??[row.tanggal,row.nobukti,row.nourut,row.sandi,index].join('|'));return String(index)}
function collectAuditChanges(){if(!auditBaseline){auditBaseline=auditClone({accounts:state.accounts,journals:state.journals,nptrans:state.nptrans,openingBalances:state.openingBalances,debitNotes:state.debitNotes,annualBudgets:state.annualBudgets});return}const labels={accounts:'Master Akun',journals:'Jurnal',nptrans:'NPTRANS',openingBalances:'Saldo Awal',debitNotes:'Nota Debet',annualBudgets:'Anggaran Tahunan'};for(const type of Object.keys(labels)){const before=Array.isArray(auditBaseline[type])?auditBaseline[type]:[],after=Array.isArray(state[type])?state[type]:[],oldMap=new Map(before.map((x,i)=>[auditKey(type,x,i),x])),newMap=new Map(after.map((x,i)=>[auditKey(type,x,i),x]));for(const [key,row] of newMap){const old=oldMap.get(key);if(!old){state.auditLogs.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),action:'TAMBAH',entity:labels[type],entityId:key,summary:labels[type]+' ditambahkan: '+key,before:null,after:auditClone(row)});continue}if(JSON.stringify(old)!==JSON.stringify(row))state.auditLogs.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),action:'UBAH',entity:labels[type],entityId:key,summary:labels[type]+' diubah: '+key,before:auditClone(old),after:auditClone(row)})}for(const [key,row] of oldMap){if(!newMap.has(key))state.auditLogs.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),action:'HAPUS',entity:labels[type],entityId:key,summary:labels[type]+' dihapus: '+key,before:auditClone(row),after:null})}}if(state.auditLogs.length>10000)state.auditLogs.length=10000;auditBaseline=auditClone({accounts:state.accounts,journals:state.journals,nptrans:state.nptrans,openingBalances:state.openingBalances,debitNotes:state.debitNotes})}
async function persist(){collectAuditChanges();try{const db=await dbOpen();await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(state,STATE_KEY);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();queueAutoBackup()}catch(e){localStorage.setItem(DB_NAME,JSON.stringify(state));console.warn('Fallback localStorage',e);queueAutoBackup()}}
let backupDirectoryHandle=null,backupTimer=null,backupBusy=false,lastAutoBackupAt=0;
function makeBackupPayload(){const safeState=JSON.parse(JSON.stringify(state));if(safeState.npTemplate?.fields)safeState.npTemplate.fields.forEach(f=>{if(f.raw&&typeof f.raw==='object')f.raw=Array.from(f.raw)});return {app:'SBP Accounting',version:19,exportedAt:new Date().toISOString(),backupType:'automatic-or-manual',state:safeState}}
function backupFileName(date=new Date()){const p=n=>String(n).padStart(2,'0');return 'SBP-V19-'+date.getFullYear()+p(date.getMonth()+1)+p(date.getDate())+'-'+p(date.getHours())+p(date.getMinutes())+p(date.getSeconds())+'.json'}
async function writeBackupFile(dir,name,payload){const file=await dir.getFileHandle(name,{create:true});const writable=await file.createWritable();await writable.write(JSON.stringify(payload,null,2));await writable.close()}
async function saveDirectoryHandle(handle){const db=await dbOpen();await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(handle,'backupDirectoryHandle');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close()}
async function loadDirectoryHandle(){try{const db=await dbOpen();const handle=await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),r=tx.objectStore(STORE).get('backupDirectoryHandle');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error)});db.close();backupDirectoryHandle=handle}catch(e){console.warn('Tidak dapat memuat folder backup',e)}}
async function directoryPermission(handle,request=false){if(!handle)return 'denied';try{let p=await handle.queryPermission({mode:'readwrite'});if(p!=='granted'&&request)p=await handle.requestPermission({mode:'readwrite'});return p}catch{return 'denied'}}
async function runAutomaticBackup(reason='perubahan data'){if(!backupDirectoryHandle||backupBusy)return false;const permission=await directoryPermission(backupDirectoryHandle,false);if(permission!=='granted'){setMessage('backup-message','Izin folder backup belum aktif. Tekan “Hubungkan Folder Server” untuk mengaktifkannya kembali.','bad');return false}backupBusy=true;try{const payload=makeBackupPayload(),daily=await backupDirectoryHandle.getDirectoryHandle('BACKUP_HARIAN',{create:true}),latest=await backupDirectoryHandle.getDirectoryHandle('BACKUP_TERBARU',{create:true}),today=new Date(),dayName=today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');const dailyDir=await daily.getDirectoryHandle(dayName,{create:true});await writeBackupFile(latest,'SBP-Accounting-V19-TERBARU.json',payload);await writeBackupFile(dailyDir,backupFileName(today),payload);lastAutoBackupAt=Date.now();setMessage('backup-message','Backup otomatis berhasil: '+today.toLocaleString('id-ID')+'. Pemicu: '+reason+'.','good');return true}catch(e){console.warn('Backup otomatis gagal',e);setMessage('backup-message','Backup otomatis gagal: '+e.message+'. Data utama tetap tersimpan di laptop; periksa koneksi/izin folder server.','bad');return false}finally{backupBusy=false}}
function queueAutoBackup(){if(!backupDirectoryHandle)return;clearTimeout(backupTimer);backupTimer=setTimeout(()=>runAutomaticBackup('perubahan data'),1800)}
async function connectBackupFolder(){if(!('showDirectoryPicker'in window)){setMessage('backup-message','Browser ini belum mendukung pemilihan folder otomatis. Gunakan Chrome atau Edge versi desktop terbaru.','bad');return}try{const handle=await window.showDirectoryPicker({id:'sbp-accounting-backup',mode:'readwrite'});const permission=await directoryPermission(handle,true);if(permission!=='granted')throw Error('Izin tulis ke folder tidak diberikan.');backupDirectoryHandle=handle;await saveDirectoryHandle(handle);setMessage('backup-message','Folder backup berhasil dihubungkan. Sedang membuat backup pertama…','good');await runAutomaticBackup('hubungkan folder pertama kali')}catch(e){if(e.name!=='AbortError')setMessage('backup-message','Folder belum terhubung: '+e.message,'bad')}}
async function reconnectBackupFolder(){if(!backupDirectoryHandle){await connectBackupFolder();return}const permission=await directoryPermission(backupDirectoryHandle,true);if(permission==='granted'){setMessage('backup-message','Izin folder server aktif kembali. Membuat backup…','good');await runAutomaticBackup('izin folder diaktifkan kembali')}else await connectBackupFolder()}

let archiveReadState=null,archiveReadName='';
function archiveReadMoney(v){return money(Number(v||0))}
function archiveReadAccount(code){return archiveReadState?.accounts?.find(x=>String(x.code)===String(code))||{code,name:'(Akun tidak ditemukan)'}}
function archiveReadJournals(){
 const q=($('archive-read-search').value||'').toLowerCase().trim(),period=$('archive-read-period').value;
 const rows=(archiveReadState.journals||[]).filter(j=>(!period||String(j.date||'').slice(0,7)===period)&&[j.number,j.description,j.date,j.status].join(' ').toLowerCase().includes(q)).sort((x,y)=>String(y.date||'').localeCompare(String(x.date||'')));
 $('archive-read-summary').textContent=rows.length+' jurnal ditemukan dalam arsip · '+archiveReadName;
 $('archive-read-table').innerHTML=rows.length?'<table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th>Status</th><th>Baris</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>'+rows.map(j=>{const d=(j.lines||[]).reduce((n,l)=>n+Number(l.debit||0),0),c=(j.lines||[]).reduce((n,l)=>n+Number(l.credit||0),0);return '<tr><td>'+esc(j.date||'')+'</td><td><b>'+esc(j.number||'')+'</b></td><td>'+esc(j.description||'')+'</td><td>'+esc(j.status||'TERPOSTING')+'</td><td>'+((j.lines||[]).length)+'</td><td>'+archiveReadMoney(d)+'</td><td>'+archiveReadMoney(c)+'</td></tr><tr><td colspan="7"><details><summary>Lihat rincian akun</summary><table><thead><tr><th>SANDI</th><th>Nama akun</th><th>Keterangan</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>'+(j.lines||[]).map(l=>'<tr><td>'+esc(l.code)+'</td><td>'+esc(archiveReadAccount(l.code).name)+'</td><td>'+esc(l.note||'')+'</td><td>'+archiveReadMoney(l.debit)+'</td><td>'+archiveReadMoney(l.credit)+'</td></tr>').join('')+'</tbody></table></details></td></tr>'}).join('')+'</tbody></table>':'<div class="empty">Tidak ada jurnal yang cocok.</div>';
}
function archiveReadNptrans(){
 const q=($('archive-read-search').value||'').toLowerCase().trim(),rows=(archiveReadState.nptrans||[]).filter(r=>[r.sandi,r.tanggal,r.nobukti,r.nourut,r.ket,String(r.jumlah)].join(' ').toLowerCase().includes(q));
 const total=rows.reduce((n,r)=>n+Number(r.jumlah||0),0);$('archive-read-summary').textContent=rows.length.toLocaleString('id-ID')+' baris NPTRANS · Total nilai '+archiveReadMoney(total);
 $('archive-read-table').innerHTML=rows.length?'<table><thead><tr><th>SANDI</th><th>Tanggal</th><th>No. Bukti</th><th>No. Urut</th><th>Keterangan</th><th>Jumlah</th><th>Nama Akun</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.sandi||'')+'</td><td>'+esc(r.tanggal||'')+'</td><td>'+esc(r.nobukti||'')+'</td><td>'+esc(r.nourut||'')+'</td><td>'+esc(r.ket||'')+'</td><td>'+archiveReadMoney(r.jumlah)+'</td><td>'+esc(archiveReadAccount(r.sandi).name)+'</td></tr>').join('')+'</tbody></table>':'<div class="empty">Tidak ada data NPTRANS yang cocok.</div>';
}
function archiveReadLedger(){
 const period=$('archive-read-period').value,code=$('archive-read-account').value;
 if(!period||!code){$('archive-read-summary').textContent='Pilih bulan dan akun untuk melihat Buku Besar.';$('archive-read-table').innerHTML='<div class="empty">Periode dan akun diperlukan.</div>';return}
 const acc=archiveReadAccount(code),opening=(archiveReadState.openingBalances||[]).find(x=>x.period===period&&String(x.accountCode)===String(code)),netOpen=opening?Number(opening.debit||0)-Number(opening.credit||0):0;
 const rows=[{date:period+'-01',number:'SALDO AWAL',description:'Saldo awal periode',debit:Math.max(netOpen,0),credit:Math.max(-netOpen,0),kind:'opening'}];
 (archiveReadState.journals||[]).filter(j=>(isPostedJournal(j))&&String(j.date||'').slice(0,7)===period).forEach(j=>(j.lines||[]).filter(l=>String(l.code)===String(code)).forEach(l=>rows.push({date:String(j.date||''),number:String(j.number||''),description:String(j.description||'')+(l.note?' · '+l.note:''),debit:Number(l.debit||0),credit:Number(l.credit||0),kind:'movement'})));
 rows.sort((x,y)=>x.date.localeCompare(y.date)||(x.kind==='opening'?-1:y.kind==='opening'?1:0)||x.number.localeCompare(y.number));
 let balance=0;rows.forEach(r=>{balance+=r.debit-r.credit;r.bd=Math.max(balance,0);r.bc=Math.max(-balance,0)});
 const debit=rows.filter(x=>x.kind==='movement').reduce((n,x)=>n+x.debit,0),credit=rows.filter(x=>x.kind==='movement').reduce((n,x)=>n+x.credit,0);
 $('archive-read-summary').textContent=acc.code+' · '+acc.name+' | Saldo awal '+archiveReadMoney(netOpen)+' | Mutasi D '+archiveReadMoney(debit)+' | Mutasi K '+archiveReadMoney(credit)+' | Saldo akhir '+archiveReadMoney(balance);
 $('archive-read-table').innerHTML='<table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo Debit</th><th>Saldo Kredit</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.date)+'</td><td>'+esc(r.number)+'</td><td>'+esc(r.description)+'</td><td>'+archiveReadMoney(r.debit)+'</td><td>'+archiveReadMoney(r.credit)+'</td><td>'+archiveReadMoney(r.bd)+'</td><td>'+archiveReadMoney(r.bc)+'</td></tr>').join('')+'</tbody></table>';
}
function archiveReadTrialBalance(){
 const period=$('archive-read-period').value;if(!period){$('archive-read-summary').textContent='Pilih bulan laporan.';$('archive-read-table').innerHTML='<div class="empty">Periode diperlukan.</div>';return}
 const opening=new Map((archiveReadState.openingBalances||[]).filter(x=>x.period===period).map(x=>[String(x.accountCode),{debit:Number(x.debit||0),credit:Number(x.credit||0)}])),movement=new Map();
 (archiveReadState.journals||[]).filter(j=>(isPostedJournal(j))&&String(j.date||'').slice(0,7)===period).forEach(j=>(j.lines||[]).forEach(l=>{const v=movement.get(String(l.code))||{debit:0,credit:0};v.debit+=Number(l.debit||0);v.credit+=Number(l.credit||0);movement.set(String(l.code),v)}));
 const codes=new Set([...(archiveReadState.accounts||[]).map(x=>String(x.code)),...opening.keys(),...movement.keys()]);
 const rows=[...codes].sort().map(code=>{const op=opening.get(code)||{debit:0,credit:0},mv=movement.get(code)||{debit:0,credit:0},net=op.debit-op.credit+mv.debit-mv.credit,acc=archiveReadAccount(code);return {code,name:acc.name,od:Math.max(op.debit-op.credit,0),oc:Math.max(op.credit-op.debit,0),debit:mv.debit,credit:mv.credit,ed:Math.max(net,0),ec:Math.max(-net,0)}});
 const sum=k=>rows.reduce((n,r)=>n+r[k],0);$('archive-read-summary').textContent='Neraca percobaan '+period+' · '+rows.length+' akun · Selisih saldo akhir '+archiveReadMoney(sum('ed')-sum('ec'));
 $('archive-read-table').innerHTML='<table><thead><tr><th>SANDI</th><th>Nama akun</th><th>Saldo awal D</th><th>Saldo awal K</th><th>Mutasi D</th><th>Mutasi K</th><th>Saldo akhir D</th><th>Saldo akhir K</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+archiveReadMoney(r.od)+'</td><td>'+archiveReadMoney(r.oc)+'</td><td>'+archiveReadMoney(r.debit)+'</td><td>'+archiveReadMoney(r.credit)+'</td><td>'+archiveReadMoney(r.ed)+'</td><td>'+archiveReadMoney(r.ec)+'</td></tr>').join('')+'<tr><th colspan="2">TOTAL</th>'+['od','oc','debit','credit','ed','ec'].map(k=>'<th>'+archiveReadMoney(sum(k))+'</th>').join('')+'</tr></tbody></table>';
}
function renderArchiveReader(){
 if(!archiveReadState){$('archive-read-summary').textContent='Belum ada arsip yang dibuka.';$('archive-read-table').innerHTML='<div class="empty">Pilih file arsip JSON yang dibuat melalui menu Arsip 5 Tahunan.</div>';return}
 const mode=$('archive-read-mode').value;$('archive-read-search').hidden=mode==='ledger'||mode==='trial';$('archive-read-account-wrap').hidden=mode!=='ledger';
 if(mode==='journals')archiveReadJournals();else if(mode==='nptrans')archiveReadNptrans();else if(mode==='ledger')archiveReadLedger();else archiveReadTrialBalance();
}
async function loadArchiveReaderFile(file){
 if(!file)return;try{const parsed=JSON.parse(await file.text()),candidate=parsed.state;if(parsed.archiveType!=='FIVE_YEAR_FULL_DATABASE_SNAPSHOT'||!candidate||!Array.isArray(candidate.accounts)||!Array.isArray(candidate.journals)||!Array.isArray(candidate.nptrans)||!Array.isArray(candidate.openingBalances))throw Error('File bukan arsip SBP lima tahunan yang valid.');archiveReadState=candidate;archiveReadName=file.name;$('archive-read-period').value='';$('archive-read-account').innerHTML='<option value="">Pilih akun</option>'+candidate.accounts.slice().sort((x,y)=>String(x.code).localeCompare(String(y.code))).map(x=>'<option value="'+esc(x.code)+'">'+esc(x.code)+' · '+esc(x.name||'(Tanpa nama)')+'</option>').join('');$('archive-read-summary').textContent='Arsip '+(parsed.period?.startYear||'?')+'–'+(parsed.period?.endYear||'?')+' berhasil dibuka dalam mode baca saja. Tidak ada data yang diimpor ke database aktif.';$('archive-read-status').textContent='ARSIP TERBUKA · '+file.name+' · '+(candidate.journals.length||0)+' jurnal · '+(candidate.nptrans.length||0)+' baris NPTRANS';renderArchiveReader()}catch(e){archiveReadState=null;$('archive-read-status').textContent='Gagal membuka arsip';$('archive-read-summary').textContent=e.message;$('archive-read-table').innerHTML='<div class="empty">Arsip tidak dapat dibaca.</div>'}
}

async function sha256Hex(textValue){const bytes=new TextEncoder().encode(textValue);const digest=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function createFiveYearArchive(){
 const start=Number($('archive-start-year').value),end=Number($('archive-end-year').value);
 if(!Number.isInteger(start)||!Number.isInteger(end)||end-start!==4){setMessage('archive-message','Masukkan rentang tepat lima tahun, misalnya 2026 sampai 2030.','bad');return}
 if(!backupDirectoryHandle){setMessage('archive-message','Hubungkan folder server pada menu Backup & Restore terlebih dahulu.','bad');return}
 if(await directoryPermission(backupDirectoryHandle,false)!=='granted'){setMessage('archive-message','Izin folder server belum aktif. Buka menu Backup & Restore lalu aktifkan kembali folder.','bad');return}
 const name='SBP-ARSIP-'+start+'-'+end+'.json',manifestName=name+'.sha256.json';
 try{
  const archiveRoot=await backupDirectoryHandle.getDirectoryHandle('ARSIP_5_TAHUNAN',{create:true});
  try{await archiveRoot.getFileHandle(name,{create:false});setMessage('archive-message','Arsip '+start+'–'+end+' sudah ada. Arsip lama tidak ditimpa.','bad');return}catch(e){if(e.name!=='NotFoundError')throw e}
  const createdAt=new Date().toISOString();
  const payload={app:'SBP Accounting',version:19,archiveType:'FIVE_YEAR_FULL_DATABASE_SNAPSHOT',period:{startYear:start,endYear:end},createdAt,scope:'SNAPSHOT LENGKAP DATABASE PADA SAAT PENGARSIPAN',note:'Arsip ini menyimpan salinan lengkap database saat dibuat. Data aktif tidak dipindahkan atau dihapus. Rentang tahun adalah label periode penutupan, bukan filter data.',state:JSON.parse(JSON.stringify(state))};
  if(payload.state.npTemplate?.fields)payload.state.npTemplate.fields.forEach(f=>{if(f.raw&&typeof f.raw==='object')f.raw=Array.from(f.raw)});
  const body=JSON.stringify(payload),digest=await sha256Hex(body);
  const file=await archiveRoot.getFileHandle(name,{create:true}),w=await file.createWritable();await w.write(body);await w.close();
  const check=await (await file.getFile()).text();if(await sha256Hex(check)!==digest)throw Error('Checksum arsip tidak cocok setelah penulisan.');
  const manifest={file:name,sha256:digest,bytes:new Blob([body]).size,createdAt,period:payload.period,verified:true};
  const mf=await archiveRoot.getFileHandle(manifestName,{create:true}),mw=await mf.createWritable();await mw.write(JSON.stringify(manifest,null,2));await mw.close();
  $('archive-result').textContent='Berhasil: '+name+' · '+(manifest.bytes/1024/1024).toFixed(2)+' MB · SHA-256 terverifikasi.';
  setMessage('archive-message','Arsip berhasil dibuat dan checksum telah diverifikasi. Database aktif tidak diubah. Salin arsip ke media kedua.','good');
 }catch(e){console.warn('Pembuatan arsip gagal',e);setMessage('archive-message','Pembuatan arsip gagal: '+e.message+'. Data aktif tidak dihapus.','bad')}
}
async function verifyFiveYearArchive(){
 if(!backupDirectoryHandle||await directoryPermission(backupDirectoryHandle,false)!=='granted'){setMessage('archive-message','Hubungkan dan aktifkan folder server terlebih dahulu.','bad');return}
 const start=Number($('archive-start-year').value),end=Number($('archive-end-year').value),name='SBP-ARSIP-'+start+'-'+end+'.json';
 try{const root=await backupDirectoryHandle.getDirectoryHandle('ARSIP_5_TAHUNAN',{create:false}),file=await root.getFileHandle(name,{create:false}),body=await(await file.getFile()).text(),manifest=JSON.parse(await(await(await root.getFileHandle(name+'.sha256.json',{create:false})).getFile()).text()),actual=await sha256Hex(body);if(actual!==manifest.sha256)throw Error('Checksum tidak cocok. Arsip mungkin berubah atau rusak.');const parsed=JSON.parse(body);if(!parsed.state||!Array.isArray(parsed.state.journals)||!Array.isArray(parsed.state.accounts))throw Error('Struktur arsip tidak lengkap.');setMessage('archive-message','Verifikasi berhasil: checksum cocok dan struktur data utama dapat dibaca.','good');$('archive-result').textContent='Valid · '+name+' · '+(manifest.bytes/1024/1024).toFixed(2)+' MB.'}catch(e){setMessage('archive-message','Verifikasi gagal: '+e.message,'bad')}
}

document.querySelectorAll('[data-import-launch]').forEach(button=>button.addEventListener('click',()=>{
 const routes={accounts:{page:'import-center',input:'account-file'},journal:{page:'import-center',input:'bulk-journal-file'},nptrans:{page:'nptrans',input:'np-file'},opening:{page:'import-center',input:'opening-import-file'},backup:{page:'backup',input:'backup-file'}};
 const route=routes[button.dataset.importLaunch];if(!route)return;go(route.page);
 const input=$(route.input);if(input)setTimeout(()=>input.click(),80);
}));

let editingDebitNoteId=null;
function debitNoteNextNumber(date=$('dn-date')?.value||new Date().toISOString().slice(0,10)){const year=String(date).slice(0,4);const nums=(state.debitNotes||[]).map(n=>String(n.number||'')).filter(n=>n.startsWith('ND-'+year+'-')).map(n=>Number(n.split('-').pop())||0);let seq=1;while(nums.includes(seq))seq++;return 'ND-'+year+'-'+String(seq).padStart(5,'0')}

let debitNoteSelectedSources=[];
function debitNoteGroupOptions(){
 const groups=[...new Set(state.accounts.map(a=>String(a.code||'').match(/^(\\d{3})\\.\\d{3}$/)?.[1]).filter(Boolean))].sort();
 $('dn-source-group').innerHTML=groups.map(g=>'<option value="'+g+'.000">'+g+'.000 s.d. '+g+'.800</option>').join('');
 if(groups.includes('719'))$('dn-source-group').value='719.000';
}
function debitNoteSourceMatches(){
 const base=$('dn-source-group').value, prefix=base.split('.')[0];
 const rows=[];
 (state.journals||[]).filter(j=>j.status==='posted').forEach(j=>(j.lines||[]).forEach((l,index)=>{
  const code=String(l.code||''),m=code.match(/^\\d{3}\\.(\\d{3})$/);
  if(!m||code.split('.')[0]!==prefix||Number(m[1])>800)return;
  const account=state.accounts.find(a=>a.code===code)||{};
  rows.push({key:j.id+'::'+index,journalId:j.id,lineIndex:index,journalNumber:j.number||'',date:j.date||'',accountCode:code,accountName:account.name||'',description:j.description||'',note:l.note||'',debit:Number(l.debit)||0,credit:Number(l.credit)||0});
 }));
 return rows.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(a.journalNumber||'').localeCompare(b.journalNumber||''));
}
function searchDebitNoteSources(){
 const rows=debitNoteSourceMatches();
 $('dn-source-rows').innerHTML=rows.length?rows.map((r)=>'<tr><td><input type="checkbox" class="dn-source-check" data-key="'+esc(r.key)+'"></td><td>'+esc(r.date)+'</td><td>'+esc(r.journalNumber)+'</td><td><b>'+esc(r.accountCode)+'</b></td><td>'+esc(r.accountName)+'</td><td>'+esc(r.note||r.description)+'</td><td>'+money(r.debit)+'</td><td>'+money(r.credit)+'</td></tr>').join(''):'<tr><td colspan="8" class="empty">Tidak ditemukan transaksi POSTED pada kelompok SANDI '+esc($('dn-source-group').value)+'.</td></tr>';
 setMessage('dn-source-message',rows.length+' baris transaksi POSTED ditemukan pada kelompok '+$('dn-source-group').value+' sampai '+$('dn-source-group').value.split('.')[0]+'.800.','');
}
function addSelectedDebitNoteSources(){
 const selected=[...document.querySelectorAll('.dn-source-check:checked')].map(c=>c.dataset.key),all=debitNoteSourceMatches();
 let added=0;
 selected.forEach(key=>{const row=all.find(x=>x.key===key);if(row&&!debitNoteSelectedSources.some(x=>x.key===key)){debitNoteSelectedSources.push(row);added++}});
 renderDebitNoteSelectedSources();
 setMessage('dn-source-message',added+' transaksi ditambahkan sebagai referensi Nota Debet.','');
}
function renderDebitNoteSelectedSources(){
 $('dn-source-selected').innerHTML=debitNoteSelectedSources.length?debitNoteSelectedSources.map((r,i)=>'<div class="dn-selected-item"><span><b>'+esc(r.journalNumber)+'</b> · '+esc(r.date)+' · '+esc(r.accountCode)+' — '+esc(r.accountName)+'<small>'+esc(r.note||r.description)+' | D '+money(r.debit)+' / K '+money(r.credit)+'</small></span><button type="button" class="icon-btn dn-source-remove" data-index="'+i+'">×</button></div>').join(''):'<span class="empty">Belum ada transaksi yang dipilih.</span>';
 document.querySelectorAll('.dn-source-remove').forEach(b=>b.onclick=()=>{debitNoteSelectedSources.splice(Number(b.dataset.index),1);renderDebitNoteSelectedSources()});
}

function debitNoteAddLine(line={}){const tr=document.createElement('tr');tr.className='dn-entry-row';tr.innerHTML='<td><select class="dn-code">'+accountOptions(line.code||'')+'</select></td><td class="dn-account-name">'+esc((state.accounts.find(a=>a.code===line.code)||{}).name||'')+'</td><td><input class="dn-note" value="'+esc(line.note||'')+'" placeholder="Keterangan baris"></td><td><input class="dn-debit amount" type="number" min="0" step="0.01" value="'+(Number(line.debit)||'')+'" placeholder="0"></td><td><input class="dn-credit amount" type="number" min="0" step="0.01" value="'+(Number(line.credit)||'')+'" placeholder="0"></td><td><button class="icon-btn dn-remove" type="button">×</button></td>';$('dn-lines').appendChild(tr);tr.querySelector('.dn-code').onchange=()=>{tr.querySelector('.dn-account-name').textContent=(state.accounts.find(a=>a.code===tr.querySelector('.dn-code').value)||{}).name||''};tr.querySelectorAll('.dn-debit,.dn-credit').forEach(x=>x.oninput=debitNoteTotals);tr.querySelector('.dn-remove').onclick=()=>{tr.remove();debitNoteTotals()}}
function debitNoteTotals(){const rows=[...document.querySelectorAll('.dn-entry-row')],debit=rows.reduce((s,r)=>s+Number(r.querySelector('.dn-debit').value||0),0),credit=rows.reduce((s,r)=>s+Number(r.querySelector('.dn-credit').value||0),0);$('dn-debit-total').textContent=money(debit);$('dn-credit-total').textContent=money(credit);$('dn-difference').textContent=money(Math.abs(debit-credit));return {rows,debit,credit,diff:Math.abs(debit-credit)}}
function resetDebitNoteForm(){editingDebitNoteId=null;debitNoteSelectedSources=[];renderDebitNoteSelectedSources();$('dn-number').value=debitNoteNextNumber();$('dn-date').value=new Date().toISOString().slice(0,10);$('dn-direction').value='issued';$('dn-kind').value='pembelian_tbs';$('dn-partner').value='';$('dn-reference').value='';$('dn-description').value='';$('dn-lines').innerHTML='';debitNoteAddLine();debitNoteAddLine();debitNoteTotals();$('dn-save').textContent='Simpan Draft';$('dn-post').disabled=false;setMessage('dn-message','Nota Debet siap diisi. Tentukan akun berdasarkan substansi transaksi.','')}
function debitNotePayload(){const tot=debitNoteTotals();return {date:$('dn-date').value,number:$('dn-number').value.trim(),direction:$('dn-direction').value,kind:$('dn-kind').value,partner:$('dn-partner').value.trim(),reference:$('dn-reference').value.trim(),description:$('dn-description').value.trim(),sourceTransactions:debitNoteSelectedSources.map(x=>({...x})),lines:tot.rows.map(r=>({code:r.querySelector('.dn-code').value,note:r.querySelector('.dn-note').value.trim(),debit:Number(r.querySelector('.dn-debit').value||0),credit:Number(r.querySelector('.dn-credit').value||0)}))}}
function renderDebitNotes(){const q=($('dn-search')?.value||'').toLowerCase().trim(),status=$('dn-status')?.value||'all',rows=(state.debitNotes||[]).filter(n=>(status==='all'||n.status===status)&&[n.number,n.partner,n.reference,n.description,n.kind].join(' ').toLowerCase().includes(q)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('dn-rows').innerHTML=rows.length?rows.map((n,i)=>{const total=(n.lines||[]).reduce((s,l)=>s+Math.max(Number(l.debit)||0,Number(l.credit)||0),0),kind={pembelian_tbs:'Pembelian TBS',pembelian_lain:'Pembelian lainnya',penjualan:'Penjualan',biaya:'Biaya',umum:'Umum'}[n.kind]||n.kind;return '<tr><td>'+(i+1)+'</td><td>'+esc(n.date||'')+'</td><td><b>'+esc(n.number)+'</b></td><td>'+esc(kind)+'<br><small>'+(n.direction==='received'?'Diterima':'Diterbitkan')+'</small></td><td>'+esc(n.partner||'')+'</td><td>'+esc(n.reference||'—')+'</td><td>'+money(total)+'</td><td><span class="tag">'+(n.status==='posted'?'POSTED':n.status==='cancelled'?'BATAL':'DRAFT')+'</span></td><td>'+(n.status==='draft'?'<button class="btn dn-edit" data-id="'+esc(n.id)+'">Edit</button> <button class="btn dn-post-row" data-id="'+esc(n.id)+'">Posting</button> <button class="icon-btn dn-cancel-row" data-id="'+esc(n.id)+'">Batal</button>':'<button class="btn dn-view" data-id="'+esc(n.id)+'">Lihat</button>')+'</td></tr>'}).join(''):'<tr><td colspan="9" class="empty">Belum ada Nota Debet.</td></tr>';document.querySelectorAll('.dn-edit').forEach(b=>b.onclick=()=>editDebitNote(b.dataset.id));document.querySelectorAll('.dn-post-row').forEach(b=>b.onclick=()=>postDebitNote(b.dataset.id));document.querySelectorAll('.dn-cancel-row').forEach(b=>b.onclick=()=>cancelDebitNote(b.dataset.id));document.querySelectorAll('.dn-view').forEach(b=>b.onclick=()=>viewDebitNote(b.dataset.id))}
function editDebitNote(id){const n=(state.debitNotes||[]).find(x=>x.id===id);if(!n||n.status!=='draft')return;editingDebitNoteId=id;debitNoteSelectedSources=(n.sourceTransactions||[]).map(x=>({...x}));renderDebitNoteSelectedSources();$('dn-number').value=n.number;$('dn-date').value=n.date;$('dn-direction').value=n.direction;$('dn-kind').value=n.kind;$('dn-partner').value=n.partner;$('dn-reference').value=n.reference;$('dn-description').value=n.description;$('dn-lines').innerHTML='';(n.lines||[]).forEach(l=>debitNoteAddLine(l));if(!n.lines?.length){debitNoteAddLine();debitNoteAddLine()}debitNoteTotals();$('dn-save').textContent='Simpan Perubahan Draft';setMessage('dn-message','Mengedit '+n.number+'.','');window.scrollTo({top:0,behavior:'smooth'})}
async function saveDebitNote(){const p=debitNotePayload();if(!p.date||!p.partner||!p.description){setMessage('dn-message','Tanggal, nama pihak, dan keterangan wajib diisi.','bad');return}if(!periodGuard(p.date.slice(0,7),'menyimpan Nota Debet'))return;const old=(state.debitNotes||[]).find(n=>n.id===editingDebitNoteId);if(old&&old.status!=='draft')return;if(state.debitNotes.some(n=>n.number===p.number&&n.id!==editingDebitNoteId)){setMessage('dn-message','Nomor Nota Debet sudah digunakan.','bad');return}if(p.lines.some(l=>l.debit<0||l.credit<0)){setMessage('dn-message','Nominal tidak boleh negatif.','bad');return}const now=new Date().toISOString(),item={...(old||{}),...p,id:editingDebitNoteId||crypto.randomUUID(),status:'draft',updatedAt:now};if(!old)item.createdAt=now;if(old)state.debitNotes=state.debitNotes.map(n=>n.id===old.id?item:n);else state.debitNotes.push(item);await persist();renderDebitNotes();resetDebitNoteForm();toast('Draft Nota Debet tersimpan.')}
async function postDebitNote(id=editingDebitNoteId){let n=(state.debitNotes||[]).find(x=>x.id===id);if(id===editingDebitNoteId){const p=debitNotePayload();n={...(n||{}),...p}}if(!n||n.status!=='draft')return;if(!periodGuard(String(n.date||'').slice(0,7),'memposting Nota Debet'))return;const lines=n.lines||[],debit=lines.reduce((s,l)=>s+Number(l.debit||0),0),credit=lines.reduce((s,l)=>s+Number(l.credit||0),0);if(!n.partner||!n.description||lines.length<2||lines.some(l=>!l.code||!state.accounts.some(a=>a.code===l.code)||!Number.isFinite(l.debit)||!Number.isFinite(l.credit)||l.debit<0||l.credit<0||(!l.debit&&!l.credit)||(l.debit&&l.credit))){setMessage('dn-message','Periksa pihak, keterangan, akun, dan nominal. Setiap baris harus berisi satu sisi debit atau kredit.','bad');return}if(Math.abs(debit-credit)>.005){setMessage('dn-message','Nota belum seimbang. Selisih '+money(Math.abs(debit-credit))+'.','bad');return}if(!confirm('Posting '+n.number+' dan buat satu jurnal POSTED dengan nomor '+n.number+'? Dokumen dan jurnal saling terhubung.'))return;if(state.journals.some(j=>j.number===n.number)){setMessage('dn-message','Nomor jurnal sudah digunakan.','bad');return}const now=new Date().toISOString(),journal={id:crypto.randomUUID(),date:n.date,number:n.number,description:'Nota Debet '+n.number+' · '+n.description,lines:lines.map(l=>({...l})),status:'posted',source:'DEBIT_NOTE',sourceId:n.id,createdAt:now,updatedAt:now,postedAt:now};state.journals.push(journal);state.debitNotes=state.debitNotes.map(x=>x.id===n.id?{...x,status:'posted',journalId:journal.id,postedAt:now,updatedAt:now}:x);await persist();renderDebitNotes();renderJournals();renderDashboard();renderTrialBalance();resetDebitNoteForm();toast('Nota Debet diposting dan jurnal '+n.number+' dibuat.')}
async function cancelDebitNote(id){const n=state.debitNotes.find(x=>x.id===id);if(!n||n.status!=='draft')return;const reason=prompt('Alasan pembatalan Nota Debet '+n.number+':');if(reason===null)return;if(!reason.trim()){toast('Alasan pembatalan wajib diisi.');return}n.status='cancelled';n.cancelReason=reason.trim();n.cancelledAt=new Date().toISOString();await persist();renderDebitNotes();toast('Nota Debet dibatalkan.')}
function viewDebitNote(id){const n=state.debitNotes.find(x=>x.id===id);if(!n)return;const lines=(n.lines||[]).map(l=>{const a=state.accounts.find(x=>x.code===l.code)||{};return l.code+' '+(a.name||'')+' | D '+money(l.debit)+' | K '+money(l.credit)}).join('\n');alert('NOTA DEBET '+n.number+'\nTanggal: '+n.date+'\nPihak: '+n.partner+'\nReferensi: '+(n.reference||'-')+'\nKeterangan: '+n.description+'\n\n'+lines+'\nStatus: '+n.status.toUpperCase()+'\nJurnal: '+(n.journalId||'-'))}
$('dn-add-line').onclick=()=>debitNoteAddLine();$('dn-source-search').onclick=searchDebitNoteSources;$('dn-source-add').onclick=addSelectedDebitNoteSources;$('dn-source-group').onchange=()=>{$('dn-source-rows').innerHTML='<tr><td colspan="8" class="empty">Tekan Cari Transaksi untuk memuat data.</td></tr>';};$('dn-reset').onclick=resetDebitNoteForm;$('dn-save').onclick=saveDebitNote;$('dn-post').onclick=()=>postDebitNote(editingDebitNoteId);$('dn-search').oninput=renderDebitNotes;$('dn-status').onchange=renderDebitNotes;$('dn-date').onchange=()=>{if(!editingDebitNoteId)$('dn-number').value=debitNoteNextNumber()};

function go(page){
 const target='page-'+page;
 document.querySelectorAll('section.page').forEach(p=>{
  const isTarget=p.id===target;
  p.classList.toggle('active',isTarget);
  p.hidden=!isTarget;
  if(isTarget)p.removeAttribute('hidden');
 });
 document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 const labels={'annual-budget':'Anggaran Tahunan','import-center':'Pusat Import Data','journal-admin':'Administrasi Jurnal',periods:'Periode Akuntansi',dashboard:'Dashboard','archive-reader':'Pembaca Arsip',archive:'Arsip 5 Tahunan',journal:'Input Jurnal','journal-list':'Daftar jurnal',accounts:'Master Akun','opening-balances':'Saldo Awal ACC & Program','debit-notes':'Nota Debet',ledger:'Buku Besar per Akun',nptrans:'NPTRANS / DBF',reports:'Laporan',backup:'Backup & Restore',audit:'Riwayat Aktivitas',validation:'Validasi & Integritas Data','print-settings':'Pengaturan Cetak'};
 $('page-title').textContent=labels[page]||page;
 if(page==='periods')renderPeriodControl();if(page==='annual-budget')renderAnnualBudgets();
 if(page==='dashboard')renderDashboard();
 if(page==='journal-list')renderJournals();
 if(page==='debit-notes')renderDebitNotes();
 if(page==='accounts')renderAccounts();
 if(page==='opening-balances')renderOpeningBalances();
 if(page==='nptrans')renderNptrans();
 if(page==='reports')renderTrialBalance();
 if(page==='ledger')renderLedger();
 if(page==='audit')renderAuditLogs();
 if(page==='validation')renderValidation();
}
document.querySelectorAll('[data-page]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.page)));
document.querySelectorAll('.list-toggle').forEach(b=>b.addEventListener('click',()=>{const panel=$(b.dataset.target);if(!panel)return;const opening=panel.hidden;panel.hidden=!opening;b.setAttribute('aria-expanded',String(opening));const labels={'account-list-content':opening?'− Sembunyikan daftar akun':'＋ Tampilkan '+state.accounts.length+' akun','journal-list-content':opening?'− Sembunyikan daftar jurnal':'＋ Tampilkan daftar jurnal','np-list-content':opening?'− Sembunyikan data NPTRANS':'＋ Tampilkan data NPTRANS','trial-balance-content':opening?'− Sembunyikan neraca saldo':'＋ Tampilkan neraca saldo'};b.textContent=labels[b.dataset.target]||'Tampilkan / sembunyikan';}));
document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
$('quick-journal').onclick=()=>{resetJournalForm();go('journal')};

function fmtDate(d){if(!d)return '';const x=new Date(d+'T00:00:00');return Number.isNaN(x.getTime())?d:x.toLocaleDateString('id-ID')}
function renderDashboard(){const posted=state.journals.filter(j=>isPostedJournal(j));const lines=posted.flatMap(j=>j.lines||[]),debit=lines.reduce((a,l)=>a+Number(l.debit||0),0),credit=lines.reduce((a,l)=>a+Number(l.credit||0),0);$('stat-debit').textContent=money(debit);$('stat-credit').textContent=money(credit);$('stat-journals').textContent=posted.length.toLocaleString('id-ID');const recent=posted.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,5);$('recent-journals').innerHTML=recent.length?journalTable(recent,false):'<div class="empty"><div class="empty-state"><span class="empty-state-icon"><i data-lucide="list"></i></span><strong>Belum ada jurnal tersimpan</strong><p>Transaksi terbaru akan muncul di sini setelah jurnal dibuat.</p></div></div>';window.lucide?.createIcons($('recent-journals'))}
function accountOptions(selected=''){return '<option value="">Pilih akun</option>'+state.accounts.map(a=>'<option value="'+esc(a.code)+'" '+(a.code===selected?'selected':'')+'>'+esc(a.code)+' — '+esc(a.name)+'</option>').join('')}
function addJournalLine(line={}){const tr=document.createElement('tr');tr.className='entry-row';tr.innerHTML='<td><select class="line-code">'+accountOptions(line.code||'')+'</select></td><td class="line-account-name">'+esc((state.accounts.find(a=>a.code===line.code)||{}).name||'—')+'</td><td><input class="line-note" placeholder="Keterangan baris" value="'+esc(line.note||'')+'"></td><td><input class="amount line-debit" type="number" min="0" step="0.01" value="'+(line.debit||'')+'"></td><td><input class="amount line-credit" type="number" min="0" step="0.01" value="'+(line.credit||'')+'"></td><td><button class="icon-btn remove-line" type="button">×</button></td>';tr.querySelector('.line-code').onchange=()=>{const a=state.accounts.find(x=>x.code===tr.querySelector('.line-code').value);tr.querySelector('.line-account-name').textContent=a?a.name:'—';updateJournalBudgetPreview()};tr.querySelectorAll('input').forEach(i=>i.addEventListener('input',updateJournalTotals));tr.querySelector('.remove-line').onclick=()=>{if($('journal-lines').children.length>2){tr.remove();updateJournalTotals()}else toast('Minimal dua baris akun diperlukan.')};$('journal-lines').appendChild(tr);updateJournalTotals()}
function resetJournalForm(){editingId=null;ensurePeriodControl();$('j-date').value=state.periodControl.activePeriod+'-01';$('j-number').value='';$('j-description').value='';$('journal-lines').innerHTML='';addJournalLine();addJournalLine();$('save-journal').textContent='Simpan sebagai Draft';$('post-journal').textContent='Posting Jurnal';$('post-journal').disabled=false;setMessage('journal-message','Simpan sebagai Draft untuk dilanjutkan nanti, atau Posting Jurnal setelah debit dan kredit seimbang.')}
function updateJournalTotals(){const rows=[...document.querySelectorAll('.entry-row')];let d=0,c=0;rows.forEach(r=>{d+=Number(r.querySelector('.line-debit').value||0);c+=Number(r.querySelector('.line-credit').value||0)});$('sum-debit').textContent=money(d);$('sum-credit').textContent=money(c);$('sum-diff').textContent=money(Math.abs(d-c));$('sum-diff').style.color=Math.abs(d-c)<.005?'#176c45':'#b34444';updateJournalBudgetPreview()}
const BUDGET_MONTHS=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function findBudget(y,code){return (state.annualBudgets||[]).find(x=>Number(x.year)===Number(y)&&String(x.accountCode)===String(code))}
function budgetPostedNet(y,m,code){let n=0;for(const x of state.journals){if(x.status!=='posted'||String(x.date||'').slice(0,7)!==y+'-'+String(m).padStart(2,'0'))continue;for(const l of x.lines||[])if(String(l.code)===String(code))n+=Number(l.debit||0)-Number(l.credit||0)}return n}
function updateJournalBudgetPreview(){const host=$('journal-budget-content');if(!host)return;const d=$('j-date').value,y=Number(d.slice(0,4)),m=Number(d.slice(5,7));if(!y||!m){host.innerHTML='<div class="budget-empty">Tanggal jurnal belum valid.</div>';return}const draft=new Map();document.querySelectorAll('#journal-lines .entry-row').forEach(r=>{const code=r.querySelector('.line-code').value;if(code)draft.set(code,(draft.get(code)||0)+Number(r.querySelector('.line-debit').value||0)-Number(r.querySelector('.line-credit').value||0))});const codes=[...draft.keys()].filter(code=>findBudget(y,code));if(!codes.length){host.innerHTML='<div class="budget-empty">Belum ada SANDI terpilih yang memiliki anggaran '+BUDGET_MONTHS[m-1]+' '+y+'.</div>';return}host.innerHTML='<div class="journal-budget-grid">'+codes.map(code=>{const b=findBudget(y,code),a=state.accounts.find(x=>x.code===code),limit=Number(b.monthly?.[m-1]||0),actual=budgetPostedNet(y,m,code),input=draft.get(code)||0,remain=limit-actual-input,pct=limit?(actual+input)/limit*100:0,level=remain<0?'over':pct>=80?'warn':'safe';return '<article class="journal-budget-card '+level+'"><div class="journal-budget-card-top"><div><b>'+esc(code)+'</b><span>'+esc(a?.name||'')+'</span></div><em class="budget-state '+level+'">'+(level==='over'?'Melebihi anggaran':level==='warn'?'Mendekati batas':'Aman')+'</em></div><div class="journal-budget-metrics"><div><small>Anggaran bulan ini</small><strong>'+money(limit)+'</strong></div><div><small>Realisasi POSTED</small><strong>'+money(actual)+'</strong></div><div><small>Input saat ini</small><strong>'+money(input)+'</strong></div><div class="remaining"><small>Sisa setelah input</small><strong>'+money(remain)+'</strong></div></div><div class="budget-progress"><span style="width:'+Math.max(0,Math.min(100,pct))+'%"></span></div><small class="budget-usage">Penggunaan termasuk input: '+pct.toFixed(1).replace('.',',')+'%</small></article>'}).join('')+'</div><div class="budget-footnote">Simulasi belum mengubah anggaran. Realisasi hanya dari jurnal POSTED; kredit pada SANDI yang sama mengurangi realisasi bersih.</div>'}
function renderBudgetMonths(v=Array(12).fill(0)){$('budget-month-grid').innerHTML=BUDGET_MONTHS.map((m,i)=>'<label>'+m+'<input class="budget-month-value" type="number" min="0" step="1" value="'+Number(v[i]||0)+'"></label>').join('');document.querySelectorAll('.budget-month-value').forEach(x=>x.oninput=budgetValidation)}
function budgetMonths(){return [...document.querySelectorAll('.budget-month-value')].map(x=>Number(x.value||0))}
function budgetValidation(){const annual=Number($('budget-annual').value||0),sum=budgetMonths().reduce((a,b)=>a+b,0),ok=annual>0&&Math.abs(annual-sum)<.005&&$('budget-account').value&&Number.isInteger(Number($('budget-year').value));$('budget-validation').className='budget-validation '+(ok?'good':'warn');$('budget-validation').textContent='Distribusi bulanan: '+money(sum)+' · Anggaran tahunan: '+money(annual)+' · '+(ok?'Seimbang':'Belum seimbang');$('budget-save').disabled=!ok}
function resetBudget(){ $('budget-year').value=new Date().getFullYear();$('budget-account').disabled=false;$('budget-account').value='';$('budget-account-name').value='';$('budget-annual').value='';$('budget-form-title').textContent='Buat Anggaran Akun';$('budget-save').textContent='Simpan Anggaran';renderBudgetMonths();budgetValidation();editingBudget=null}
let editingBudget=null;
function editBudget(y,code){const b=findBudget(y,code);if(!b)return;editingBudget=y+'|'+code;$('budget-year').value=y;$('budget-account').value=code;$('budget-account').disabled=true;$('budget-account-name').value=(state.accounts.find(x=>x.code===code)||{}).name||'';$('budget-annual').value=b.annual;$('budget-form-title').textContent='Edit Anggaran '+code;$('budget-save').textContent='Simpan Perubahan';renderBudgetMonths(b.monthly);budgetValidation();$('page-annual-budget').scrollIntoView({behavior:'smooth'})}
function realizedYear(y,code){let n=0;for(const x of state.journals){if(x.status!=='posted'||String(x.date||'').slice(0,4)!==String(y))continue;for(const l of x.lines||[])if(String(l.code)===String(code))n+=Number(l.debit||0)-Number(l.credit||0)}return n}
function renderAnnualBudgets(){const y=Number($('budget-filter-year').value||new Date().getFullYear()),q=$('budget-search').value.toLowerCase().trim(),items=(state.annualBudgets||[]).filter(x=>Number(x.year)===y&&((x.accountCode+' '+((state.accounts.find(a=>a.code===x.accountCode)||{}).name||'')).toLowerCase().includes(q)));$('budget-rows').innerHTML=items.length?items.map(b=>{const actual=realizedYear(y,b.accountCode),remain=b.annual-actual,pct=b.annual?actual/b.annual*100:0;return '<tr><td><b>'+esc(b.accountCode)+'</b></td><td>'+esc((state.accounts.find(a=>a.code===b.accountCode)||{}).name||'—')+'</td><td class="num">'+money(b.annual)+'</td><td class="num">'+money(actual)+'</td><td class="num '+(remain<0?'budget-negative':'budget-positive')+'">'+money(remain)+'</td><td><span class="budget-percent">'+pct.toFixed(1)+'%</span></td><td><button class="btn edit-budget" data-code="'+esc(b.accountCode)+'">Edit</button> <button class="icon-btn delete-budget" data-code="'+esc(b.accountCode)+'">×</button></td></tr>'}).join(''):'<tr><td colspan="7" class="empty">Belum ada anggaran untuk tahun '+y+'.</td></tr>';document.querySelectorAll('.edit-budget').forEach(b=>b.onclick=()=>editBudget(y,b.dataset.code));document.querySelectorAll('.delete-budget').forEach(b=>b.onclick=async()=>{if(!confirm('Hapus anggaran SANDI '+b.dataset.code+' tahun '+y+'?'))return;state.annualBudgets=state.annualBudgets.filter(x=>!(Number(x.year)===y&&x.accountCode===b.dataset.code));await persist();renderAnnualBudgets();updateJournalBudgetPreview()});const tb=items.reduce((s,x)=>s+Number(x.annual||0),0),ta=items.reduce((s,x)=>s+realizedYear(y,x.accountCode),0);$('budget-summary').innerHTML='<article><span>Total anggaran</span><b>'+money(tb)+'</b><small>'+items.length+' SANDI akun</small></article><article><span>Total realisasi</span><b>'+money(ta)+'</b><small>Jurnal POSTED '+y+'</small></article><article><span>Sisa anggaran</span><b class="'+(tb-ta<0?'budget-negative':'')+'">'+money(tb-ta)+'</b><small>Anggaran dikurangi realisasi bersih</small></article><article><span>Penggunaan</span><b>'+(tb?(ta/tb*100).toFixed(1):'0')+'%</b><small>Akumulasi tahunan</small></article>'}

let pendingBudgetImport=null;
const budgetImportMonths=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function budgetHeaderMap(row){return row.map(x=>norm(x))}
function budgetSheetRows(wb,name){const sn=wb.SheetNames.find(x=>norm(x)===norm(name));if(!sn)throw Error('Sheet '+name+' tidak ditemukan.');return XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:'',raw:true})}
function parseBudgetWorkbook(wb){
 const annualRows=budgetSheetRows(wb,'Anggaran_Tahunan'),monthlyRows=budgetSheetRows(wb,'Anggaran_Bulanan');
 const findHeader=(rows,required)=>{for(let i=0;i<Math.min(rows.length,20);i++){const h=budgetHeaderMap(rows[i]);if(required.every(k=>h.includes(norm(k))))return {index:i,headers:h}}throw Error('Header tidak sesuai pada sheet anggaran.')};
 const ah=findHeader(annualRows,['Tahun','SANDI','Anggaran_Tahunan']),mh=findHeader(monthlyRows,['Tahun','SANDI',...budgetImportMonths]);
 const col=(h,k)=>h.indexOf(norm(k)),annualMap=new Map(),monthlyMap=new Map(),errors=[];
 for(let i=ah.index+1;i<annualRows.length;i++){const r=annualRows[i],year=Number(r[col(ah.headers,'Tahun')]),code=String(r[col(ah.headers,'SANDI')]??'').trim(),amount=Number(r[col(ah.headers,'Anggaran_Tahunan')]);if(!year&&!code&&!amount)continue;const key=year+'|'+code;if(!Number.isInteger(year)||year<2000||year>2100||!code||!Number.isFinite(amount)||amount<=0){errors.push('Anggaran_Tahunan baris '+(i+1)+': Tahun, SANDI, atau nominal tidak valid.');continue}if(annualMap.has(key)){errors.push('Anggaran_Tahunan duplikat: '+key);continue}annualMap.set(key,{year,code,annual:amount,note:String(r[col(ah.headers,'Keterangan')]??'')})}
 for(let i=mh.index+1;i<monthlyRows.length;i++){const r=monthlyRows[i],year=Number(r[col(mh.headers,'Tahun')]),code=String(r[col(mh.headers,'SANDI')]??'').trim();if(!year&&!code)continue;const key=year+'|'+code,monthly=budgetImportMonths.map(m=>Number(r[col(mh.headers,m)]??0));if(!Number.isInteger(year)||year<2000||year>2100||!code||monthly.some(x=>!Number.isFinite(x)||x<0)){errors.push('Anggaran_Bulanan baris '+(i+1)+': Tahun, SANDI, atau nominal bulanan tidak valid.');continue}if(monthlyMap.has(key)){errors.push('Anggaran_Bulanan duplikat: '+key);continue}monthlyMap.set(key,{monthly,note:String(r[col(mh.headers,'Keterangan')]??'')})}
 const items=[];for(const [key,a] of annualMap){const m=monthlyMap.get(key);if(!m){errors.push(key+': data distribusi bulanan tidak ditemukan.');continue}const sum=m.monthly.reduce((s,x)=>s+x,0);if(Math.abs(sum-a.annual)>.005){errors.push(key+': total bulanan '+money(sum)+' tidak sama dengan anggaran tahunan '+money(a.annual)+'.');continue}if(!state.accounts.some(x=>String(x.code)===a.code)){errors.push(key+': SANDI tidak ditemukan pada Master Akun.');continue}items.push({...a,monthly:m.monthly,note:a.note||m.note})}
 for(const key of monthlyMap.keys())if(!annualMap.has(key))errors.push(key+': data anggaran tahunan tidak ditemukan.');
 return {items,errors};
}
function renderBudgetImportPreview(result,fileName){
 pendingBudgetImport=result;const existing=result.items.filter(x=>findBudget(x.year,x.code)).length;
 $('budget-import-message').textContent=fileName+' · '+result.items.length+' data valid · '+existing+' akan memperbarui data lama · '+result.errors.length+' masalah.';
 $('budget-import-message').className='inline-message '+(result.errors.length?'bad':result.items.length?'good':'');
 $('budget-import-preview').hidden=false;
 $('budget-import-preview').innerHTML='<table><thead><tr><th>Tahun</th><th>SANDI</th><th>Nama Akun</th><th>Anggaran Tahunan</th><th>Total Bulanan</th><th>Status</th></tr></thead><tbody>'+result.items.map(x=>'<tr><td>'+x.year+'</td><td>'+esc(x.code)+'</td><td>'+esc((state.accounts.find(a=>a.code===x.code)||{}).name||'')+'</td><td class="num">'+money(x.annual)+'</td><td class="num">'+money(x.monthly.reduce((s,n)=>s+n,0))+'</td><td>'+(findBudget(x.year,x.code)?'Perbarui':'Baru')+'</td></tr>').join('')+(result.errors.length?'<tr><td colspan="6"><b>Temuan:</b><br>'+result.errors.map(esc).join('<br>')+'</td></tr>':'')+'</tbody></table>';
 $('budget-import-confirm').disabled=!result.items.length||result.errors.length>0;
}
let selectedBudgetFile=null;
$('budget-import-file').onchange=e=>{
 selectedBudgetFile=e.target.files?.[0]||null;
 pendingBudgetImport=null;
 $('budget-import-run').disabled=!selectedBudgetFile;
 $('budget-import-status').textContent=selectedBudgetFile?'File dipilih: '+selectedBudgetFile.name:'Belum ada file dipilih.';
 $('budget-import-panel').hidden=true;
};
$('budget-import-run').onclick=async()=>{
 const f=selectedBudgetFile;if(!f)return;
 $('budget-import-run').disabled=true;
 $('budget-import-panel').hidden=false;
 $('budget-import-message').textContent='Sedang memeriksa file anggaran...';
 try{
  if(!window.XLSX)throw Error('Mesin Excel belum tersedia.');
  if(/\.csv$/i.test(f.name))throw Error('Import anggaran menggunakan template Excel gabungan (.xlsx).');
  const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});
  renderBudgetImportPreview(parseBudgetWorkbook(wb),f.name);
 }catch(err){
  pendingBudgetImport=null;$('budget-import-confirm').disabled=true;
  $('budget-import-message').textContent='Gagal membaca template: '+err.message;
  $('budget-import-message').className='inline-message bad';
  $('budget-import-preview').hidden=true;
 }finally{$('budget-import-run').disabled=false;}
};
$('budget-import-cancel').onclick=()=>{
 $('budget-import-panel').hidden=true;pendingBudgetImport=null;
 $('budget-import-file').value='';selectedBudgetFile=null;
 $('budget-import-status').textContent='Belum ada file dipilih.';
 $('budget-import-run').disabled=true;$('budget-import-confirm').disabled=true;
};
$('budget-import-confirm').onclick=async()=>{const batch=pendingBudgetImport;if(!batch?.items?.length||batch.errors.length)return;if(!requireImportPassword('Import Anggaran'))return;const replacements=batch.items.filter(x=>findBudget(x.year,x.code));if(replacements.length&&!confirm(replacements.length+' anggaran sudah ada dan akan diperbarui. Lanjutkan import?'))return;try{const now=new Date().toISOString();for(const x of batch.items){const old=findBudget(x.year,x.code),item={...(old||{}),year:x.year,accountCode:x.code,annual:x.annual,monthly:x.monthly,createdAt:old?.createdAt||now,updatedAt:now,revisions:[...(old?.revisions||[]),...(old?[{at:now,before:{annual:old.annual,monthly:old.monthly},after:{annual:x.annual,monthly:x.monthly},source:'IMPORT'}]:[])]};state.annualBudgets=old?state.annualBudgets.map(z=>z===old?item:z):[...state.annualBudgets,item]}await persist();const years=[...new Set([new Date().getFullYear(),...state.annualBudgets.map(x=>Number(x.year))])].sort((a,b)=>b-a);$('budget-filter-year').innerHTML=years.map(y=>'<option value="'+y+'">'+y+'</option>').join('');$('budget-filter-year').value=String(batch.items[0].year);renderAnnualBudgets();updateJournalBudgetPreview();$('budget-import-message').textContent=batch.items.length+' anggaran berhasil diimpor dan disimpan ke database lokal.';$('budget-import-message').className='inline-message good';$('budget-import-confirm').disabled=true;pendingBudgetImport=null;toast('Import anggaran berhasil.')}catch(err){$('budget-import-message').textContent='Import gagal: '+err.message;$('budget-import-message').className='inline-message bad'}};
function initAnnualBudget(){ $('budget-account').innerHTML='<option value="">Pilih SANDI akun</option>'+state.accounts.map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code)+' — '+esc(a.name)+'</option>').join('');$('budget-account').onchange=()=>{$('budget-account-name').value=(state.accounts.find(a=>a.code===$('budget-account').value)||{}).name||'';budgetValidation()};$('budget-annual').oninput=budgetValidation;$('budget-distribute').onclick=()=>{const n=Number($('budget-annual').value||0);if(n<=0)return toast('Isi anggaran tahunan terlebih dahulu.');const q=Math.floor(n/12),r=n-q*12;renderBudgetMonths(Array.from({length:12},(_,i)=>q+(i<r?1:0)));budgetValidation()};$('budget-reset').onclick=resetBudget;$('budget-save').onclick=async()=>{const y=Number($('budget-year').value),code=$('budget-account').value,annual=Number($('budget-annual').value||0),monthly=budgetMonths(),sum=monthly.reduce((a,b)=>a+b,0);if(!code||!Number.isInteger(y)||y<2000||y>2100||annual<=0||monthly.some(x=>!Number.isFinite(x)||x<0)||Math.abs(sum-annual)>.005)return toast('Periksa SANDI, tahun, dan distribusi bulanan.');const old=findBudget(y,code);if(old&&!editingBudget)return toast('Anggaran sudah ada. Gunakan Edit.');const now=new Date().toISOString(),item={...(old||{}),year:y,accountCode:code,annual,monthly,createdAt:old?.createdAt||now,updatedAt:now,revisions:[...(old?.revisions||[]),...(old?[{at:now,before:{annual:old.annual,monthly:old.monthly},after:{annual,monthly}}]:[])]};state.annualBudgets=old?state.annualBudgets.map(x=>x===old?item:x):[...state.annualBudgets,item];await persist();if(![...$('budget-filter-year').options].some(o=>Number(o.value)===y))$('budget-filter-year').add(new Option(y,y));$('budget-filter-year').value=y;renderAnnualBudgets();resetBudget();updateJournalBudgetPreview();toast('Anggaran berhasil disimpan.')};$('budget-filter-year').innerHTML=[...new Set([new Date().getFullYear(),...(state.annualBudgets||[]).map(x=>Number(x.year))])].sort((a,b)=>b-a).map(y=>'<option value="'+y+'">'+y+'</option>').join('');$('budget-filter-year').onchange=renderAnnualBudgets;$('budget-search').oninput=renderAnnualBudgets;resetBudget();renderAnnualBudgets()}

let pendingBulkJournals=[];
function bulkDate(value){
 const s=String(value??'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
 let m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
 if(m)return m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
 const n=Number(s);if(Number.isFinite(n)&&n>20000&&n<80000){const d=new Date(Date.UTC(1899,11,30)+n*86400000);return d.toISOString().slice(0,10)}
 return '';
}
function parseBulkJournalRows(rows){
 if(!rows.length)throw Error('File tidak memiliki data.');
 let hi=-1,cols={};
 const aliases={date:['TANGGAL','DATE'],number:['NOBUKTI','NOMORBUKTI','BUKTI'],desc:['KETERANGAN','URAIAN','DESKRIPSI'],code:['SANDI','KODE','KODEAKUN','ACCOUNTCODE'],note:['KETERANGANBARIS','CATATANBARIS','URAIANBARIS'],debit:['DEBIT','MUTASIDB'],credit:['KREDIT','MUTASIKR']};
 for(let i=0;i<Math.min(rows.length,30);i++){const h=rows[i].map(norm),f={};for(const [k,n] of Object.entries(aliases))f[k]=h.findIndex(x=>n.includes(x));if(f.date>=0&&f.number>=0&&f.code>=0&&f.debit>=0&&f.credit>=0){hi=i;cols=f;break}}
 if(hi<0)throw Error('Header wajib tidak lengkap. Wajib ada TANGGAL, NOBUKTI, SANDI, DEBIT, dan KREDIT.');
 const parsed=[];rows.slice(hi+1).forEach((r,i)=>{if(!r.some(v=>String(v??'').trim()))return;parsed.push({date:bulkDate(r[cols.date]),number:String(r[cols.number]??'').trim(),description:String(cols.desc>=0?r[cols.desc]??'':'').trim(),code:String(r[cols.code]??'').trim(),note:String(cols.note>=0?r[cols.note]??'':'').trim(),debit:parseAmount(r[cols.debit]),credit:parseAmount(r[cols.credit]),row:hi+i+2})});
 if(!parsed.length)throw Error('Header ditemukan, tetapi tidak ada baris transaksi.');return parsed;
}
function validateBulkJournals(rows){
 const errors=[],warnings=[],groups=new Map(),known=new Set(state.accounts.map(a=>String(a.code)));
 rows.forEach(r=>{
  if(!r.date)errors.push('Baris '+r.row+': tanggal tidak valid.');
  if(!r.number)errors.push('Baris '+r.row+': nomor bukti kosong.');
  if(!r.description)errors.push('Baris '+r.row+': keterangan jurnal kosong.');
  if(!r.code)errors.push('Baris '+r.row+': SANDI kosong.');
  else if(!known.has(r.code))warnings.push('SANDI '+r.code+' belum ada di Master Akun; tambahkan setelah import untuk penyesuaian.');
  if(!Number.isFinite(r.debit)||!Number.isFinite(r.credit)||r.debit<0||r.credit<0)errors.push('Baris '+r.row+': nilai debit/kredit tidak valid.');
  const key=r.date+'|'+r.number;if(!groups.has(key))groups.set(key,{date:r.date,number:r.number,description:r.description,lines:[],debit:0,credit:0});
  const g=groups.get(key);if(g.description!==r.description)errors.push('Nomor '+r.number+': keterangan berbeda dalam satu nomor bukti.');
  g.lines.push({code:r.code,note:r.note,debit:r.debit,credit:r.credit});g.debit+=Number.isFinite(r.debit)?r.debit:0;g.credit+=Number.isFinite(r.credit)?r.credit:0;
 });
 const prepared=[];for(const g of groups.values()){
  if(Math.abs(g.debit-g.credit)>.005)warnings.push(g.number+': belum seimbang (debit '+money(g.debit)+'; kredit '+money(g.credit)+'). Tetap disimpan sebagai Draft.');
  if(!g.lines.length)errors.push(g.number+': tidak memiliki baris transaksi.');
  if(state.journals.some(j=>j.number===g.number))errors.push(g.number+': nomor bukti sudah ada di Daftar Jurnal.');
  prepared.push({...g,id:crypto.randomUUID(),status:'draft',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
 }
 return {prepared,errors,warnings:[...new Set(warnings)]};
}
function showBulkPreview(rows){
 const result=validateBulkJournals(rows);pendingBulkJournals=result.errors.length?[]:result.prepared;
 $('bulk-journal-summary').textContent=rows.length+' baris · '+result.prepared.length+' nomor bukti';
 $('bulk-journal-detail').textContent=result.errors.length?'Ditemukan '+result.errors.length+' kesalahan. Perbaiki file sebelum menyimpan.':(result.warnings.length?'Data dapat diimpor sebagai Draft dengan '+result.warnings.length+' catatan penyesuaian.':'Semua data lolos pemeriksaan.');
 const notes=[...result.errors.map(e=>'KESALAHAN: '+e),...result.warnings.map(w=>'CATATAN: '+w)];
 $('bulk-journal-errors').hidden=!notes.length;$('bulk-journal-errors').innerHTML=notes.length?'<b>Hasil pemeriksaan:</b><ul>'+notes.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul>':'';
 $('bulk-journal-preview-rows').innerHTML=rows.slice(0,100).map(r=>'<tr><td>'+esc(r.date||'—')+'</td><td>'+esc(r.number)+'</td><td>'+esc(r.description)+'</td><td>'+esc(r.code)+'</td><td>'+money(r.debit)+'</td><td>'+money(r.credit)+'</td></tr>').join('');
 $('bulk-journal-save').disabled=!!result.errors.length;$('bulk-journal-review').hidden=false;
 setMessage('bulk-journal-message',result.errors.length?'Validasi gagal. Tidak ada data yang disimpan.':(result.warnings.length?'Bisa diimpor sebagai Draft. Periksa SANDI dan keseimbangan sebelum melakukan posting.':'Validasi berhasil. Data siap disimpan sebagai Draft.'),result.errors.length?'bad':(result.warnings.length?'':'good'));
}
$('bulk-journal-file').onchange=e=>{const f=e.target.files?.[0];$('bulk-journal-file-name').textContent=f?f.name:'Belum ada file dipilih.';$('bulk-journal-preview').disabled=!f;pendingBulkJournals=[];$('bulk-journal-review').hidden=true};
$('bulk-journal-preview').onclick=async()=>{const f=$('bulk-journal-file').files?.[0];if(!f)return;try{let rows;if(/\.xlsx?$/i.test(f.name)){if(!window.XLSX)throw Error('Mesin Excel lokal belum siap.');const wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:false});let found=null;for(const name of wb.SheetNames){const data=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:true});try{parseBulkJournalRows(data);found=data;break}catch{}}if(!found)throw Error('Format kolom jurnal tidak ditemukan pada sheet Excel.');rows=parseBulkJournalRows(found)}else rows=parseBulkJournalRows(parseCSV(await f.text()));showBulkPreview(rows)}catch(err){pendingBulkJournals=[];$('bulk-journal-review').hidden=true;setMessage('bulk-journal-message','Gagal membaca file: '+err.message,'bad')}};
$('bulk-journal-save').onclick=async()=>{if(!pendingBulkJournals.length)return;if(pendingBulkJournals.some(j=>isPeriodLocked(String(j.date||'').slice(0,7)))){setMessage('bulk-journal-message','Import diblokir: file berisi tanggal pada periode yang sudah ditutup.','bad');return}if(!requireImportPassword('Import Jurnal Massal'))return;const existing=new Set(state.journals.map(j=>j.number));if(pendingBulkJournals.some(j=>existing.has(j.number))){setMessage('bulk-journal-message','Ada nomor bukti yang sudah tersimpan. Periksa kembali file.','bad');return}try{state.journals.push(...pendingBulkJournals);await persist();const count=pendingBulkJournals.length;pendingBulkJournals=[];$('bulk-journal-review').hidden=true;$('bulk-journal-file').value='';$('bulk-journal-file-name').textContent='Belum ada file dipilih.';$('bulk-journal-preview').disabled=true;renderDashboard();renderJournals();setMessage('bulk-journal-message',count+' jurnal berhasil disimpan dan siap dilihat di Daftar Jurnal.','good');toast(count+' jurnal massal berhasil disimpan.');go('journal-list');const toggle=document.querySelector('[data-target="journal-list-content"]');if(toggle&&$('journal-list-content').hidden)toggle.click()}catch(err){setMessage('bulk-journal-message','Penyimpanan gagal: '+err.message,'bad')}};
$('bulk-journal-cancel').onclick=()=>{$('bulk-journal-review').hidden=true;pendingBulkJournals=[]};
$('bulk-journal-template').onclick=()=>exportXlsxSheet('Format-Import-Jurnal-Massal-SBP.xlsx','Input Jurnal',[['TANGGAL','NOBUKTI','KETERANGAN','STATUS','SANDI','KETERANGAN BARIS','DEBIT','KREDIT'],['2026-10-01','JU/001/2026','Contoh transaksi','POSTED','111.100','Kas bertambah',100000,0],['2026-10-01','JU/001/2026','Contoh transaksi','POSTED','311.100','Modal disetor',0,100000]]);

$('add-line').onclick=()=>addJournalLine();$('clear-journal').onclick=resetJournalForm;
async function saveJournal(targetStatus){
 const date=$('j-date').value,number=$('j-number').value.trim(),description=$('j-description').value.trim();
 const rows=[...document.querySelectorAll('.entry-row')].map(r=>({code:r.querySelector('.line-code').value,note:r.querySelector('.line-note').value.trim(),debit:Number(r.querySelector('.line-debit').value||0),credit:Number(r.querySelector('.line-credit').value||0)}));
 if(!date||!number||!description){setMessage('journal-message','Tanggal, nomor bukti, dan keterangan wajib diisi.','bad');return}
 if(!periodGuard(date.slice(0,7),'menyimpan atau memposting jurnal'))return;
 if(state.journals.some(j=>j.number===number&&j.id!==editingId)){setMessage('journal-message','Nomor bukti sudah digunakan.','bad');return}
 if(targetStatus==='posted'){
  if(rows.length<2||rows.some(x=>!x.code||!Number.isFinite(x.debit)||!Number.isFinite(x.credit)||(!x.debit&&!x.credit)||(x.debit&&x.credit)||x.debit<0||x.credit<0)){setMessage('journal-message','Untuk posting, setiap baris wajib memiliki akun dan hanya satu nilai debit/kredit yang valid.','bad');return}
  const debit=rows.reduce((s,x)=>s+x.debit,0),credit=rows.reduce((s,x)=>s+x.credit,0);
  if(Math.abs(debit-credit)>.005){setMessage('journal-message','Jurnal belum seimbang. Selisih: '+money(Math.abs(debit-credit)),'bad');return}
 }else if(rows.some(x=>x.debit<0||x.credit<0||!Number.isFinite(x.debit)||!Number.isFinite(x.credit))){setMessage('journal-message','Nilai debit/kredit tidak boleh negatif atau tidak valid.','bad');return}
 const old=state.journals.find(j=>j.id===editingId);
 if(old&&!periodGuard(String(old.date||'').slice(0,7),'mengubah jurnal lama'))return;
  if(old&&old.status!=='draft'){setMessage('journal-message','Jurnal terposting tidak dapat diedit. Buat jurnal koreksi/pembalik.','bad');return}
 const now=new Date().toISOString(),item={...(old||{}),id:editingId||crypto.randomUUID(),date,number,description,lines:rows,status:targetStatus,updatedAt:now};
 if(!old)item.createdAt=now;
 if(old)state.journals=state.journals.map(j=>j.id===editingId?item:j);else state.journals.push(item);
 await persist();toast(targetStatus==='posted'?'Jurnal berhasil diposting.':'Draft jurnal berhasil disimpan.');resetJournalForm();go('journal-list');renderDashboard();
}
$('save-journal').onclick=()=>saveJournal('draft');
$('post-journal').onclick=()=>saveJournal('posted');$('j-date').addEventListener('change',updateJournalBudgetPreview);
function exportJournalsXlsx(){const rows=[['TANGGAL','NOBUKTI','KETERANGAN','STATUS','SANDI','KETERANGAN BARIS','DEBIT','KREDIT'],...state.journals.flatMap(j=>(j.lines||[]).map(l=>[j.date,j.number,j.description,j.status==='draft'?'DRAFT':(j.status==='cancelled'?'DIBATALKAN / DIPECAH':'POSTED'),l.code,l.note,l.debit||0,l.credit||0]))];exportXlsxSheet('Daftar-Jurnal.xlsx','Daftar Jurnal',rows)}
function journalTable(items,actions=true){
 const totals=items.reduce((t,j)=>{for(const l of (j.lines||[])){t.debit+=Number(l.debit||0);t.credit+=Number(l.credit||0)}return t},{debit:0,credit:0});
 totals.balance=totals.debit-totals.credit;
 const rows=items.map(j=>{
  const d=(j.lines||[]).reduce((s,x)=>s+Number(x.debit||0),0),c=(j.lines||[]).reduce((s,x)=>s+Number(x.credit||0),0),bal=d-c;
  const details=(j.lines||[]).map(l=>'<tr><td>'+esc(l.code)+'</td><td>'+esc((state.accounts.find(a=>a.code===l.code)||{}).name||'—')+'</td><td>'+esc(l.note||'')+'</td><td class="num">'+money(l.debit)+'</td><td class="num">'+money(l.credit)+'</td></tr>').join('');
  return '<tr class="journal-main-row"><td>'+esc(fmtDate(j.date))+'</td><td><b>'+esc(j.number)+'</b></td><td class="journal-description">'+esc(j.description)+'</td><td><span class="tag '+(j.status==='draft'?'np-warn':'np-ok')+'">'+(j.status==='draft'?'DRAFT':(j.status==='cancelled'?'DIBATALKAN / DIPECAH':'TERPOSTING'))+'</span></td><td class="num">'+(j.lines||[]).length+'</td><td class="num">'+money(d)+'</td><td class="num">'+money(c)+'</td><td class="num '+(bal===0?'balance-ok':'balance-warn')+'">'+money(bal)+'</td>'+(actions?'<td class="journal-actions"><button class="journal-icon-btn detail-journal" data-id="'+esc(j.id)+'" title="Lihat detail" aria-label="Lihat detail">⌄</button>'+(j.status==='draft'?'<button class="journal-icon-btn edit-journal" data-id="'+esc(j.id)+'" title="Edit Draft" aria-label="Edit Draft">✎</button><button class="journal-icon-btn danger delete-journal" data-id="'+esc(j.id)+'" title="Hapus Draft" aria-label="Hapus Draft">×</button>':(j.status==='posted'&&!j.reversedBy?'<button class="journal-icon-btn split-journal" data-id="'+esc(j.id)+'" title="Split menjadi beberapa bukti" aria-label="Split jurnal">⇄</button><button class="journal-icon-btn reverse-journal" data-id="'+esc(j.id)+'" title="Buat jurnal pembalik" aria-label="Buat jurnal pembalik">↶</button>':''))+'</td>':'')+'</tr>'+(actions?'<tr class="journal-detail-row" data-detail="'+esc(j.id)+'" hidden><td colspan="9"><div class="journal-detail-box"><b>Rincian akun · '+esc(j.number)+'</b><div class="table-wrap"><table class="journal-lines-table"><thead><tr><th>SANDI</th><th>Nama akun</th><th>Keterangan baris</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>'+details+'</tbody></table></div></div></td></tr>':'');
 }).join('');
 const summary='<div class="journal-totals"><div><span>Total debit</span><b>'+money(totals.debit)+'</b></div><div><span>Total kredit</span><b>'+money(totals.credit)+'</b></div><div><span>Balance (Debit − Kredit)</span><b class="'+(totals.balance===0?'balance-ok':'balance-warn')+'">'+money(totals.balance)+'</b></div></div>';
 return summary+'<div class="table-wrap journal-table-wrap"><table class="journal-list-table"><thead><tr><th>Tanggal</th><th>No. bukti</th><th>Keterangan</th><th>Status</th><th>Baris</th><th>Total debit</th><th>Total kredit</th><th>Balance</th>'+(actions?'<th>Aksi</th>':'')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function renderJournals(){
 const q=($('journal-search').value||'').toLowerCase().trim(),status=$('journal-status-filter')?.value||'all',size=Number($('journal-page-size')?.value||10);
 const items=state.journals.filter(j=>(j.number+' '+j.description+' '+(j.date||'')).toLowerCase().includes(q)&&(status==='all'||(status==='draft'?j.status==='draft':j.status!=='draft'))).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 const pages=Math.max(1,Math.ceil(items.length/size));journalPage=Math.min(journalPage,pages-1);
 const shown=items.slice(journalPage*size,(journalPage+1)*size);
 $('journal-table').innerHTML=shown.length?journalTable(shown):'<div class="empty">Tidak ada jurnal yang cocok.</div>';
 $('journal-page-info').textContent=items.length?('Menampilkan '+(journalPage*size+1)+'–'+Math.min((journalPage+1)*size,items.length)+' dari '+items.length+' jurnal'):'0 jurnal';
 $('journal-page-current').textContent=(journalPage+1)+' / '+pages;
 $('journal-prev').disabled=journalPage===0;$('journal-next').disabled=journalPage>=pages-1;
 document.querySelectorAll('.edit-journal').forEach(b=>b.onclick=()=>editJournal(b.dataset.id));
 document.querySelectorAll('.detail-journal').forEach(b=>b.onclick=()=>{const row=document.querySelector('[data-detail="'+CSS.escape(b.dataset.id)+'"]');if(row){row.hidden=!row.hidden;b.textContent=row.hidden?'⌄':'⌃'}});
 document.querySelectorAll('.delete-journal').forEach(b=>b.onclick=async()=>{const j=state.journals.find(x=>x.id===b.dataset.id);if(!j||j.status!=='draft')return;if(!periodGuard(String(j.date||'').slice(0,7),'menghapus Draft'))return;if(confirm('Hapus Draft '+j.number+'?')){state.journals=state.journals.filter(x=>x.id!==b.dataset.id);await persist();renderJournals();renderDashboard();toast('Draft dihapus.')}});
 document.querySelectorAll('.reverse-journal').forEach(b=>b.onclick=async()=>{const j=state.journals.find(x=>x.id===b.dataset.id);if(!j||j.status!=='posted'||j.reversedBy)return;const number=prompt('Nomor bukti jurnal pembalik:',j.number+'-K');if(!number)return;if(state.journals.some(x=>x.number===number)){alert('Nomor bukti sudah digunakan.');return}const date=prompt('Tanggal jurnal pembalik (YYYY-MM-DD):',new Date().toISOString().slice(0,10));if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return;const reversal={id:crypto.randomUUID(),date,number,description:'Pembalikan atas '+j.number+' — '+j.description,lines:(j.lines||[]).map(l=>({...l,debit:Number(l.credit||0),credit:Number(l.debit||0)})),status:'posted',reversalOf:j.id,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};j.reversedBy=reversal.id;state.journals.push(reversal);await persist();renderJournals();renderDashboard();toast('Jurnal pembalik berhasil diposting.');});
 document.querySelectorAll('.split-journal').forEach(b=>b.onclick=()=>openJournalSplit(b.dataset.id));
}

/* BUILD V108 — Split Jurnal POSTED: nominal manual per hasil */
let splitSourceId=null,splitGroups=[];
function splitUI(){
 if($('split-modal'))return;
 document.body.insertAdjacentHTML('beforeend',`<div id="split-modal" class="split-overlay" hidden><section class="split-dialog" role="dialog" aria-modal="true"><header><div><span class="tag">OTORISASI ADMIN</span><h2>Split Jurnal POSTED</h2><p>Pecah jurnal menjadi beberapa nomor bukti.</p></div><button id="split-close" class="split-close">×</button></header><div id="split-origin" class="split-origin"></div><div class="split-note" id="split-note">Jurnal asli disimpan sebagai riwayat DIBATALKAN / DIPECAH. Setiap jurnal hasil wajib memiliki minimal 2 baris dan seimbang.</div><div class="split-title"><h3>Jurnal hasil</h3><button id="split-add" class="btn" type="button">＋ Tambah jurnal</button></div><div id="split-groups" class="split-groups"></div><h3>Alokasi baris akun</h3><div class="table-wrap split-lines-wrap"><table class="split-lines"><thead><tr><th>Akun</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Nomor bukti tujuan</th></tr></thead><tbody id="split-lines"></tbody></table></div><label class="split-reason">Alasan pemecahan<textarea id="split-reason" rows="2" placeholder="Wajib diisi..."></textarea></label><div id="split-check" class="split-check">Setiap jurnal baru wajib seimbang.</div><footer><button id="split-cancel" class="btn">Batal</button><button id="split-review" class="btn btn-primary">Periksa & Lanjutkan</button></footer></section></div>`);
 $('split-close').onclick=closeSplit;$('split-cancel').onclick=closeSplit;$('split-modal').onclick=e=>{if(e.target.id==='split-modal')closeSplit()};
 $('split-add').onclick=()=>{if(splitGroups.length>=12)return toast('Maksimal 12 jurnal hasil.');splitGroups.push({id:crypto.randomUUID(),number:'',date:'',description:'',amount:0});renderSplitUI()};
 $('split-review').onclick=reviewSplit;
}
function closeSplit(){if($('split-modal'))$('split-modal').hidden=true;splitSourceId=null;splitGroups=[]}
function openJournalSplit(id){
 const j=state.journals.find(x=>x.id===id);
 if(!j||!isPostedJournal(j)||j.reversedBy||j.splitInto?.length)return toast('Hanya jurnal POSTED aktif yang dapat di-split.');
 if(isPeriodLocked(String(j.date||'').slice(0,7)))return toast('Periode jurnal sudah ditutup. Buka periode dengan otorisasi terlebih dahulu.');
 if(!Array.isArray(j.lines)||j.lines.length<2)return toast('Jurnal harus memiliki minimal 2 baris akun.');
 splitUI();splitSourceId=id;const sourceDebit=j.lines.reduce((n,l)=>n+Number(l.debit||0),0),sourceCents=Math.round(sourceDebit*100),baseCents=Math.floor(sourceCents/2),extraCents=sourceCents%2;splitGroups=[1,2].map(n=>({id:crypto.randomUUID(),number:j.number+'-'+String(n).padStart(2,'0'),date:j.date,description:j.description+' — Bagian '+n,amount:(baseCents+(n<=extraCents?1:0))/100}));
 $('split-reason').value='';$('split-origin').innerHTML='<div><small>Nomor bukti asal</small><b>'+esc(j.number)+'</b></div><div><small>Tanggal</small><b>'+esc(fmtDate(j.date))+'</b></div><div><small>Total debit</small><b>'+money(j.lines.reduce((n,l)=>n+Number(l.debit||0),0))+'</b></div><div><small>Total kredit</small><b>'+money(j.lines.reduce((n,l)=>n+Number(l.credit||0),0))+'</b></div>';
 renderSplitUI();$('split-modal').hidden=false;
}
function renderSplitUI(){
 const j=state.journals.find(x=>x.id===splitSourceId);if(!j)return;
 $('split-groups').innerHTML=splitGroups.map((g,i)=>'<div class="split-group"><b>Jurnal '+(i+1)+'</b>'+(splitGroups.length>2?'<button class="split-remove" data-rm="'+g.id+'" type="button">Hapus</button>':'')+'<label>No. bukti<input data-f="number" data-id="'+g.id+'" value="'+esc(g.number)+'"></label><label>Tanggal<input type="date" data-f="date" data-id="'+g.id+'" value="'+esc(g.date)+'"></label><label>Keterangan<input data-f="description" data-id="'+g.id+'" value="'+esc(g.description)+'"></label></div>').join('');
 document.querySelectorAll('[data-f]').forEach(el=>el.oninput=()=>{let g=splitGroups.find(x=>x.id===el.dataset.id);if(g)g[el.dataset.f]=el.value});
 document.querySelectorAll('[data-rm]').forEach(el=>el.onclick=()=>{splitGroups=splitGroups.filter(g=>g.id!==el.dataset.rm);renderSplitUI()});
 if(j.lines.length===2){
  $('split-lines').closest('table').querySelector('thead').innerHTML='<tr><th>Jurnal hasil</th><th>Akun Debit</th><th>Akun Kredit</th><th>Nominal (Debit = Kredit)</th></tr>';
  const debitLine=j.lines.find(l=>Number(l.debit||0)>0),creditLine=j.lines.find(l=>Number(l.credit||0)>0);
  const debitName=(state.accounts.find(a=>String(a.code)===String(debitLine?.code))||{}).name||'';
  const creditName=(state.accounts.find(a=>String(a.code)===String(creditLine?.code))||{}).name||'';
  $('split-note').textContent='Atur nominal setiap jurnal hasil secara manual. Satu nominal akan diterapkan sama pada baris Debit dan Kredit, sehingga setiap jurnal tetap seimbang. Total seluruh nominal harus sama dengan jurnal asal.';
  $('split-lines').innerHTML=splitGroups.map((g,i)=>'<tr><td><b>Jurnal '+(i+1)+'</b><small>'+esc(g.number)+'</small></td><td><b>'+esc(debitLine?.code||'')+'</b><small>'+esc(debitName)+'</small></td><td><b>'+esc(creditLine?.code||'')+'</b><small>'+esc(creditName)+'</small></td><td><input class="split-amount-input" type="number" min="0" step="0.01" inputmode="decimal" data-amount="'+g.id+'" value="'+Number(g.amount||0).toFixed(2)+'" aria-label="Nominal jurnal '+(i+1)+'"></td></tr>').join('');
  $('split-lines').querySelectorAll('[data-amount]').forEach(el=>el.oninput=()=>{const g=splitGroups.find(x=>x.id===el.dataset.amount);if(g)g.amount=el.value===''?'':Number(el.value);const total=splitGroups.reduce((n,x)=>n+Math.round(Number(x.amount||0)*100),0)/100;$('split-check').textContent='Total nominal yang dialokasikan: '+money(total)+' · Total jurnal asal: '+money(j.lines.reduce((n,l)=>n+Number(l.debit||0),0));});
 }else{
  $('split-lines').closest('table').querySelector('thead').innerHTML='<tr><th>Akun</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Nomor bukti tujuan</th></tr>';
  const opts=splitGroups.map((g,i)=>'<option value="'+g.id+'">Jurnal '+(i+1)+' · '+esc(g.number)+'</option>').join('');
  $('split-note').textContent='Setiap baris akun dipindahkan utuh ke satu jurnal hasil. Setiap jurnal hasil wajib memiliki minimal 2 baris dan seimbang.';
  $('split-lines').innerHTML=j.lines.map((l,i)=>'<tr><td><b>'+esc(l.code)+'</b><small>'+esc((state.accounts.find(a=>String(a.code)===String(l.code))||{}).name||'')+'</small></td><td>'+esc(l.note||'—')+'</td><td>'+money(l.debit)+'</td><td>'+money(l.credit)+'</td><td><select class="split-target" data-i="'+i+'">'+opts+'</select></td></tr>').join('');
  $('split-lines').querySelectorAll('select').forEach((el,i)=>el.value=splitGroups[i%splitGroups.length].id);
 }
}
function reviewSplit(){
 const j=state.journals.find(x=>x.id===splitSourceId),reason=$('split-reason').value.trim(),errors=[];
 if(!j||!isPostedJournal(j))return closeSplit();if(!reason)errors.push('Alasan pemecahan wajib diisi.');
 splitGroups.forEach((g,i)=>{if(!g.number.trim()||!g.date||!g.description.trim())errors.push('Nomor bukti, tanggal, dan keterangan jurnal '+(i+1)+' wajib diisi.');if(state.journals.some(x=>String(x.number).trim()===g.number.trim()))errors.push('Nomor bukti '+g.number+' sudah digunakan.');if(g.date&&isPeriodLocked(g.date.slice(0,7)))errors.push('Tanggal jurnal '+(i+1)+' berada pada periode yang sudah ditutup.')});
 if(new Set(splitGroups.map(g=>g.number.trim())).size!==splitGroups.length)errors.push('Nomor bukti hasil tidak boleh sama.');
 let chunks;
 if(j.lines.length===2){const debit=j.lines.reduce((n,l)=>n+Number(l.debit||0),0),credit=j.lines.reduce((n,l)=>n+Number(l.credit||0),0);if(Math.abs(debit-credit)>.005||j.lines.filter(l=>Number(l.debit||0)>0).length!==1||j.lines.filter(l=>Number(l.credit||0)>0).length!==1)errors.push('Jurnal 2 baris harus terdiri dari satu baris Debit dan satu baris Kredit dengan total yang sama.');chunks=splitGroups.map(g=>{const cents=Math.round(Number(g.amount||0)*100);return {group:g,lines:j.lines.map(l=>({...l,debit:Number(l.debit||0)>0?cents/100:0,credit:Number(l.credit||0)>0?cents/100:0}))}});const allocated=splitGroups.reduce((n,g)=>n+Math.round(Number(g.amount||0)*100),0);if(splitGroups.some(g=>g.amount===''||!Number.isFinite(Number(g.amount))||Number(g.amount)<0))errors.push('Nominal setiap jurnal harus diisi dengan angka nol atau lebih.');if(allocated!==Math.round(debit*100))errors.push('Jumlah nominal seluruh jurnal hasil harus sama persis dengan total jurnal asal: '+money(debit)+'.')}
 else{const allocations=[...$('split-lines').querySelectorAll('select')].map(el=>splitGroups.find(g=>g.id===el.value));chunks=splitGroups.map(g=>({group:g,lines:j.lines.filter((l,i)=>allocations[i]?.id===g.id)}))}
 chunks.forEach((x,i)=>{let d=x.lines.reduce((n,l)=>n+Number(l.debit||0),0),c=x.lines.reduce((n,l)=>n+Number(l.credit||0),0);if(x.lines.length<2)errors.push('Jurnal hasil '+(i+1)+' wajib memiliki minimal 2 baris akun.');if(Math.abs(d-c)>.005)errors.push('Jurnal '+(i+1)+' tidak seimbang: '+money(d)+' vs '+money(c)+'.')});
 if(errors.length){$('split-check').className='split-check bad';$('split-check').innerHTML=errors.map(esc).join('<br>');return}
 const sumD=j.lines.reduce((n,l)=>n+Number(l.debit||0),0),sumC=j.lines.reduce((n,l)=>n+Number(l.credit||0),0);
 if(Math.abs(sumD-chunks.reduce((n,x)=>n+x.lines.reduce((a,l)=>a+Number(l.debit||0),0),0))>.005||Math.abs(sumC-chunks.reduce((n,x)=>n+x.lines.reduce((a,l)=>a+Number(l.credit||0),0),0))>.005)return toast('Total hasil split tidak sama dengan jurnal asal.');
 const summary=chunks.map((x,i)=>(i+1)+'. '+x.group.number+' ('+x.lines.length+' baris)').join('\n');
 if(!confirm('Jurnal asal: '+j.number+'\n'+summary+'\n\nSetiap jurnal baru seimbang. Total tetap '+money(sumD)+' / '+money(sumC)+'. Lanjut?'))return;
 const pw=prompt('Masukkan password administrator yang sama dengan Hapus Paksa / Tutup Buku:');if(pw===null)return;if(pw!=='PKS123')return toast('Password salah. Split dibatalkan.');
 if(!confirm('Konfirmasi akhir: jurnal asal tidak lagi dihitung dalam laporan dan akan digantikan jurnal-jurnal baru. Riwayat asal tetap tersimpan.'))return;
 executeSplit(j,chunks,reason);
}
async function executeSplit(source,chunks,reason){
 try{
  const backup=makeBackupPayload(),ok=await runAutomaticBackup('sebelum split '+source.number);
  if(!ok)downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),'SBP-BACKUP-SEBELUM-SPLIT-'+String(source.number).replace(/[^a-z0-9_-]/gi,'_')+'.json');
  const now=new Date().toISOString(),before=auditClone(source),created=chunks.map(x=>({id:crypto.randomUUID(),date:x.group.date,number:x.group.number.trim(),description:x.group.description.trim(),lines:x.lines.map(l=>({...l})),status:'posted',createdAt:now,updatedAt:now,postedAt:now,splitFrom:source.id,splitFromNumber:source.number}));
  source.status='cancelled';source.splitAt=now;source.splitReason=reason;source.splitInto=created.map(x=>x.id);source.splitBy='Administrator lokal';state.journals.push(...created);
  state.auditLogs.unshift({id:crypto.randomUUID(),at:now,action:'SPLIT JURNAL POSTED',entity:'Jurnal',entityId:source.id,summary:'Jurnal '+source.number+' dipecah menjadi '+created.map(x=>x.number).join(', ')+'. Alasan: '+reason,before,after:auditClone({sourceStatus:'cancelled',createdJournals:created,reason})});
  await persist();closeSplit();renderJournals();renderDashboard();renderTrialBalance();toast('Split berhasil. '+created.length+' jurnal baru sudah POSTED.');
 }catch(e){console.error(e);const src=state.journals.find(x=>x.id===source.id);if(src&&src.status==='cancelled'){src.status='posted';delete src.splitAt;delete src.splitReason;delete src.splitInto;delete src.splitBy;state.journals=state.journals.filter(x=>x.splitFrom!==source.id)}toast('Split gagal disimpan: '+e.message+'. Jurnal asal dipulihkan di layar; periksa backup.')}
}

let journalPage=0;
function editJournal(id){const j=state.journals.find(x=>x.id===id);if(!j||j.status!=='draft'){toast('Hanya Draft yang dapat diedit.');return}editingId=id;$('j-date').value=j.date;$('j-number').value=j.number;$('j-description').value=j.description;$('journal-lines').innerHTML='';j.lines.forEach(l=>addJournalLine(l));$('save-journal').textContent='Simpan perubahan Draft';$('post-journal').textContent='Posting Jurnal';go('journal')}
let bulkPostCandidates=[];
function updateBulkPostMode(){
 const mode=$('bulk-post-mode').value;
 $('bulk-post-date-wrap').hidden=mode!=='date';
 $('bulk-post-month-wrap').hidden=mode!=='month';
 $('bulk-post-from-wrap').hidden=mode!=='range';
 $('bulk-post-to-wrap').hidden=mode!=='range';
 $('bulk-post-result').hidden=true;$('bulk-post-confirm').disabled=true;bulkPostCandidates=[];
}
function validateBulkPostJournal(j){
 const lines=j.lines||[];
 if(lines.length<2)return 'Minimal harus memiliki 2 baris akun.';
 let debit=0,credit=0;
 for(let i=0;i<lines.length;i++){
  const l=lines[i],d=Number(l.debit||0),c=Number(l.credit||0);
  if(!l.code||!state.accounts.some(a=>String(a.code)===String(l.code)))return 'Baris '+(i+1)+': akun tidak ditemukan di Master Akun.';
  if(!Number.isFinite(d)||!Number.isFinite(c)||d<0||c<0)return 'Baris '+(i+1)+': nilai debit/kredit tidak valid.';
  if(!((d>0&&c===0)||(c>0&&d===0)))return 'Baris '+(i+1)+': isi tepat satu sisi debit atau kredit.';
  debit+=d;credit+=c;
 }
 if(Math.abs(debit-credit)>0.000001)return 'Tidak seimbang. Debit '+money(debit)+' dan kredit '+money(credit)+'.';
 return '';
}
function previewBulkPosting(){
 const mode=$('bulk-post-mode').value;let from='',to='';
 if(mode==='date'){from=to=$('bulk-post-date').value}
 else if(mode==='month'){const m=$('bulk-post-month').value;if(m){from=m+'-01';const [y,mm]=m.split('-').map(Number);const lastDay=new Date(y,mm,0).getDate();to=m+'-'+String(lastDay).padStart(2,'0')}}
 else {from=$('bulk-post-from').value;to=$('bulk-post-to').value}
 if(!from||!to||from>to){toast('Periode tanggal belum benar.');return}
 const drafts=state.journals.filter(j=>j.status==='draft'&&String(j.date||'')>=from&&String(j.date||'')<=to);
 const valid=[],invalid=[];
 drafts.forEach(j=>{const reason=validateBulkPostJournal(j);(reason?invalid:valid).push({journal:j,reason})});
 bulkPostCandidates=valid.map(x=>x.journal);
 const totalDebit=valid.reduce((s,j)=>s+(j.lines||[]).reduce((n,l)=>n+Number(l.debit||0),0),0);
 const totalCredit=valid.reduce((s,j)=>s+(j.lines||[]).reduce((n,l)=>n+Number(l.credit||0),0),0);
 const invalidHtml=invalid.length?'<div class="bulk-post-invalid"><b>Draft tidak dapat diposting ('+invalid.length+')</b><ul>'+invalid.map(x=>'<li><b>'+esc(x.journal.number)+'</b> · '+esc(x.reason)+'</li>').join('')+'</ul></div>':'<p class="balance-ok">Semua Draft dalam periode lolos validasi.</p>';
 $('bulk-post-result').innerHTML='<div class="bulk-post-stats"><div><span>Periode</span><b>'+esc(fmtDate(from))+' – '+esc(fmtDate(to))+'</b></div><div><span>Draft ditemukan</span><b>'+drafts.length+'</b></div><div><span>Siap diposting</span><b>'+valid.length+'</b></div><div><span>Total debit / kredit valid</span><b>'+money(totalDebit)+' / '+money(totalCredit)+'</b></div></div>'+invalidHtml;
 $('bulk-post-result').hidden=false;$('bulk-post-confirm').disabled=valid.length===0;
}
$('bulk-post-mode').addEventListener('change',updateBulkPostMode);
$('bulk-post-preview').addEventListener('click',previewBulkPosting);
$('bulk-post-confirm').addEventListener('click',async()=>{
 const ids=new Set(bulkPostCandidates.map(j=>j.id));if(!ids.size)return;if(bulkPostCandidates.some(j=>isPeriodLocked(String(j.date||'').slice(0,7)))){toast('Posting diblokir: ada Draft dari periode yang sudah ditutup.');return}
 const count=ids.size;
 if(!confirm('Konfirmasi posting '+count+' jurnal Draft yang sudah lolos validasi? Jurnal yang tidak valid tetap menjadi Draft.'))return;
 const now=new Date().toISOString();
 state.journals.forEach(j=>{if(ids.has(j.id)){j.status='posted';j.updatedAt=now;j.postedAt=now}});
 await persist();bulkPostCandidates=[];$('bulk-post-confirm').disabled=true;$('bulk-post-result').innerHTML='<p class="balance-ok"><b>'+count+' jurnal berhasil diposting.</b> Draft yang tidak lolos validasi tetap berstatus Draft.</p>';$('bulk-post-result').hidden=false;
 renderJournals();renderDashboard();renderTrialBalance();toast(count+' jurnal berhasil diposting secara kolektif.');
});
$('journal-search').addEventListener('input',()=>{journalPage=0;renderJournals()});$('journal-status-filter').addEventListener('change',()=>{journalPage=0;renderJournals()});$('journal-page-size').addEventListener('change',()=>{journalPage=0;renderJournals()});$('journal-prev').onclick=()=>{journalPage=Math.max(0,journalPage-1);renderJournals()};$('journal-next').onclick=()=>{journalPage++;renderJournals()};$('export-journals-xlsx').onclick=exportJournalsXlsx;

function syncNptransSandis(){const map=new Map(state.accounts.map(a=>[String(a.code),a]));let added=0;for(const row of state.nptrans){const code=String(row.sandi||'').trim();if(code&&!map.has(code)){map.set(code,{code,name:''});added++}}if(added)state.accounts=[...map.values()];return added}
function renderAccounts(){const q=($('account-search')?.value||'').trim().toLowerCase(),items=state.accounts.filter(a=>(a.code+' '+a.name).toLowerCase().includes(q)).sort((a,b)=>a.code.localeCompare(b.code));$('account-count').textContent=state.accounts.length.toLocaleString('id-ID')+' AKUN';$('account-rows').innerHTML=items.length?items.map((a,index)=>'<tr><td>'+(index+1)+'</td><td><b>'+esc(a.code)+'</b></td><td>'+esc(a.name)+'</td><td><button class="btn edit-account" data-code="'+esc(a.code)+'">Edit</button> <button class="icon-btn delete-account" data-code="'+esc(a.code)+'">Hapus</button></td></tr>').join(''):'<tr><td colspan="4" class="empty">Tidak ada akun yang cocok.</td></tr>';document.querySelectorAll('.edit-account').forEach(b=>b.onclick=()=>editAccount(b.dataset.code));document.querySelectorAll('.delete-account').forEach(b=>b.onclick=async()=>{const code=b.dataset.code,usedOpening=(state.openingBalances||[]).some(x=>x.accountCode===code),usedJournal=state.journals.some(j=>(j.lines||[]).some(l=>l.code===code)),usedNp=state.nptrans.some(r=>r.sandi===code);if(usedOpening){toast('Akun tidak dapat dihapus karena masih memiliki saldo awal. Hapus saldo awal terkait terlebih dahulu.');return}const warning=usedJournal||usedNp?'\n\nKode ini masih dipakai pada transaksi. Jika dihapus, data tetap ada tetapi akun menjadi tidak cocok.':'';if(confirm('Hapus akun '+code+'?'+warning)){state.accounts=state.accounts.filter(x=>x.code!==code);if(editingAccountCode===code)resetAccountForm();await persist();renderAccounts();renderNptrans();toast('Akun dihapus.')}})}
function resetAccountForm(){editingAccountCode=null;$('a-code').value='';$('a-code').disabled=false;$('a-name').value='';$('save-account').textContent='＋ Tambah akun';$('cancel-account-edit').hidden=true}
function editAccount(code){const a=state.accounts.find(x=>x.code===code);if(!a)return;editingAccountCode=code;$('a-code').value=a.code;$('a-code').disabled=true;$('a-name').value=a.name;$('save-account').textContent='Simpan perubahan';$('cancel-account-edit').hidden=false;$('a-name').focus()}
$('cancel-account-edit').onclick=resetAccountForm;$('account-search').addEventListener('input',renderAccounts);
 $('clear-all-accounts').onclick=async()=>{const count=state.accounts.length;if(!count)return toast('Master Akun sudah kosong.');if(!requireImportPassword('menghapus seluruh Master Akun'))return;if(!confirm('KONFIRMASI PENGHAPUSAN MASTER AKUN\\n\\nSebanyak '+count+' akun akan dihapus dari Master Akun. Jurnal, saldo awal, NPTRANS, anggaran, dan riwayat audit TIDAK dihapus. Data transaksi lama dapat menampilkan kode akun tanpa nama sampai akun baru diimpor.\\n\\nLanjutkan?'))return;const backup=makeBackupPayload(),ok=await runAutomaticBackup('sebelum menghapus seluruh Master Akun');if(!ok)downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),'SBP-BACKUP-SEBELUM-HAPUS-MASTER-AKUN.json');try{state.accounts=[];await persist();resetAccountForm();renderAccounts();renderNptrans();initAnnualBudget();renderOpeningBalances();toast(count+' akun dihapus. Data transaksi dan saldo tetap dipertahankan.')}catch(e){state.accounts=backup.state.accounts||[];toast('Penghapusan gagal disimpan: '+e.message)}};
$('save-account').onclick=async()=>{const code=$('a-code').value.trim(),name=$('a-name').value.trim();if(!code||!name){toast('Isi kode dan nama akun.');return}if(editingAccountCode){const a=state.accounts.find(x=>x.code===editingAccountCode);if(!a)return;a.name=name}else{if(state.accounts.some(a=>a.code===code)){toast('Kode akun sudah ada. Gunakan tombol Edit.');return}state.accounts.push({code,name})}const wasEditing=!!editingAccountCode;await persist();resetAccountForm();renderAccounts();renderNptrans();toast(wasEditing?'Akun diperbarui.':'Akun baru ditambahkan.')};
function accountRowsAoa(){return [['SANDI','NAMA'],...state.accounts.map(a=>[a.code,a.name])]}
function exportAccountsCsv(){const rows=accountRowsAoa();downloadBlob(new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'Master-Akun-SBP.csv')}
function exportAccountsXlsx(){exportXlsxSheet('Master-Akun-SBP.xlsx','Master Akun',accountRowsAoa())}
$('export-accounts').onclick=exportAccountsCsv;$('export-accounts-xlsx').onclick=exportAccountsXlsx;
function parseCSV(text){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'&&quoted&&next==='"'){cell+='"';i++}else if(ch==='"'){quoted=!quoted}else if(ch===','&&!quoted){row.push(cell);cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&next==='\n')i++;row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);row=[];cell=''}else cell+=ch}row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);return rows}
function norm(s){return String(s||'').replace(new RegExp('^'+String.fromCharCode(65279)),'').trim().toUpperCase().replace(/[ _-]/g,'')}
function mapHeaders(header){const aliases={SANDI:['SANDI','KODE','KODEAKUN','ACCOUNT'],TANGGAL:['TANGGAL','DATE'],NOBUKTI:['NOBUKTI','NOMORBUKTI','BUKTI'],NOURUT:['NOURUT','URUT','NO'],KET:['KET','KETERANGAN','URAIAN'],JUMLAH:['JUMLAH','NILAI','AMOUNT']};const out={};header.forEach((h,i)=>{for(const [key,vals] of Object.entries(aliases))if(vals.includes(norm(h)))out[key]=i});return out}
function normalizeDate(v){v=String(v||'').trim();if(/^\d{8}$/.test(v))return v.slice(6,8)+'/'+v.slice(4,6)+'/'+v.slice(0,4);if(/^\d{4}-\d\d-\d\d$/.test(v)){const [y,m,d]=v.split('-');return d+'/'+m+'/'+y}return v}
function parseAmount(v){if(v===null||v===undefined||v==='')return 0;if(typeof v==='number')return Number.isFinite(v)?v:NaN;let s=String(v).trim().replace(/[\\s\\u00a0]/g,'').replace(/^Rp/i,'');if(!s)return 0;s=s.replace(/[^0-9,.-]/g,'');if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(s.includes(',')){const parts=s.split(',');s=parts.length===2&&parts[1].length<=2?s.replace(',','.'):s.replace(/,/g,'')}const n=Number(s);return Number.isFinite(n)?n:NaN}
function csvToNp(text){const rows=parseCSV(text);if(rows.length<2)throw Error('CSV kosong atau hanya memiliki header.');const h=mapHeaders(rows[0]);const missing=['SANDI','TANGGAL','NOBUKTI','NOURUT','KET','JUMLAH'].filter(k=>h[k]===undefined);if(missing.length)throw Error('Kolom wajib tidak ditemukan: '+missing.join(', '));return rows.slice(1).map((r,i)=>({sandi:(r[h.SANDI]||'').trim(),tanggal:normalizeDate(r[h.TANGGAL]),nobukti:(r[h.NOBUKTI]||'').trim(),nourut:(r[h.NOURUT]||'').trim(),ket:(r[h.KET]||'').trim(),jumlah:parseAmount(r[h.JUMLAH]),_row:i+2}))}
function csvToAccounts(text){const rows=parseCSV(text);if(rows.length<2)throw Error('CSV master akun kosong.');const aliases={code:['SANDI','KODE','KODEAKUN','ACCOUNTCODE'],name:['NAMA','NAMAAKUN','DES','KETERANGAN','URAIAN']};let cols=null,header=-1;for(let i=0;i<Math.min(rows.length,30);i++){const h=rows[i].map(norm),find=names=>h.findIndex(x=>names.includes(x)),ci=find(aliases.code);if(ci>=0){cols={ci,ni:find(aliases.name)};header=i;break}}if(!cols)throw Error('Kolom SANDI tidak ditemukan. Pastikan baris judul tabel memuat kolom SANDI.');const data=rows.slice(header+1).filter(r=>r[cols.ci]&&String(r[cols.ci]).trim());if(!data.length)throw Error('Header SANDI ditemukan, tetapi tidak ada baris akun di bawahnya.');return data.map(r=>({code:String(r[cols.ci]).trim(),name:cols.ni>=0?String(r[cols.ni]||'').trim():''}))}

function xlsxFirstSheetToCsv(buffer){if(!window.XLSX)throw Error('Mesin Excel lokal belum termuat. Muat ulang aplikasi.');const wb=XLSX.read(buffer,{type:'array',cellDates:false});const name=wb.SheetNames[0];if(!name)throw Error('Workbook tidak memiliki lembar kerja.');return XLSX.utils.sheet_to_csv(wb.Sheets[name],{FS:',',RS:'\n'})}
function xlsxToAccounts(buffer){if(!window.XLSX)throw Error('Mesin Excel lokal belum termuat. Muat ulang aplikasi.');const wb=XLSX.read(buffer,{type:'array',cellDates:false}),aliases={code:['SANDI','KODE','KODEAKUN','ACCOUNTCODE'],name:['NAMA','NAMAAKUN','DES','KETERANGAN','URAIAN']};for(const sheetName of wb.SheetNames){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetName],{header:1,defval:'',raw:false});for(let i=0;i<Math.min(rows.length,50);i++){const h=rows[i].map(norm),find=names=>h.findIndex(x=>names.includes(x)),ci=find(aliases.code);if(ci<0)continue;const ni=find(aliases.name),data=rows.slice(i+1).filter(r=>String(r[ci]??'').trim()!=='');if(data.length)return data.map(r=>({code:String(r[ci]).trim(),name:ni>=0?String(r[ni]??'').trim():''}));}}throw Error('Kolom SANDI tidak ditemukan atau tidak ada data akun.')}
function exportXlsxSheet(filename,sheetName,rows){if(!window.XLSX){toast('Mesin Excel belum siap.');return}const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,sheetName);const out=XLSX.write(wb,{bookType:'xlsx',type:'array'});downloadBlob(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename)}
function parseDBF(buffer){
 const b=new Uint8Array(buffer),v=new DataView(buffer);
 if(b.length<33)throw Error('File terlalu kecil untuk DBF.');
 const count=v.getUint32(4,true),headerLen=v.getUint16(8,true),recordLen=v.getUint16(10,true);
 if(headerLen<33||recordLen<2||headerLen>b.length)throw Error('Header DBF tidak valid.');
 const fields=[];let fieldBytes=0;
 for(let p=32;p<headerLen-1&&b[p]!==0x0d;p+=32){
  if(p+32>headerLen)throw Error('Deskripsi field DBF terpotong.');
  let end=p;while(end<p+11&&b[end])end++;
  const name=new TextDecoder('ascii').decode(b.slice(p,end));
  const field={name,type:String.fromCharCode(b[p+11]),length:b[p+16],decimals:b[p+17],raw:b.slice(p,p+32)};
  if(!field.name||!field.length)throw Error('Deskripsi kolom DBF tidak lengkap.');
  fields.push(field);fieldBytes+=field.length;
 }
 if(!fields.length||fieldBytes+1>recordLen)throw Error('Struktur kolom tidak sesuai panjang record DBF.');
 const available=Math.floor((b.length-headerLen)/recordLen);
 if(count>available)throw Error('Jumlah record pada header melebihi isi file.');
 const records=[],decoder=new TextDecoder('windows-1252');
 for(let i=0,p=headerLen;i<count&&p+recordLen<=b.length;i++,p+=recordLen){
  if(b[p]===0x2a)continue;
  let q=p+1,obj={};
  for(const f of fields){
   // File NPTRANS lama memakai byte NUL sebagai padding pada field numerik.
   const raw=decoder.decode(b.slice(q,q+f.length)).replace(/\u0000/g,'').trim();q+=f.length;
   let val=raw;
   if(f.type==='N'||f.type==='F'){
    if(raw==='')val=0;
    else {const n=Number(raw);val=Number.isFinite(n)?n:NaN}
   }else if(f.type==='D'&&/^\d{8}$/.test(raw))val=raw;
   else if(f.type==='L')val=/^(T|Y)$/i.test(raw);
   obj[f.name]=val;
  }
  records.push(obj);
 }
 return {fields,records,recordCount:count,activeCount:records.length,deletedCount:count-records.length,headerLen,recordLen,version:b[0]};
}
function dbfToNp(parsed){return parsed.records.map((r,i)=>{const o={};for(const k of Object.keys(r))o[norm(k)]=r[k];return {sandi:String(o.SANDI??''),tanggal:normalizeDate(o.TANGGAL),nobukti:String(o.NOBUKTI??''),nourut:String(o.NOURUT??''),ket:String(o.KET??''),jumlah:typeof o.JUMLAH==='number'?o.JUMLAH:parseAmount(o.JUMLAH),_row:i+1}})}
function downloadBlob(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500)}
function csvCell(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function npRowsAoa(){return [['SANDI','TANGGAL','NOBUKTI','NOURUT','KET','JUMLAH'],...state.nptrans.map(r=>[r.sandi,r.tanggal,r.nobukti,r.nourut,r.ket,r.jumlah])]}
function exportNpCsv(){const rows=[['SANDI','TANGGAL','NOBUKTI','NOURUT','KET','JUMLAH'],...state.nptrans.map(r=>[r.sandi,r.tanggal,r.nobukti,r.nourut,r.ket,r.jumlah])];downloadBlob(new Blob(['\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'NPTRANS-export.csv')}
function exportNpXlsx(){exportXlsxSheet('NPTRANS-export.xlsx','NPTRANS',npRowsAoa())}
function fieldValue(row,field){const name=norm(field.name);let value='';if(name==='SANDI')value=row.sandi;else if(name==='TANGGAL')value=row.tanggal;else if(name==='NOBUKTI')value=row.nobukti;else if(name==='NOURUT')value=row.nourut;else if(name==='KET')value=row.ket;else if(name==='JUMLAH')value=row.jumlah;return value}
function exportDbf(){if(!state.npTemplate?.fields?.length){setMessage('np-message','Ekspor DBF belum tersedia: unggah file NPTRANS.DBF asli terlebih dahulu agar struktur field tidak ditebak.','bad');return}const fields=state.npTemplate.fields,headerLen=32+fields.length*32+1,recordLen=1+fields.reduce((s,f)=>s+f.length,0),count=state.nptrans.length,buffer=new ArrayBuffer(headerLen+recordLen*count+1),b=new Uint8Array(buffer),v=new DataView(buffer);b[0]=state.npTemplate.version||0x03;const now=new Date();b[1]=now.getFullYear()-1900;b[2]=now.getMonth()+1;b[3]=now.getDate();v.setUint32(4,count,true);v.setUint16(8,headerLen,true);v.setUint16(10,recordLen,true);let p=32;for(const f of fields){const name=new TextEncoder().encode(f.name);b.set(name.slice(0,11),p);b[p+11]=f.type.charCodeAt(0);b[p+16]=f.length;b[p+17]=f.decimals||0;b.set(f.raw.slice(18,32),p+18);p+=32}b[p]=0x0d;p++;const enc=new TextEncoder();for(const row of state.nptrans){b[p]=0x20;p++;for(const f of fields){let val=fieldValue(row,f),out='';if(f.type==='C'){out=String(val??'').slice(0,f.length).padEnd(f.length,' ')}else if(f.type==='N'||f.type==='F'){const n=Number(val||0);out=Number.isFinite(n)?(f.decimals? n.toFixed(f.decimals):String(Math.trunc(n))):'';out=out.slice(-f.length).padStart(f.length,' ')}else if(f.type==='D'){let s=String(val||'').trim();if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)){const [dd,mm,yyyy]=s.split('/');s=yyyy+mm+dd}else if(/^\d{4}-\d\d-\d\d$/.test(s))s=s.replace(/-/g,'');else s=s.replace(/[^0-9]/g,'');out=(s.length===8?s:'        ').padEnd(f.length,' ')}else if(f.type==='L'){out=val?'T':'F'}else{out=''.padEnd(f.length,' ')}const bytes=enc.encode(out);b.set(bytes.slice(0,f.length),p);if(bytes.length<f.length){for(let k=bytes.length;k<f.length;k++)b[p+k]=0x20}p+=f.length}}b[p]=0x1a;downloadBlob(new Blob([buffer],{type:'application/octet-stream'}),'NPTRANS.DBF');setMessage('np-message','File NPTRANS.DBF berhasil dibuat berdasarkan struktur template yang diunggah. Tetap uji pada salinan program NPTRANS lama.','good')}
let npPage=1;const NP_PAGE_SIZE=100;
function renderNptrans(){
 const q=($('np-search')?.value||'').trim().toLowerCase();
 const filtered=state.nptrans.filter(r=>[r.sandi,r.tanggal,r.nobukti,r.nourut,r.ket,String(r.jumlah)].join(' ').toLowerCase().includes(q));
 const missing=filtered.filter(r=>!state.accounts.some(a=>a.code===r.sandi)).length;
 const bad=filtered.filter(r=>!r.sandi||!r.nobukti||!Number.isFinite(Number(r.jumlah))).length;
 const total=state.nptrans.reduce((s,r)=>s+(Number(r.jumlah)||0),0);
 $('np-summary').textContent=state.nptrans.length.toLocaleString('id-ID')+' baris tersimpan · '+missing.toLocaleString('id-ID')+' kode akun belum cocok pada hasil filter · '+bad+' baris perlu diperiksa';
 if($('np-total'))$('np-total').textContent=money(total);
 const pages=Math.max(1,Math.ceil(filtered.length/NP_PAGE_SIZE));npPage=Math.min(npPage,pages);
 const slice=filtered.slice((npPage-1)*NP_PAGE_SIZE,npPage*NP_PAGE_SIZE);
 $('np-rows').innerHTML=slice.length?slice.map(r=>{const ok=state.accounts.some(a=>a.code===r.sandi);return '<tr><td>'+esc(r.sandi)+'</td><td>'+esc(r.tanggal)+'</td><td>'+esc(r.nobukti)+'</td><td>'+esc(r.nourut)+'</td><td class="np-ket">'+esc(r.ket)+'</td><td class="np-amount">'+money(r.jumlah)+'</td><td><span class="tag '+(ok?'np-ok':'np-warn')+'">'+(ok?'AKUN COCOK':'CEK AKUN')+'</span></td></tr>'}).join(''):'<tr><td colspan="7" class="empty">Tidak ada data yang cocok dengan pencarian.</td></tr>';
 if($('np-page-info'))$('np-page-info').textContent=filtered.length?('Menampilkan '+((npPage-1)*NP_PAGE_SIZE+1)+'–'+Math.min(npPage*NP_PAGE_SIZE,filtered.length)+' dari '+filtered.length.toLocaleString('id-ID')+' baris'):'0 baris';
 if($('np-prev'))$('np-prev').disabled=npPage<=1;
 if($('np-next'))$('np-next').disabled=npPage>=pages;
 $('template-status').textContent=state.npTemplate?'Template tersimpan: '+state.npTemplate.fields.map(f=>f.name).join(', '):'Belum ada template DBF.';
}
function isoNpDate(value){const s=String(value||'').trim();let m=s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(m)return m[3]+'-'+m[2]+'-'+m[1];if(/^\d{4}-\d\d-\d\d$/.test(s))return s;return new Date().toISOString().slice(0,10)}
function nextNpJournalNumber(date){const stamp=String(date||'').replace(/-/g,'');let n=1;while(state.journals.some(j=>j.number==='NP-'+stamp+'-'+String(n).padStart(3,'0')))n++;return 'NP-'+stamp+'-'+String(n).padStart(3,'0')}
function createNpDraftJournals(rows){
 const groups=new Map();
 for(const row of rows){
  if(row._journalId)continue;
  const date=isoNpDate(row.tanggal),sourceNo=String(row.nobukti||'').trim();
  const key=date+'|'+sourceNo;
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 let created=0,linked=0;
 for(const [key,items] of groups){
  const date=key.split('|')[0],sourceNo=key.slice(date.length+1);if(!periodGuard(date.slice(0,7),'membentuk Draft dari NPTRANS'))continue;
  // If an earlier import already created this source draft, link legacy rows to it instead of duplicating it.
  let journal=state.journals.find(j=>j.status==='draft'&&j.source==='NPTRANS'&&j.date===date&&String(j.sourceVoucher||'')===sourceNo);
  if(journal){
   items.forEach(r=>r._journalId=journal.id);
   linked+=items.length;
   continue;
  }
  const id=crypto.randomUUID();
  journal={id,date,number:nextNpJournalNumber(date),description:'Import NPTRANS · '+(sourceNo||'Tanpa nomor bukti'),status:'draft',source:'NPTRANS',sourceVoucher:sourceNo,lines:items.map(r=>({code:String(r.sandi||'').trim(),note:String(r.ket||'')+' | JUMLAH sumber: '+money(r.jumlah)+' | Urut: '+String(r.nourut||''),debit:0,credit:0})),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  state.journals.push(journal);
  items.forEach(r=>r._journalId=id);
  created++;
 }
 return {created,linked};
}
function npKey(r){return [r.sandi,r.tanggal,r.nobukti,r.nourut,r.ket,Number(r.jumlah).toFixed(2)].map(v=>String(v??'').trim().toUpperCase()).join('|')}
function cancelNpImport(){pendingNpImport=null;$('np-import-review').hidden=true;$('np-file').value='';setMessage('np-message','Pratinjau impor dibatalkan. Data yang sudah tersimpan tidak berubah.')}
$('np-import-cancel').onclick=cancelNpImport;
$('np-file').onchange=async e=>{
 const f=e.target.files[0];if(!f)return;
 try{
  let rows,p=null;
  if(f.name.toLowerCase().endsWith('.dbf')){p=parseDBF(await f.arrayBuffer());rows=dbfToNp(p)}
  else if(/\.xlsx?$/i.test(f.name))rows=csvToNp(xlsxFirstSheetToCsv(await f.arrayBuffer()));
  else rows=csvToNp(await f.text());
  const valid=rows.filter(r=>r.sandi&&r.nobukti&&Number.isFinite(Number(r.jumlah))),rejected=rows.length-valid.length;
  const mode=$('np-import-mode').value;
  const existing=new Set(state.nptrans.map(npKey)),incoming=new Set();let duplicates=0;
  if(mode==='merge'){for(const row of valid){const k=npKey(row);if(existing.has(k)||incoming.has(k))duplicates++;else incoming.add(k)}}
  pendingNpImport={fileName:f.name,rows:valid,parsed:p,rejected,mode,duplicates,totalRead:rows.length};
  const modeName={merge:'Gabungkan tanpa duplikat',append:'Tambah semua baris',replace:'Ganti seluruh data NPTRANS'}[mode];
  $('np-import-review-title').textContent='Pratinjau: '+f.name;
  $('np-import-review-detail').textContent='Mode: '+modeName+' · Dibaca '+rows.length+' record · Valid '+valid.length+' · Duplikat yang akan dilewati '+(mode==='merge'?duplicates:0)+' · Ditolak '+rejected+'. Belum ada data yang disimpan.';
  $('np-import-review').hidden=false;
  setMessage('np-message','File berhasil dibaca. Periksa ringkasan di bawah, lalu tekan “Setujui & masukkan data” untuk melanjutkan.','good');
 }catch(err){pendingNpImport=null;$('np-import-review').hidden=true;setMessage('np-message','Pembacaan file gagal: '+err.message,'bad')}finally{$('np-file').value=''}
};
$('np-import-confirm').onclick=async()=>{
 if(!pendingNpImport){setMessage('np-message','Tidak ada file yang menunggu persetujuan.','bad');return}
 if(!requireImportPassword('Import Data NPTRANS'))return;
 const batch=pendingNpImport;if(batch.rows.some(r=>isPeriodLocked(String(isoNpDate(r.tanggal)).slice(0,7)))){setMessage('np-message','Import diblokir: data berisi tanggal pada periode yang sudah ditutup.','bad');return}
 try{
  let added=0,skipped=0,importedRows=[];
  if(batch.mode==='replace'){
   if(!confirm('PERINGATAN: Ganti seluruh '+state.nptrans.length+' baris NPTRANS yang tersimpan dengan '+batch.rows.length+' baris dari '+batch.fileName+'?'))return;
   state.nptrans=batch.rows.slice();importedRows=state.nptrans.slice();added=batch.rows.length;
  }else if(batch.mode==='append'){state.nptrans.push(...batch.rows);importedRows=batch.rows.slice();added=batch.rows.length}
  else{
   const seen=new Set(state.nptrans.map(npKey));
   for(const row of batch.rows){const k=npKey(row);if(seen.has(k)){skipped++;continue}seen.add(k);state.nptrans.push(row);importedRows.push(row);added++}
  }
  if(batch.parsed)state.npTemplate={fields:batch.parsed.fields,version:batch.parsed.version};
  const missingAccounts=syncNptransSandis();const draftResult=createNpDraftJournals(importedRows);const draftCreated=draftResult.created;await persist();pendingNpImport=null;$('np-import-review').hidden=true;npPage=1;renderAccounts();renderNptrans();renderJournals();
  setMessage('np-message','Persetujuan berhasil. File '+batch.fileName+' · dibaca '+batch.totalRead+' · ditambahkan '+added+' · duplikat dilewati '+skipped+' · ditolak '+batch.rejected+' · total tersimpan '+state.nptrans.length+' · SANDI baru ditambahkan ke master akun dengan nama kosong: '+missingAccounts+' · draft jurnal otomatis dibuat: '+draftCreated+'. Buka Daftar Jurnal, pilih Edit, lalu tentukan debit/kredit sebelum posting.','good');
  toast('Impor massal disetujui: '+added+' baris ditambahkan.');if(draftCreated>0){go('journal-list');toast(draftCreated+' draft jurnal siap dilengkapi debit/kredit.')}
 }catch(err){setMessage('np-message','Penyimpanan impor gagal: '+err.message,'bad')}
};
$('np-template').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(!requireImportPassword('Memuat Template DBF NPTRANS')){e.target.value='';return}try{const p=parseDBF(await f.arrayBuffer());state.npTemplate={fields:p.fields,version:p.version};await persist();renderNptrans();setMessage('np-message','Struktur template DBF berhasil dibaca: '+p.fields.map(x=>x.name+'('+x.type+','+x.length+')').join(' · '),'good')}catch(err){setMessage('np-message','Template gagal dibaca: '+err.message,'bad')}e.target.value=''};
function accountTemplateRows(){return [['SANDI','NAMA'],['114.130.2','Persediaan Barang'],['114.140.2','Persediaan Bahan Baku'],['716.100.','Biaya Operasional']]}
function exportAccountTemplateCsv(){const rows=accountTemplateRows();downloadBlob(new Blob(['\\ufeff'+rows.map(r=>r.map(csvCell).join(',')).join('\\r\\n')],{type:'text/csv;charset=utf-8'}),'Format-Import-Master-Akun-SBP.csv')}
function exportAccountTemplateXlsx(){exportXlsxSheet('Format-Import-Master-Akun-SBP.xlsx','Master Akun',accountTemplateRows())}
$('download-account-template-csv').onclick=exportAccountTemplateCsv;
$('download-account-template-xlsx').onclick=exportAccountTemplateXlsx;
let selectedAccountFile=null,pendingAccountImport=null;
 $('account-file').onchange=e=>{selectedAccountFile=e.target.files?.[0]||null;pendingAccountImport=null;$('account-import-review').hidden=true;$('import-account-button').disabled=!selectedAccountFile;$('account-import-status').textContent=selectedAccountFile?'File dipilih: '+selectedAccountFile.name+'. Tekan Periksa & Pratinjau.':'Belum ada file master akun dipilih.'};
 $('import-account-button').onclick=async()=>{const f=selectedAccountFile;if(!f)return;$('import-account-button').disabled=true;try{let accounts=[];
  if(f.name.toLowerCase().endsWith('.dbf')){const p=parseDBF(await f.arrayBuffer());const fields=p.fields.map(x=>norm(x.name));if(!fields.includes('SANDI'))throw Error('Kolom SANDI tidak ditemukan pada DBF.');accounts=p.records.map((r,index)=>{const o={};Object.keys(r).forEach(k=>o[norm(k)]=r[k]);return{code:String(o.SANDI??o.KODE??'').trim(),name:String(o.DES??o.NAMA??o.NAMAAKUN??o.KET??'').trim(),_row:index+1}}).filter(x=>x.code)}
  else accounts=/\.xlsx?$/i.test(f.name)?xlsxToAccounts(await f.arrayBuffer()):csvToAccounts(await f.text());
  if(!accounts.length)throw Error('Tidak ditemukan akun dengan SANDI terisi.');
  const seen=new Set(),errors=[],known=new Map(state.accounts.map(x=>[String(x.code),x]));accounts.forEach((x,i)=>{if(!x.code)errors.push('Baris '+(x._row||i+2)+': SANDI kosong.');if(seen.has(x.code))errors.push('Baris '+(x._row||i+2)+': SANDI duplikat '+x.code+'.');seen.add(x.code)});
  const added=accounts.filter(x=>!known.has(x.code)).length,updated=accounts.length-added;pendingAccountImport={fileName:f.name,accounts,errors};
  $('account-import-summary').textContent=accounts.length+' akun dibaca · '+added+' baru · '+updated+' diperbarui';$('account-import-detail').textContent=errors.length?errors.length+' kesalahan. Perbaiki file sebelum menyimpan.':'Periksa isi file. Belum ada data yang disimpan.';
  $('account-import-errors').hidden=!errors.length;$('account-import-errors').innerHTML=errors.length?'<b>Hasil pemeriksaan:</b><ul>'+errors.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'';
  $('account-import-rows').innerHTML=accounts.slice(0,300).map(x=>'<tr><td>'+(x._row||'—')+'</td><td>'+esc(x.code)+'</td><td>'+esc(x.name)+'</td><td>'+(known.has(x.code)?'PERBARUI':'TAMBAH')+'</td></tr>').join('');
  $('account-import-confirm').disabled=!!errors.length;$('account-import-review').hidden=false;$('account-import-status').textContent='Pratinjau siap: '+f.name;
 }catch(err){pendingAccountImport=null;$('account-import-status').textContent='Gagal membaca file: '+err.message;toast('Import akun gagal: '+err.message)}finally{$('import-account-button').disabled=!selectedAccountFile}};
 $('account-import-confirm').onclick=async()=>{const b=pendingAccountImport;if(!b||b.errors.length)return;if(!requireImportPassword('Import Master Akun'))return;if(!confirm('Simpan '+b.accounts.length+' akun dari '+b.fileName+'? SANDI yang sudah ada akan diperbarui.'))return;try{const map=new Map(state.accounts.map(x=>[String(x.code),x]));let added=0,updated=0;b.accounts.forEach(x=>{const v={code:x.code,name:x.name};if(map.has(x.code)){Object.assign(map.get(x.code),v);updated++}else{map.set(x.code,v);added++}});state.accounts=[...map.values()];await persist();renderAccounts();renderNptrans();const msg='Import berhasil: '+b.accounts.length+' record · '+added+' akun baru · '+updated+' akun diperbarui.';$('account-import-status').textContent=msg;toast(msg);pendingAccountImport=null;$('account-import-review').hidden=true;$('account-file').value='';selectedAccountFile=null;$('import-account-button').disabled=true}catch(err){$('account-import-status').textContent='Penyimpanan gagal: '+err.message}};
 $('account-import-cancel').onclick=()=>{pendingAccountImport=null;$('account-import-review').hidden=true;$('account-file').value='';selectedAccountFile=null;$('import-account-button').disabled=true;$('account-import-status').textContent='Pratinjau dibatalkan. Data tidak berubah.'};
 $('clear-np-data').onclick=async()=>{
 const count=state.nptrans.length;
 const linkedDrafts=state.journals.filter(j=>j.status==='draft'&&j.source==='NPTRANS').length;
 if(!count&&!linkedDrafts){setMessage('np-message','Tidak ada data NPTRANS yang perlu dibersihkan.','');return}
 const ok=confirm('BERSIHKAN DATA NPTRANS?\\n\\nData transaksi NPTRANS ('+count+' baris) dan draft jurnal hasil impor NPTRANS ('+linkedDrafts+' jurnal) akan dihapus.\\n\\nMaster akun, jurnal manual/terposting, dan template DBF tidak akan dihapus. Tindakan ini tidak dapat dibatalkan. Lanjutkan?');
 if(!ok)return;
 state.nptrans=[];
 state.journals=state.journals.filter(j=>!(j.status==='draft'&&j.source==='NPTRANS'));
 pendingNpImport=null;
 $('np-import-review').hidden=true;
 $('np-file').value='';
 npPage=1;
 await persist();
 renderNptrans();
 renderJournals();
 renderDashboard();
 setMessage('np-message','Data NPTRANS berhasil dibersihkan. '+count+' baris transaksi dan '+linkedDrafts+' draft jurnal NPTRANS dihapus. Master akun, jurnal manual/terposting, dan template DBF tetap dipertahankan.','good');
 toast('Data NPTRANS berhasil dibersihkan.');
};
$('np-search').addEventListener('input',()=>{npPage=1;renderNptrans()});$('np-prev').onclick=()=>{npPage=Math.max(1,npPage-1);renderNptrans()};$('np-next').onclick=()=>{npPage++;renderNptrans()};$('export-np-csv').onclick=exportNpCsv;$('export-np-xlsx').onclick=exportNpXlsx;$('export-np-dbf').onclick=exportDbf;

function isPostedJournal(j){return String(j?.status??'').trim().toLowerCase()==='posted'}
function getTrialBalanceRows(period){
 const openingMap=new Map(),movement=new Map();
 (Array.isArray(state.openingBalances)?state.openingBalances:[]).filter(x=>String(x.period||'')===String(period)).forEach(x=>{
  const code=String(x.accountCode??'').trim();if(!code)return;
  const v=openingMap.get(code)||{debit:0,credit:0};
  v.debit+=Number(x.debit||0);v.credit+=Number(x.credit||0);openingMap.set(code,v);
 });
 (Array.isArray(state.journals)?state.journals:[]).filter(j=>isPostedJournal(j)&&String(j.date||'').slice(0,7)===String(period)).forEach(j=>(Array.isArray(j.lines)?j.lines:[]).forEach(l=>{
  const code=String(l.code??'').trim();if(!code)return;
  const v=movement.get(code)||{debit:0,credit:0};
  v.debit+=Number(l.debit||0);v.credit+=Number(l.credit||0);movement.set(code,v);
 }));
 const codes=new Set([...(state.accounts||[]).map(a=>String(a.code)),...openingMap.keys(),...movement.keys()]);
 return [...codes].sort((a,b)=>a.localeCompare(b)).map(code=>{
  const account=(state.accounts||[]).find(a=>String(a.code)===code),opening=openingMap.get(code)||{debit:0,credit:0},netOpening=opening.debit-opening.credit,move=movement.get(code)||{debit:0,credit:0},net=netOpening+move.debit-move.credit;
  return {code,name:account?.name||'(Akun tidak ditemukan)',openingDebit:Math.max(netOpening,0),openingCredit:Math.max(-netOpening,0),debit:move.debit,credit:move.credit,endingDebit:Math.max(net,0),endingCredit:Math.max(-net,0),balance:net};
 });
}
function ledgerOpeningNet(period,account){const record=(state.openingBalances||[]).find(x=>x.period===period&&String(x.accountCode)===String(account.code));return record?Number(record.debit||0)-Number(record.credit||0):0}
function getLedgerTransactions(period,code){
 const account=state.accounts.find(a=>String(a.code)===String(code));if(!account)return null;
 const openingNet=ledgerOpeningNet(period,account),rows=[{date:period+'-01',number:'SALDO AWAL',description:'Saldo awal periode',debit:Math.max(openingNet,0),credit:Math.max(-openingNet,0),kind:'opening'}];
 state.journals.filter(j=>(isPostedJournal(j))&&String(j.date||'').slice(0,7)===period).forEach(j=>(j.lines||[]).filter(l=>String(l.code)===String(code)).forEach(l=>rows.push({date:String(j.date||''),number:String(j.number||''),description:String(j.description||'')+(l.note?' · '+l.note:''),debit:Number(l.debit||0),credit:Number(l.credit||0),kind:'movement'})));
 rows.sort((a,b)=>a.date.localeCompare(b.date)||(a.kind==='opening'?-1:b.kind==='opening'?1:0)||a.number.localeCompare(b.number));
 let balance=0;rows.forEach(r=>{balance+=r.debit-r.credit;r.balance=balance;r.balanceDebit=Math.max(balance,0);r.balanceCredit=Math.max(-balance,0)});return {account,rows,openingNet,endingNet:balance};
}
function getAccountJournalStatus(period,code){
 const rows=[];
 (Array.isArray(state.journals)?state.journals:[]).filter(j=>String(j.date||'').slice(0,7)===String(period)).forEach(j=>{
  (Array.isArray(j.lines)?j.lines:[]).filter(l=>String(l.code)===String(code)).forEach(l=>{
   const raw=String(j.status||'').trim().toLowerCase(),status=['cancelled','canceled','void','dibatalkan','batal'].includes(raw)?'cancelled':raw==='draft'?'draft':raw==='posted'?'posted':'unknown';
   rows.push({date:String(j.date||''),number:String(j.number||''),description:String(j.description||''),note:String(l.note||''),status,rawStatus:String(j.status||'TANPA STATUS'),debit:Number(l.debit||0),credit:Number(l.credit||0),id:j.id});
  });
 });
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.number.localeCompare(b.number));
}
function renderAccountJournalStatus(period,code){
 const host=$('ledger-status-content'),summary=$('ledger-status-summary');if(!period||!code){summary.innerHTML='';host.innerHTML='<div class="empty">Pilih periode dan akun untuk melihat status transaksi.</div>';return}
 const all=getAccountJournalStatus(period,code),filter=$('ledger-status-filter')?.value||'all',rows=all.filter(r=>filter==='all'||r.status===filter);
 const groups={posted:all.filter(r=>r.status==='posted'),draft:all.filter(r=>r.status==='draft'),cancelled:all.filter(r=>r.status==='cancelled'),unknown:all.filter(r=>r.status==='unknown')};
 const total=(items,key)=>items.reduce((n,r)=>n+r[key],0),card=(label,items)=>'<div><span>'+label+' · '+items.length+' baris akun</span><b>D '+money(total(items,'debit'))+' / K '+money(total(items,'credit'))+'</b></div>';
 summary.innerHTML='<div class="journal-totals">'+card('POSTED',groups.posted)+card('DRAFT',groups.draft)+card('DIBATALKAN',groups.cancelled)+card('STATUS LAIN / KOSONG',groups.unknown)+'</div><p class="footnote">Jumlah transaksi dihitung per baris akun. Satu nomor bukti dapat muncul lebih dari sekali jika SANDI yang sama digunakan pada beberapa baris.</p>';
 host.innerHTML=rows.length?'<table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan jurnal</th><th>Keterangan baris</th><th>Status</th><th>Debit</th><th>Kredit</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(fmtDate(r.date))+'</td><td><b>'+esc(r.number)+'</b></td><td>'+esc(r.description)+'</td><td>'+esc(r.note)+'</td><td><span class="tag '+(r.status==='posted'?'np-ok':r.status==='draft'?'np-warn':'')+'">'+esc(r.rawStatus)+'</span></td><td class="num">'+money(r.debit)+'</td><td class="num">'+money(r.credit)+'</td></tr>').join('')+'</tbody><tfoot><tr><th colspan="5">TOTAL BARIS TERPILIH</th><th>'+money(total(rows,'debit'))+'</th><th>'+money(total(rows,'credit'))+'</th></tr></tfoot></table>':'<div class="empty">Tidak ada transaksi untuk filter status ini.</div>';
}
function renderLedger(){
 const period=$('ledger-period').value,select=$('ledger-account'),current=select.value;
 select.innerHTML='<option value="">Pilih akun</option>'+state.accounts.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))).map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code)+' · '+esc(a.name||'(Tanpa nama)')+'</option>').join('');
 if(current)select.value=current;
 const code=select.value;if(!period||!code){$('ledger-summary').innerHTML='';$('ledger-content').innerHTML='<div class="empty">Pilih periode dan akun untuk menampilkan buku besar.</div>';renderAccountJournalStatus(period,code);return}renderAccountJournalStatus(period,code);
 const result=getLedgerTransactions(period,code);if(!result)return;
 const movements=result.rows.filter(r=>r.kind==='movement'),debit=movements.reduce((n,r)=>n+r.debit,0),credit=movements.reduce((n,r)=>n+r.credit,0);
 $('ledger-summary').innerHTML='<div><span>Akun</span><b>'+esc(result.account.code)+' · '+esc(result.account.name)+'</b></div><div><span>Saldo awal</span><b>'+money(result.openingNet)+'</b></div><div><span>Mutasi debit</span><b>'+money(debit)+'</b></div><div><span>Mutasi kredit</span><b>'+money(credit)+'</b></div><div><span>Saldo akhir</span><b>'+money(result.endingNet)+'</b></div>';
 $('ledger-content').innerHTML='<table><thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo Debit</th><th>Saldo Kredit</th></tr></thead><tbody>'+result.rows.map(r=>'<tr><td>'+esc(r.kind==='opening'?'Awal periode':fmtDate(r.date))+'</td><td><b>'+esc(r.number)+'</b></td><td>'+esc(r.description)+'</td><td class="num">'+(r.debit?money(r.debit):'—')+'</td><td class="num">'+(r.credit?money(r.credit):'—')+'</td><td class="num">'+(r.balanceDebit?money(r.balanceDebit):'—')+'</td><td class="num">'+(r.balanceCredit?money(r.balanceCredit):'—')+'</td></tr>').join('')+'</tbody><tfoot><tr><th colspan="3">TOTAL MUTASI</th><th>'+money(debit)+'</th><th>'+money(credit)+'</th><th colspan="2">Saldo akhir: '+money(result.endingNet)+'</th></tr></tfoot></table>';
}
function exportLedgerXlsx(){
 const period=$('ledger-period').value,code=$('ledger-account').value,result=getLedgerTransactions(period,code);if(!result){toast('Pilih akun dan periode terlebih dahulu.');return}
 const rows=[['BUKU BESAR',result.account.code,result.account.name],['PERIODE',period],[],['TANGGAL','NO BUKTI','KETERANGAN','DEBIT','KREDIT','SALDO DEBIT','SALDO KREDIT'],...result.rows.map(r=>[r.kind==='opening'?'SALDO AWAL':r.date,r.number,r.description,r.debit,r.credit,r.balanceDebit,r.balanceCredit])];
 exportXlsxSheet('Buku-Besar-'+code+'-'+period+'.xlsx','Buku Besar',rows);
}
$('ledger-period').value=new Date().toISOString().slice(0,7);
$('ledger-period').addEventListener('change',renderLedger);
$('ledger-account').addEventListener('change',renderLedger);
$('ledger-status-filter').addEventListener('change',()=>renderAccountJournalStatus($('ledger-period').value,$('ledger-account').value));
$('ledger-refresh').onclick=renderLedger;
$('ledger-print').onclick=()=>{go('ledger');window.print()};
$('ledger-export').onclick=exportLedgerXlsx;

function exportTrialBalanceXlsx(){const period=$('report-period').value,rows=getTrialBalanceRows(period);const data=[['PERIODE',period],[],['SANDI','NAMA AKUN','SALDO AWAL DEBIT','SALDO AWAL KREDIT','MUTASI DEBIT','MUTASI KREDIT','SALDO AKHIR DEBIT','SALDO AKHIR KREDIT','SALDO BERSIH D/(K)'],...rows.map(r=>[r.code,r.name,r.openingDebit,r.openingCredit,r.debit,r.credit,r.endingDebit,r.endingCredit,r.balance])];exportXlsxSheet('Neraca-Percobaan-'+period+'.xlsx','Neraca Percobaan',data)}
function renderTrialBalance(){
 const period=$('report-period').value,rows=getTrialBalanceRows(period),sum=k=>rows.reduce((n,r)=>n+Number(r[k]||0),0),ed=sum('endingDebit'),ec=sum('endingCredit'),difference=ed-ec,balanced=Math.abs(difference)<.005;
 $('trial-balance').innerHTML=rows.length?'<div class="trial-period-note">Periode '+esc(period)+' · Saldo awal dari Daftar Saldo Awal ACC & Program. Mutasi hanya dari jurnal POSTED pada periode ini; DRAFT dan jurnal tanpa status tidak dihitung.</div><div class="table-wrap"><table><thead><tr><th>SANDI</th><th>Nama akun</th><th>Saldo awal D</th><th>Saldo awal K</th><th>Mutasi D</th><th>Mutasi K</th><th>Saldo akhir D</th><th>Saldo akhir K</th></tr></thead><tbody>'+rows.map(r=>'<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td>'+money(r.openingDebit)+'</td><td>'+money(r.openingCredit)+'</td><td>'+money(r.debit)+'</td><td>'+money(r.credit)+'</td><td>'+money(r.endingDebit)+'</td><td>'+money(r.endingCredit)+'</td></tr>').join('')+'<tr><th colspan="2">TOTAL</th><th>'+money(sum('openingDebit'))+'</th><th>'+money(sum('openingCredit'))+'</th><th>'+money(sum('debit'))+'</th><th>'+money(sum('credit'))+'</th><th>'+money(ed)+'</th><th>'+money(ec)+'</th></tr></tbody></table></div><p class="trial-balance-check">Total saldo akhir Debit: <b>'+money(ed)+'</b> · Kredit: <b>'+money(ec)+'</b> · Selisih: <b class="'+(balanced?'balance-ok':'balance-warn')+'">'+money(difference)+'</b> · <b class="'+(balanced?'balance-ok':'balance-warn')+'">'+(balanced?'SEIMBANG':'BELUM SEIMBANG — PERIKSA SALDO AWAL / JURNAL POSTED')+'</b></p>':'<div class="empty">Belum ada saldo awal atau jurnal POSTED untuk periode ini.</div>';
}
$('report-period').value=new Date().toISOString().slice(0,7);
$('report-period').addEventListener('change',renderTrialBalance);

$('force-delete-mode').addEventListener('change',()=>{const mode=$('force-delete-mode').value,input=$('force-delete-value'),label=$('force-delete-value-label');input.type=mode==='date'?'date':mode==='month'?'month':'number';if(mode==='year'){input.min='1900';input.max='2200';input.step='1';input.placeholder='YYYY';input.value=''}else{input.removeAttribute('min');input.removeAttribute('max');input.removeAttribute('step');input.value=''}label.firstChild.textContent=mode==='date'?'Tanggal':mode==='month'?'Bulan':'Tahun'});
function journalDeleteMatches(mode,value){
 return state.journals.filter(j=>{const d=String(j.date||'');if(mode==='date')return d===value;if(mode==='month')return d.slice(0,7)===value;return d.slice(0,4)===value});
}
$('force-delete-period').onclick=async()=>{
 const mode=$('force-delete-mode').value,value=$('force-delete-value').value;
 if(!value){toast('Pilih tanggal, bulan, atau tahun yang akan dihapus.');return}
 if(mode==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value)){toast('Format tanggal tidak valid.');return}
 if(mode==='month'&&!/^\d{4}-\d{2}$/.test(value)){toast('Format bulan tidak valid.');return}
 if(mode==='year'&&!/^\d{4}$/.test(value)){toast('Format tahun tidak valid.');return}
 const matches=journalDeleteMatches(mode,value);
 if(!matches.length){toast('Tidak ada jurnal pada periode tersebut.');return}if(matches.some(j=>isPeriodLocked(String(j.date||'').slice(0,7)))){toast('Hapus paksa diblokir: rentang ini mencakup periode yang sudah ditutup. Buka kembali periode dengan otorisasi terlebih dahulu.');return}
 const lines=matches.flatMap(j=>j.lines||[]),debit=lines.reduce((n,l)=>n+Number(l.debit||0),0),credit=lines.reduce((n,l)=>n+Number(l.credit||0),0);
 const password=prompt('Masukkan password untuk menghapus jurnal secara paksa:');
 if(password===null)return;
 if(password!=='PKS123'){toast('Password salah. Jurnal tidak dihapus.');return}
 const detail='HAPUS PAKSA JURNAL\\nRentang: '+value+' ('+mode+')\\nJumlah jurnal: '+matches.length+'\\nBaris transaksi: '+lines.length+'\\nTotal debit: '+money(debit)+'\\nTotal kredit: '+money(credit)+'\\n\\nTindakan ini permanen dan tidak dapat dibatalkan dari aplikasi. Lanjutkan?';
 if(!confirm(detail))return;
 const ids=new Set(matches.map(j=>j.id));state.journals=state.journals.filter(j=>!ids.has(j.id));
 await persist();renderDashboard();renderJournals();renderTrialBalance();
 $('force-delete-result').textContent=matches.length+' jurnal berhasil dihapus untuk '+value+'. Total debit '+money(debit)+'; kredit '+money(credit)+'.';
 toast(matches.length+' jurnal dihapus.');
};


// IMPORT SALDO AWAL — preview first, skip duplicates, never overwrite existing balances.
let pendingOpeningImport=null;
function openingPeriodKey(v){const s=String(v??'').trim();if(/^\d{4}-\d{2}$/.test(s))return s;const m=s.match(/^(\d{1,2})[\/-](\d{4})$/);return m?m[2]+'-'+m[1].padStart(2,'0'):''}
function parseOpeningImportRows(rows){
 if(!rows.length)throw Error('File kosong.');
 const aliases={period:['PERIODE','BULAN','PERIOD'],code:['SANDI','KODE','KODEAKUN','ACCOUNTCODE'],debit:['DEBITAWAL','SALDOAWALDEBIT','DEBIT'],credit:['KREDITAWAL','SALDOAWALKREDIT','KREDIT'],side:['SALDONORMAL','POSISISALDO','SISI'],amount:['NOMINAL','JUMLAH','SALDO'],note:['KETERANGAN','CATATAN','URAIAN']};
 let header=-1,col={};
 for(let i=0;i<Math.min(rows.length,25);i++){const h=rows[i].map(norm),m={};for(const [k,a] of Object.entries(aliases))m[k]=h.findIndex(x=>a.includes(x));if(m.period>=0&&m.code>=0&&(m.debit>=0||m.credit>=0||(m.side>=0&&m.amount>=0))){header=i;col=m;break}}
 if(header<0)throw Error('Header tidak dikenali. Wajib PERIODE, SANDI, dan DEBIT AWAL/KREDIT AWAL atau SALDO NORMAL/NOMINAL.');
 const parsed=[];rows.slice(header+1).forEach((r,i)=>{if(!r.some(v=>String(v??'').trim()))return;const period=openingPeriodKey(r[col.period]),accountCode=String(r[col.code]??'').trim();let debit=col.debit>=0?parseAmount(r[col.debit]):0,credit=col.credit>=0?parseAmount(r[col.credit]):0;if(col.debit<0&&col.credit<0){const side=String(r[col.side]??'').trim().toLowerCase();const amount=parseAmount(r[col.amount]);if(['debit','d','dr'].includes(side))debit=amount;else if(['kredit','credit','k','cr'].includes(side))credit=amount;else{debit=NaN;credit=NaN}}parsed.push({period,accountCode,debit,credit,note:String(col.note>=0?r[col.note]??'':'').trim(),row:header+i+2})});
 if(!parsed.length)throw Error('Tidak ada baris saldo awal.');return parsed;
}
function showOpeningImportPreview(rows,fileName){
 const errors=[],warnings=[],seen=new Set(),existing=new Set((state.openingBalances||[]).map(x=>x.period+'|'+x.accountCode)),known=new Map(state.accounts.map(a=>[String(a.code),a]));
 const items=rows.map(r=>{let status='SIAP';if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(r.period))errors.push('Baris '+r.row+': periode tidak valid.');if(!r.accountCode||!known.has(r.accountCode))errors.push('Baris '+r.row+': SANDI kosong atau tidak ditemukan di Master Akun.');if(!Number.isFinite(r.debit)||!Number.isFinite(r.credit)||r.debit<0||r.credit<0||((r.debit>0)&&(r.credit>0))||(!(r.debit>0)&&!(r.credit>0)))errors.push('Baris '+r.row+': isi satu nominal positif pada debit atau kredit.');if(r.period&&isPeriodLocked(r.period))errors.push('Baris '+r.row+': periode '+r.period+' sudah ditutup.');const key=r.period+'|'+r.accountCode;if(seen.has(key))errors.push('Baris '+r.row+': SANDI ganda dalam file untuk periode yang sama.');seen.add(key);if(existing.has(key)){status='DILEWATI · SUDAH ADA';warnings.push('Baris '+r.row+': saldo awal '+key+' sudah ada dan tidak akan ditimpa.')}return {...r,status,name:known.get(r.accountCode)?.name||''}});
 pendingOpeningImport={fileName,items,valid:items.filter(x=>x.status==='SIAP'&&!errors.some(e=>e.startsWith('Baris '+x.row+':')))};
 $('opening-import-summary').textContent=items.length+' baris dibaca · '+pendingOpeningImport.valid.length+' siap diimpor · '+items.filter(x=>x.status.startsWith('DILEWATI')).length+' duplikat dilewati';
 $('opening-import-detail').textContent=errors.length+' kesalahan · '+warnings.length+' peringatan. Kesalahan harus diperbaiki pada file sumber sebelum import.';
 $('opening-import-errors').hidden=!errors.length;$('opening-import-errors').innerHTML=errors.length?'<b>Kesalahan:</b><ul>'+errors.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'';
 $('opening-import-rows').innerHTML=items.map(x=>'<tr><td>'+esc(x.period)+'</td><td>'+esc(x.accountCode)+'</td><td>'+esc(x.name)+'</td><td class="num">'+money(x.debit)+'</td><td class="num">'+money(x.credit)+'</td><td>'+esc(x.note)+'</td><td>'+esc(x.status)+'</td></tr>').join('');
 $('opening-import-review').hidden=false;$('opening-import-confirm').disabled=!pendingOpeningImport.valid.length||errors.length>0;
 $('opening-import-status').textContent=fileName+' · '+items.length+' baris diperiksa.';
}
// Template gabungan anggaran tahunan dan bulanan untuk Pusat Import Data.
$('download-budget-import-template').onclick=()=>{
 const wb=XLSX.utils.book_new();
 const guide=[['TEMPLATE IMPORT ANGGARAN — SBP ACCOUNTING V19'],['Petunjuk','Isi satu baris untuk setiap Tahun + SANDI akun. Jangan ubah nama sheet atau header.'],['Anggaran_Tahunan','Isi Tahun, SANDI, Nama_Akun, Anggaran_Tahunan, dan Keterangan.'],['Anggaran_Bulanan','Isi Tahun, SANDI, Nama_Akun, Januari sampai Desember, dan Keterangan. Isi sesuai angka asli; tidak dibagi rata otomatis.'],['Nominal','Masukkan angka tanpa simbol Rp. Contoh: 1250000. Gunakan angka 0 jika memang tidak ada anggaran pada bulan tersebut.'],['Identitas akun','SANDI harus sama persis dengan Master Akun. Nama akun digunakan sebagai pemeriksaan tambahan.'],['Pemeriksaan','Periksa kembali total anggaran bulanan terhadap anggaran tahunan sebelum proses import. Perbedaan tidak otomatis diubah.'],['Catatan','Template ini adalah format pengisian. Proses import anggaran akan diaktifkan melalui modul import tersendiri.']];
 const annual=[['Tahun','SANDI','Nama_Akun','Anggaran_Tahunan','Keterangan']];
 const months=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
 const monthly=[['Tahun','SANDI','Nama_Akun',...months,'Total_Anggaran_Bulanan','Keterangan']];
 const add=(rows,name,widths)=>{const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=widths.map(w=>({wch:w}));XLSX.utils.book_append_sheet(wb,ws,name)};
 add(guide,'Petunjuk',[24,105]);add(annual,'Anggaran_Tahunan',[12,18,32,22,36]);add(monthly,'Anggaran_Bulanan',[12,18,30,...months.map(()=>16),24,34]);
 XLSX.writeFile(wb,'Template-Import-Anggaran-SBP-Accounting.xlsx');toast('Template import anggaran berhasil diunduh.');
};
$('opening-import-template').onclick=()=>{const rows=[['PERIODE','SANDI','DEBIT AWAL','KREDIT AWAL','KETERANGAN'],['2026-01','111.100',1000000,0,'Saldo awal kas'],['2026-01','211.100',0,1000000,'Saldo awal utang']];const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Saldo Awal');XLSX.writeFile(wb,'Format-Import-Saldo-Awal-SBP.xlsx')};
$('opening-import-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{let rows;if(/\.xlsx?$/i.test(f.name)){if(!window.XLSX)throw Error('Mesin Excel lokal belum siap.');const wb=XLSX.read(await f.arrayBuffer(),{type:'array'});rows=null;for(const n of wb.SheetNames){const data=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:'',raw:true});try{parseOpeningImportRows(data);rows=data;break}catch{}}if(!rows)throw Error('Header saldo awal tidak ditemukan di sheet Excel.')}else rows=parseCSV(await f.text());showOpeningImportPreview(parseOpeningImportRows(rows),f.name)}catch(err){pendingOpeningImport=null;$('opening-import-review').hidden=true;$('opening-import-status').textContent='Gagal membaca file: '+err.message}finally{e.target.value=''}};
$('opening-import-cancel').onclick=()=>{pendingOpeningImport=null;$('opening-import-review').hidden=true;$('opening-import-status').textContent='Pratinjau dibatalkan; data belum berubah.'};
$('opening-import-confirm').onclick=async()=>{const batch=pendingOpeningImport;if(!batch||!batch.valid.length)return;if(!requireImportPassword('Import Saldo Awal'))return;const valid=batch.valid;if(valid.some(x=>isPeriodLocked(x.period))){toast('Import dibatalkan: ada periode yang sudah ditutup.');return}if(!confirm('Import '+valid.length+' saldo awal baru dari '+batch.fileName+'? Data yang sudah ada tidak akan ditimpa.'))return;const now=new Date().toISOString();if(!Array.isArray(state.openingBalances))state.openingBalances=[];valid.forEach(x=>state.openingBalances.push({period:x.period,accountCode:x.accountCode,debit:x.debit,credit:x.credit,note:x.note,updatedAt:now}));await persist();pendingOpeningImport=null;$('opening-import-review').hidden=true;renderOpeningBalances();toast(valid.length+' saldo awal berhasil diimpor.');$('opening-import-status').textContent=valid.length+' saldo awal berhasil diimpor.'};

function renderOpeningBalances(){
 const period=$('opening-period').value;const items=(state.openingBalances||[]).filter(x=>x.period===period).sort((a,b)=>String(a.accountCode).localeCompare(String(b.accountCode)));
 const select=$('opening-account');const current=select.value;select.innerHTML='<option value="">Pilih akun</option>'+state.accounts.slice().sort((a,b)=>a.code.localeCompare(b.code)).map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code)+' · '+esc(a.name||'(Tanpa nama)')+'</option>').join('');if(current)select.value=current;
 const debit=items.reduce((n,x)=>n+Number(x.debit||0),0),credit=items.reduce((n,x)=>n+Number(x.credit||0),0);
 $('opening-summary').innerHTML='<div><span>Jumlah akun</span><b>'+items.length+'</b></div><div><span>Total debit awal</span><b>'+money(debit)+'</b></div><div><span>Total kredit awal</span><b>'+money(credit)+'</b></div><div><span>Selisih</span><b class="'+(Math.abs(debit-credit)<0.005?'balance-ok':'balance-warn')+'">'+money(debit-credit)+'</b></div>';
 $('opening-rows').innerHTML=items.length?items.map((x,i)=>'<tr><td>'+(i+1)+'</td><td><b>'+esc(x.accountCode)+'</b></td><td>'+esc(state.accounts.find(a=>a.code===x.accountCode)?.name||'(Akun tidak ditemukan)')+'</td><td>'+esc(x.note||'')+'</td><td class="num">'+money(x.debit)+'</td><td class="num">'+money(x.credit)+'</td><td><button class="btn opening-edit" data-code="'+esc(x.accountCode)+'">Edit</button> <button class="btn opening-delete" data-code="'+esc(x.accountCode)+'">Hapus</button></td></tr>').join(''):'<tr><td colspan="7" class="empty">Belum ada saldo awal pada periode ini.</td></tr>';
 $('opening-foot').innerHTML='<tr><th colspan="4">TOTAL</th><th>'+money(debit)+'</th><th>'+money(credit)+'</th><th></th></tr>';
 document.querySelectorAll('.opening-edit').forEach(b=>b.onclick=()=>{const x=items.find(v=>v.accountCode===b.dataset.code);if(!x)return;select.value=x.accountCode;$('opening-side').value=Number(x.debit)>0?'debit':'credit';$('opening-amount').value=Number(x.debit)||Number(x.credit)||0;$('opening-note').value=x.note||'';$('opening-save').dataset.edit=b.dataset.code;$('opening-save').textContent='Perbarui Saldo Awal'});
 document.querySelectorAll('.opening-delete').forEach(b=>b.onclick=async()=>{if(!periodGuard(period,'menghapus saldo awal'))return;if(!confirm('Hapus saldo awal akun '+b.dataset.code+' untuk periode '+period+'?'))return;state.openingBalances=state.openingBalances.filter(x=>!(x.period===period&&x.accountCode===b.dataset.code));await persist();renderOpeningBalances();toast('Saldo awal dihapus.')});
}
$('opening-period').value=new Date().toISOString().slice(0,7);
$('opening-period').addEventListener('change',()=>{delete $('opening-save').dataset.edit;$('opening-save').textContent='Simpan Saldo Awal';renderOpeningBalances()});
$('opening-save').addEventListener('click',async()=>{
 const period=$('opening-period').value,code=$('opening-account').value,amount=Number($('opening-amount').value),side=$('opening-side').value,note=$('opening-note').value.trim(),editing=$('opening-save').dataset.edit;
  if(!periodGuard(period,'menambah atau mengubah saldo awal'))return;
 if(!/^\d{4}-\d{2}$/.test(period)||!code||!state.accounts.some(a=>a.code===code)||!Number.isFinite(amount)||amount<0||(!amount)){toast('Periksa periode, akun, dan nominal saldo awal.');return}
 const existing=(state.openingBalances||[]).find(x=>x.period===period&&x.accountCode===code);
 if(existing&&!editing){toast('Saldo awal akun ini sudah ada pada periode tersebut. Gunakan Edit.');return}
 if(editing&&editing!==code){toast('Untuk mengganti akun, hapus saldo lama lalu tambahkan akun yang benar.');return}
 if(!state.openingBalances)state.openingBalances=[];
 const record={period,accountCode:code,debit:side==='debit'?amount:0,credit:side==='credit'?amount:0,note,updatedAt:new Date().toISOString()};
 if(existing)Object.assign(existing,record);else state.openingBalances.push(record);
 await persist();delete $('opening-save').dataset.edit;$('opening-save').textContent='Simpan Saldo Awal';$('opening-amount').value='';$('opening-note').value='';renderOpeningBalances();toast('Saldo awal berhasil disimpan.');
});
$('opening-print').onclick=()=>window.print();
$('opening-export').onclick=()=>{const p=$('opening-period').value,items=(state.openingBalances||[]).filter(x=>x.period===p);if(!window.XLSX){toast('Modul Excel belum tersedia.');return}const rows=[['Periode',p],[],['SANDI','NAMA AKUN','KETERANGAN','DEBIT AWAL','KREDIT AWAL'],...items.map(x=>[x.accountCode,state.accounts.find(a=>a.code===x.accountCode)?.name||'',x.note||'',Number(x.debit||0),Number(x.credit||0)])];const ws=XLSX.utils.aoa_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Saldo Awal');XLSX.writeFile(wb,'Saldo-Awal-'+p+'.xlsx')};


/* ACCOUNTING PERIOD CONTROL V1 — synchronized with the existing IndexedDB state. */
function currentMonthKey(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')}
function ensurePeriodControl(){
 if(!state.periodControl||typeof state.periodControl!=='object')state.periodControl={activePeriod:currentMonthKey(),periods:{}};
 if(!state.periodControl.periods||typeof state.periodControl.periods!=='object')state.periodControl.periods={};
 if(!/^\\d{4}-\\d{2}$/.test(String(state.periodControl.activePeriod||'')))state.periodControl.activePeriod=currentMonthKey();
}
function periodRecord(period){ensurePeriodControl();return state.periodControl.periods[period]||{status:'open'}}
function isPeriodLocked(period){return periodRecord(period).status==='closed'}
function periodGuard(period,action='mengubah data'){
 if(!/^\\d{4}-\\d{2}$/.test(String(period||''))){toast('Tanggal/periode tidak valid.');return false}
 if(isPeriodLocked(period)){toast('Periode '+period+' sudah ditutup. Tidak dapat '+action+'. Buka kembali periode dengan otorisasi administrator jika memang diperlukan.');return false}
 return true
}
function periodTotals(period){
 const rows=getTrialBalanceRows(period);
 const debit=rows.reduce((n,r)=>n+Number(r.endingDebit||0),0);
 const credit=rows.reduce((n,r)=>n+Number(r.endingCredit||0),0);
 const drafts=state.journals.filter(j=>String(j.date||'').slice(0,7)===period&&j.status==='draft').length;
 const posted=state.journals.filter(j=>String(j.date||'').slice(0,7)===period&&(isPostedJournal(j))).length;
 const openings=(state.openingBalances||[]).filter(x=>x.period===period).length;
 return {rows,debit,credit,difference:debit-credit,drafts,posted,openings};
}
function periodLabel(p){const [y,m]=p.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})}
function renderPeriodControl(){
 ensurePeriodControl();
 const active=state.periodControl.activePeriod,rec=periodRecord(active),closed=rec.status==='closed';
 $('period-active').value=active;$('period-close-month').value=active;
 $('period-active-badge').textContent=closed?'DITUTUP':'TERBUKA';
 $('period-active-badge').className=closed?'period-closed':'period-open';
 $('period-active-help').textContent=closed?'Periode ini terkunci. Pilih bulan terbuka untuk melanjutkan pembukuan.':'Jurnal dan saldo awal dapat dicatat selama periode belum ditutup.';
 const t=periodTotals(active);
 const checks=[
  ['Saldo akhir debit dan kredit seimbang',Math.abs(t.difference)<0.005,money(t.difference)],
  ['Tidak ada jurnal Draft tersisa',t.drafts===0,t.drafts+' Draft'],
  ['Jurnal terposting',true,t.posted+' jurnal'],
  ['Saldo awal terdaftar',true,t.openings+' saldo awal']
 ];
 $('period-close-checklist').innerHTML='<h4>Pemeriksaan periode '+esc(periodLabel(active))+'</h4><div class="period-check-items">'+checks.map(x=>'<div class="period-check '+(x[1]?'ok':'warn')+'"><span>'+(x[1]?'✓':'!')+'</span><b>'+esc(x[0])+'</b><small>'+esc(x[2])+'</small></div>').join('')+'</div><p class="footnote">Penutupan diblokir jika neraca percobaan tidak seimbang atau masih ada jurnal Draft. Pemeriksaan ini tidak membuat jurnal penutup laba/rugi.</p>';
 const periods=Object.entries(state.periodControl.periods).sort((a,b)=>b[0].localeCompare(a[0]));
 $('period-history-rows').innerHTML=periods.length?periods.map(([p,r])=>'<tr><td><b>'+esc(periodLabel(p))+'</b></td><td><span class="tag '+(r.status==='closed'?'np-warn':'np-ok')+'">'+(r.status==='closed'?'DITUTUP':'TERBUKA')+'</span></td><td>'+esc(r.closedAt?new Date(r.closedAt).toLocaleString('id-ID'):(r.reopenedAt?new Date(r.reopenedAt).toLocaleString('id-ID'):'—'))+'</td><td>'+esc(r.note||r.reopenReason||'—')+'</td><td>'+(r.status==='closed'?'<button class="btn period-reopen" data-period="'+esc(p)+'" type="button">Buka Kembali</button>':'<button class="btn period-activate" data-period="'+esc(p)+'" type="button">Jadikan Aktif</button>')+'</td></tr>').join(''):'<tr><td colspan="5" class="empty">Belum ada periode yang ditutup. Semua periode historis tetap terbuka sampai ditutup secara manual.</td></tr>';
 document.querySelectorAll('.period-activate').forEach(b=>b.onclick=()=>{$('period-active').value=b.dataset.period;setActivePeriod()});
 document.querySelectorAll('.period-reopen').forEach(b=>b.onclick=()=>reopenAccountingPeriod(b.dataset.period));
}
async function setActivePeriod(){
 const p=$('period-active').value;
 if(!/^\\d{4}-\\d{2}$/.test(p)){toast('Pilih periode kerja yang benar.');return}
 if(isPeriodLocked(p)){toast('Periode '+p+' sudah ditutup. Buka kembali terlebih dahulu.');return}
 state.periodControl.activePeriod=p;
 await persist();
 for(const id of ['ledger-period','report-period','opening-period'])if($(id))$(id).value=p;if(!editingId&&$('j-date'))$('j-date').value=p+'-01';
 renderPeriodControl();
 toast('Periode aktif disinkronkan ke Buku Besar, Neraca Percobaan, dan Saldo Awal: '+periodLabel(p)+'.');
}
async function closeAccountingPeriod(){
 ensurePeriodControl();
 const p=$('period-close-month').value,note=$('period-close-note').value.trim();
 if(!/^\\d{4}-\\d{2}$/.test(p)){toast('Pilih bulan yang akan ditutup.');return}
 if(isPeriodLocked(p)){toast('Periode tersebut sudah ditutup.');return}
 const t=periodTotals(p);
 if(t.drafts){setMessage('period-message','Penutupan diblokir: masih ada '+t.drafts+' jurnal Draft pada periode '+p+'. Posting atau selesaikan Draft terlebih dahulu.','bad');return}
 if(Math.abs(t.difference)>=0.005){setMessage('period-message','Penutupan diblokir: Neraca Percobaan belum seimbang. Selisih '+money(t.difference)+'. Periksa saldo awal dan jurnal terposting.','bad');return}
 if(!confirm('TUTUP BUKU '+periodLabel(p)+'? Data periode akan dikunci dari input, edit, posting, import, dan penghapusan. Laporan tetap dapat dibaca. Pastikan backup sudah diunduh/tersimpan.'))return;
 const password=prompt('Masukkan password administrator untuk menutup buku:');
 if(password===null)return;
 if(password!=='PKS123'){setMessage('period-message','Password salah. Periode tidak ditutup.','bad');return}
 const backup=makeBackupPayload();backup.backupType='pre-period-close';backup.periodBeingClosed=p;
 downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}),'SBP-V19-PRE-CLOSE-'+p+'.json');
 const now=new Date().toISOString();
 state.periodControl.periods[p]={status:'closed',closedAt:now,closedBy:'Administrator lokal',note:note||'Tutup buku bulanan',totals:{debit:t.debit,credit:t.credit,difference:t.difference,journals:t.posted,openingRecords:t.openings}};
 state.auditLogs.unshift({id:crypto.randomUUID(),at:now,action:'TUTUP PERIODE',entity:'Periode Akuntansi',entityId:p,summary:'Tutup buku '+p+'; jurnal posted '+t.posted+'; debit '+money(t.debit)+'; kredit '+money(t.credit),before:{status:'open'},after:auditClone(state.periodControl.periods[p])});
 if(state.periodControl.activePeriod===p){let next=new Date(Number(p.slice(0,4)),Number(p.slice(5,7)),1),candidate='';for(let i=0;i<24;i++){candidate=next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0');if(!isPeriodLocked(candidate))break;next.setMonth(next.getMonth()+1)}state.periodControl.activePeriod=candidate||currentMonthKey()}
 await persist();renderPeriodControl();setMessage('period-message','Periode '+periodLabel(p)+' berhasil ditutup dan dikunci. Backup sebelum penutupan diunduh; simpan file tersebut di folder backup perusahaan.','good');
}
async function reopenAccountingPeriod(p){
 const reason=prompt('Alasan pembukaan kembali periode '+p+':');
 if(reason===null)return;
 if(!reason.trim()){toast('Alasan wajib diisi.');return}
 const password=prompt('Masukkan password administrator untuk membuka kembali periode:');
 if(password===null)return;
 if(password!=='PKS123'){toast('Password salah. Periode tetap terkunci.');return}
 const old=periodRecord(p),now=new Date().toISOString();
 state.periodControl.periods[p]={...old,status:'open',reopenedAt:now,reopenReason:reason.trim()};
 state.auditLogs.unshift({id:crypto.randomUUID(),at:now,action:'BUKA KEMBALI PERIODE',entity:'Periode Akuntansi',entityId:p,summary:'Periode '+p+' dibuka kembali. Alasan: '+reason.trim(),before:auditClone(old),after:auditClone(state.periodControl.periods[p])});
 await persist();renderPeriodControl();setMessage('period-message','Periode '+periodLabel(p)+' dibuka kembali. Aktivitas ini tercatat di Riwayat Aktivitas.','good');
}
$('period-set-active').addEventListener('click',setActivePeriod);
$('period-close-button').addEventListener('click',closeAccountingPeriod);
$('period-active').addEventListener('change',()=>{const p=$('period-active').value;if(isPeriodLocked(p))toast('Periode tersebut telah ditutup.')});

/* PRINT ENGINE V1 — independent report renderer; does not mutate accounting records. */
const PRINT_SETTINGS_KEY='sbp-print-settings-v1';
const PRINT_DEFAULTS={paper:'F4',orientation:'auto',margin:10,fontSize:8,rowPadding:1.4,brand:true,printedAt:true,footer:true,summary:true,signatures:true,tableLines:true,headerColor:'#eaf2ed'};
let PRINT_CONFIG={...PRINT_DEFAULTS,...(()=>{try{return JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY)||'{}')}catch{return {}}})()};
function savePrintSettings(){const get=id=>$(id);PRINT_CONFIG={paper:get('print-paper').value,orientation:get('print-orientation').value,margin:Number(get('print-margin').value),fontSize:Number(get('print-font-size').value),rowPadding:Number(get('print-row-padding').value),brand:get('print-brand').checked,printedAt:get('print-date').checked,footer:get('print-footer').checked,summary:get('print-summary').checked,signatures:get('print-signatures').checked,tableLines:get('print-lines').checked,headerColor:get('print-header-color').value};localStorage.setItem(PRINT_SETTINGS_KEY,JSON.stringify(PRINT_CONFIG));toast('Pengaturan template cetak disimpan dan berlaku untuk seluruh laporan.')}
function loadPrintSettings(){const map={'print-paper':'paper','print-orientation':'orientation','print-margin':'margin','print-font-size':'fontSize','print-row-padding':'rowPadding','print-brand':'brand','print-date':'printedAt','print-footer':'footer','print-summary':'summary','print-signatures':'signatures','print-lines':'tableLines','print-header-color':'headerColor'};for(const [id,key] of Object.entries(map)){const el=$(id);if(!el)continue;if(el.type==='checkbox')el.checked=!!PRINT_CONFIG[key];else el.value=PRINT_CONFIG[key]??PRINT_DEFAULTS[key]}}
function resetPrintSettings(){PRINT_CONFIG={...PRINT_DEFAULTS};localStorage.setItem(PRINT_SETTINGS_KEY,JSON.stringify(PRINT_CONFIG));loadPrintSettings();toast('Pengaturan template cetak dikembalikan ke standar.')}
function printMoney(v){return money(Number(v||0))}
function printTable(headers,rows,foot=''){return '<table class="sbp-print-table"><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody>'+(foot?'<tfoot>'+foot+'</tfoot>':'')+'</table>'}
function printSummary(items){return PRINT_CONFIG.summary?'<section class="sbp-print-summary">'+items.map(x=>'<div><span>'+esc(x[0])+'</span><b>'+esc(x[1])+'</b></div>').join('')+'</section>':''}
function printSignatures(){return PRINT_CONFIG.signatures?'<section class="sbp-print-signatures"><div><span>Disiapkan oleh,</span><b></b><small>(........................................)</small></div><div><span>Diperiksa oleh,</span><b></b><small>(........................................)</small></div><div><span>Disetujui oleh,</span><b></b><small>(........................................)</small></div></section>':''}
function printDocument(title,subtitle,body,orientation='portrait'){
 const old=document.getElementById('sbp-print-frame');if(old)old.remove();
 const frame=document.createElement('iframe');frame.id='sbp-print-frame';frame.title='Pratinjau cetak '+title;
 frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';document.body.appendChild(frame);
 const paperMap={A4:'210mm 297mm',F4:'215mm 330mm',Letter:'8.5in 11in',Legal:'8.5in 14in'};
 const pageOrientation=PRINT_CONFIG.orientation==='auto'?orientation:PRINT_CONFIG.orientation;
 const paper=paperMap[PRINT_CONFIG.paper]||paperMap.A4, pageSize=pageOrientation==='landscape'?paper.split(' ').reverse().join(' '):paper;
 const margin=Math.max(5,Math.min(25,Number(PRINT_CONFIG.margin)||10))+'mm';
 const printed=new Date().toLocaleString('id-ID',{dateStyle:'long',timeStyle:'short'});
 const style='@page{size:'+pageSize+';margin:'+margin+'}'+
 '.journal-line-notes{min-width:38mm;white-space:normal;line-height:1.35}.journal-line-note{margin:0 0 1mm;break-inside:avoid}.journal-line-note b{white-space:nowrap}.muted{color:#64748b;font-style:italic}'+ '@page{@bottom-right{content:"Halaman "+counter(page);font:8pt Arial;color:#64748b}}'+
 '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#17212b;font:'+Number(PRINT_CONFIG.fontSize||8)+'pt Arial,Helvetica,sans-serif}'+
 '.sheet{width:100%}.header{border-bottom:2px solid #176b4a;padding:0 0 5mm;margin-bottom:3mm}'+
 '.brand{font-size:15pt;font-weight:800;letter-spacing:.5px;color:#145c40}.brand small{display:block;font-size:7.5pt;font-weight:500;letter-spacing:1px;color:#64748b;margin-top:1mm}'+
 '.heading{text-align:center;margin-top:3mm}.heading h1{font-size:14pt;margin:0 0 2mm}.heading p{font-size:9pt;margin:0;color:#475569}'+
 '.meta{display:flex;justify-content:space-between;color:#64748b;font-size:8pt;margin:0 0 3mm;padding-bottom:2mm;border-bottom:1px solid #cbd5e1}'+
 '.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2mm;margin:0 0 3mm}.summary>div{border:1px solid #cbd5e1;border-radius:1mm;padding:2mm}'+
 '.summary span{display:block;color:#64748b;font-size:7.5pt;margin-bottom:1mm}.summary b{font-size:9pt}'+
 'table{width:100%;border-collapse:collapse;table-layout:auto;font-size:inherit}thead{display:table-header-group}th{background:'+PRINT_CONFIG.headerColor+'!important;color:#173c2d!important;font-weight:700;text-align:center}'+
 'th,td{'+(PRINT_CONFIG.tableLines?'border:1px solid #aebbb4;':'border:0;')+'padding:'+Math.max(.5,Math.min(4,Number(PRINT_CONFIG.rowPadding)||1.4))+'mm 1.2mm;vertical-align:top}td.num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}tbody tr{break-inside:avoid;page-break-inside:avoid}tfoot{display:table-row-group;font-weight:700}'+
 '.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm;margin:12mm 0 0;text-align:center;break-inside:avoid;page-break-inside:avoid}.signatures span,.signatures small{display:block;font-size:8pt}.signatures b{display:block;height:20mm}'+
 '.footer{border-top:1px solid #cbd5e1;margin-top:6mm;padding-top:2mm;color:#64748b;font-size:7pt;text-align:center}';
 const brand=PRINT_CONFIG.brand?'<div class="brand">SBP ACCOUNTING <small>SISTEM INFORMASI AKUNTANSI · V19</small></div>':'';
 const meta=PRINT_CONFIG.printedAt?'<div class="meta"><span>Dicetak: '+esc(printed)+'</span><span>Dokumen internal</span></div>':'';
 const signatures=PRINT_CONFIG.signatures?'<section class="signatures"><div><span>Disiapkan oleh,</span><b></b><small>(........................................)</small></div><div><span>Diperiksa oleh,</span><b></b><small>(........................................)</small></div><div><span>Disetujui oleh,</span><b></b><small>(........................................)</small></div></section>':'';
 const footer=PRINT_CONFIG.footer?'<footer class="footer">SBP Accounting V19 · Dokumen hasil cetak sistem</footer>':'';
 const doc=frame.contentDocument;doc.open();doc.write('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>'+esc(title)+'</title><style>'+style+'</style></head><body><main class="sheet"><header class="header">'+brand+'<div class="heading"><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div></header>'+meta+body+signatures+footer+'</main></body></html>');doc.close();
 const cleanup=()=>{frame.remove();window.removeEventListener('afterprint',cleanup)};
 frame.onload=()=>{setTimeout(()=>{try{frame.contentWindow.focus();frame.contentWindow.print()}catch(err){toast('Gagal membuka cetak: '+err.message)}},150)};
 window.addEventListener('afterprint',cleanup,{once:true});
}
function printTrialBalance(){
 const period=$('report-period').value,rows=getTrialBalanceRows(period),d=rows.reduce((n,r)=>n+r.endingDebit,0),c=rows.reduce((n,r)=>n+r.endingCredit,0);
 const body=printSummary([['Periode',period],['Jumlah akun',String(rows.length)],['Total saldo akhir debit',printMoney(d)],['Total saldo akhir kredit',printMoney(c)],['Selisih',printMoney(d-c)]])+printTable(['SANDI','NAMA AKUN','SALDO AWAL D','SALDO AWAL K','MUTASI D','MUTASI K','SALDO AKHIR D','SALDO AKHIR K'],rows.map(r=>'<tr><td>'+esc(r.code)+'</td><td>'+esc(r.name)+'</td><td class="num">'+printMoney(r.openingDebit)+'</td><td class="num">'+printMoney(r.openingCredit)+'</td><td class="num">'+printMoney(r.debit)+'</td><td class="num">'+printMoney(r.credit)+'</td><td class="num">'+printMoney(r.endingDebit)+'</td><td class="num">'+printMoney(r.endingCredit)+'</td></tr>'),'<tr><th colspan="2">TOTAL</th><th class="num">'+printMoney(rows.reduce((n,r)=>n+r.openingDebit,0))+'</th><th class="num">'+printMoney(rows.reduce((n,r)=>n+r.openingCredit,0))+'</th><th class="num">'+printMoney(rows.reduce((n,r)=>n+r.debit,0))+'</th><th class="num">'+printMoney(rows.reduce((n,r)=>n+r.credit,0))+'</th><th class="num">'+printMoney(d)+'</th><th class="num">'+printMoney(c)+'</th></tr>');
 printDocument('NERACA PERCOBAAN','Periode '+period,body,'landscape');
}
function printLedger(){
 const period=$('ledger-period').value,code=$('ledger-account').value,result=getLedgerTransactions(period,code);if(!result){toast('Pilih periode dan akun terlebih dahulu.');return}
 const moves=result.rows.filter(r=>r.kind==='movement'),d=moves.reduce((n,r)=>n+r.debit,0),c=moves.reduce((n,r)=>n+r.credit,0);
 const body=printSummary([['Periode',period],['Akun',result.account.code+' · '+result.account.name],['Saldo awal',printMoney(result.openingNet)],['Mutasi debit',printMoney(d)],['Mutasi kredit',printMoney(c)],['Saldo akhir',printMoney(result.endingNet)]])+printTable(['TANGGAL','NO. BUKTI','KETERANGAN','DEBIT','KREDIT','SALDO DEBIT','SALDO KREDIT'],result.rows.map(r=>'<tr><td>'+esc(r.kind==='opening'?'Awal periode':fmtDate(r.date))+'</td><td>'+esc(r.number)+'</td><td>'+esc(r.description)+'</td><td class="num">'+printMoney(r.debit)+'</td><td class="num">'+printMoney(r.credit)+'</td><td class="num">'+printMoney(r.balanceDebit)+'</td><td class="num">'+printMoney(r.balanceCredit)+'</td></tr>'));
 printDocument('BUKU BESAR PER AKUN','Periode '+period,body,'portrait');
}
function printOpeningBalances(){
 const period=$('opening-period').value,items=(state.openingBalances||[]).filter(x=>x.period===period).sort((a,b)=>String(a.accountCode).localeCompare(String(b.accountCode))),d=items.reduce((n,x)=>n+Number(x.debit||0),0),c=items.reduce((n,x)=>n+Number(x.credit||0),0);
 const body=printSummary([['Periode',period],['Jumlah akun',String(items.length)],['Total debit awal',printMoney(d)],['Total kredit awal',printMoney(c)],['Selisih',printMoney(d-c)]])+printTable(['NO','SANDI','NAMA AKUN','KETERANGAN','DEBIT AWAL','KREDIT AWAL'],items.map((x,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(x.accountCode)+'</td><td>'+esc(state.accounts.find(a=>a.code===x.accountCode)?.name||'(Akun tidak ditemukan)')+'</td><td>'+esc(x.note||'')+'</td><td class="num">'+printMoney(x.debit)+'</td><td class="num">'+printMoney(x.credit)+'</td></tr>'),'<tr><th colspan="4">TOTAL</th><th class="num">'+printMoney(d)+'</th><th class="num">'+printMoney(c)+'</th></tr>');
 printDocument('DAFTAR SALDO AWAL ACC & PROGRAM','Periode '+period,body,'landscape');
}
function printAccounts(){const q=($('account-search')?.value||'').trim().toLowerCase(),items=state.accounts.filter(a=>(a.code+' '+a.name).toLowerCase().includes(q)).sort((a,b)=>a.code.localeCompare(b.code));const body=printSummary([['Jumlah akun',String(items.length)]])+printTable(['NO','KODE / SANDI','NAMA AKUN'],items.map((a,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(a.code)+'</td><td>'+esc(a.name)+'</td></tr>'));printDocument('DAFTAR MASTER AKUN','Daftar kode dan nama akun sesuai filter pencarian aktif',body,'portrait')}
function journalPrintStatus(j){const s=String(j?.status??'').trim().toLowerCase();if(s==='posted')return 'posted';if(s==='draft')return 'draft';if(['cancelled','canceled','void','dibatalkan','batal'].includes(s))return 'cancelled';return 'unknown'}
function openJournalPrintSettings(){const modal=$('journal-print-modal');if(!modal)return;const account=$('jprint-account');account.innerHTML='<option value="all">Semua akun</option>'+state.accounts.slice().sort((a,b)=>String(a.code).localeCompare(String(b.code))).map(a=>'<option value="'+esc(a.code)+'">'+esc(a.code+' · '+a.name)+'</option>').join('');const now=new Date(),month=String(now.getMonth()+1).padStart(2,'0');$('jprint-month').value=now.getFullYear()+'-'+month;$('jprint-year').value=String(now.getFullYear());$('jprint-search').value=$('journal-search')?.value||'';$('jprint-status').value='all';$('jprint-account').value='all';$('jprint-mode').value='month';updateJournalPrintMode();$('jprint-validation').textContent='Pilih periode. Semua baris akun dalam jurnal terpilih akan dicetak agar debit dan kredit tetap utuh.';modal.hidden=false}
function updateJournalPrintMode(){const mode=$('jprint-mode').value;for(const [id,show] of [['jprint-date-wrap',mode==='date'],['jprint-month-wrap',mode==='month'],['jprint-year-wrap',mode==='year'],['jprint-from-wrap',mode==='range'],['jprint-to-wrap',mode==='range']])$(id).hidden=!show}
function closeJournalPrintSettings(){$('journal-print-modal').hidden=true}
function printJournalList(){openJournalPrintSettings()}
function confirmJournalPrint(){const mode=$('jprint-mode').value;let from='',to='',period='Seluruh data';if(mode==='date'){from=to=$('jprint-date').value;if(!from)return toast('Pilih tanggal jurnal terlebih dahulu.');period='Tanggal '+from}else if(mode==='month'){const v=$('jprint-month').value;if(!/^\\d{4}-\\d{2}$/.test(v))return toast('Pilih bulan dan tahun terlebih dahulu.');const [y,m]=v.split('-').map(Number);from=v+'-01';to=v+'-'+String(new Date(y,m,0).getDate()).padStart(2,'0');period=v}else if(mode==='year'){const y=Number($('jprint-year').value);if(!Number.isInteger(y)||y<1900||y>2200)return toast('Masukkan tahun yang benar.');from=y+'-01-01';to=y+'-12-31';period=String(y)}else if(mode==='range'){from=$('jprint-from').value;to=$('jprint-to').value;if(!from||!to)return toast('Lengkapi tanggal mulai dan tanggal akhir.');if(from>to)return toast('Tanggal mulai tidak boleh melewati tanggal akhir.');period=from+' s.d. '+to}
 const status=$('jprint-status').value,account=$('jprint-account').value,q=$('jprint-search').value.trim().toLowerCase(),sort=$('jprint-sort').value;
 const items=state.journals.filter(j=>{const date=String(j.date||'').slice(0,10);if(from&&(!date||date<from||date>to))return false;if(status!=='all'&&journalPrintStatus(j)!==status)return false;if(account!=='all'&&!(j.lines||[]).some(l=>String(l.code||l.accountCode||'')===account))return false;const hay=(j.number+' '+j.description+' '+date+' '+(j.lines||[]).map(l=>(l.note||'')+' '+(l.code||'')).join(' ')).toLowerCase();return !q||hay.includes(q)}).sort((a,b)=>sort==='asc'?String(a.date||'').localeCompare(String(b.date||'')):String(b.date||'').localeCompare(String(a.date||'')));
 if(!items.length)return toast('Tidak ada jurnal yang cocok dengan pengaturan cetak.');
 const d=items.reduce((n,j)=>n+(j.lines||[]).reduce((s,l)=>s+Number(l.debit||0),0),0),c=items.reduce((n,j)=>n+(j.lines||[]).reduce((s,l)=>s+Number(l.credit||0),0),0),statusLabel={all:'Semua status',posted:'Posted',draft:'Draft',cancelled:'Dibatalkan',unknown:'Status tidak dikenal/kosong'}[status],accountLabel=account==='all'?'Semua akun':account;
 const body=printSummary([['Periode',period],['Jumlah jurnal',String(items.length)],['Status',statusLabel],['Akun / SANDI',accountLabel],['Total debit',printMoney(d)],['Total kredit',printMoney(c)],['Selisih',printMoney(d-c)]])+printTable(['TANGGAL','NO. BUKTI','KETERANGAN','KETERANGAN BARIS','STATUS','JUMLAH BARIS','DEBIT','KREDIT'],items.map(j=>{const lines=j.lines||[],jd=lines.reduce((n,l)=>n+Number(l.debit||0),0),jc=lines.reduce((n,l)=>n+Number(l.credit||0),0),lineNotes=lines.map((l,i)=>'<div class="journal-line-note"><b>'+String(i+1)+'. '+esc(l.code||l.accountCode||'')+'</b> — '+(String(l.note||'').trim()?esc(l.note):'<span class="muted">Tidak ada keterangan</span>')+'</div>').join(''),st=journalPrintStatus(j);return '<tr><td>'+esc(fmtDate(j.date))+'</td><td>'+esc(j.number)+'</td><td>'+esc(j.description)+'</td><td class="journal-line-notes">'+(lineNotes||'—')+'</td><td>'+({posted:'POSTED',draft:'DRAFT',cancelled:'DIBATALKAN',unknown:'TIDAK DIKETAHUI'}[st])+'</td><td class="num">'+lines.length+'</td><td class="num">'+printMoney(jd)+'</td><td class="num">'+printMoney(jc)+'</td></tr>'}));
 closeJournalPrintSettings();printDocument('DAFTAR JURNAL','Periode '+period+' · Status '+statusLabel+' · Akun '+accountLabel+' · Rincian akun ditampilkan utuh per jurnal',body,'landscape');
}
function printCurrentPage(){
 const active=document.querySelector('.page.active');if(!active){toast('Tidak ada halaman aktif untuk dicetak.');return}
 const id=active.id;
 if(id==='page-reports')return printTrialBalance();
 if(id==='page-ledger')return printLedger();
 if(id==='page-opening-balances')return printOpeningBalances();
 if(id==='page-accounts')return printAccounts();
 if(id==='page-journal-list')return printJournalList();
 toast('Cetak profesional tersedia untuk Daftar Jurnal, Master Akun, Saldo Awal, Buku Besar, dan Neraca Percobaan.');
}
$('print-settings-save').onclick=savePrintSettings;$('print-settings-reset').onclick=resetPrintSettings;$('print-settings-preview').onclick=()=>printDocument('CONTOH TEMPLATE CETAK','Pratinjau pengaturan global',printTable(['TANGGAL','NO. BUKTI','KETERANGAN','DEBIT','KREDIT'],['<tr><td>31/10/2026</td><td>CONTOH/001</td><td>Contoh tampilan dokumen</td><td class="num">Rp 100.000</td><td class="num">Rp 100.000</td></tr>']),'landscape');loadPrintSettings();
$('print-current-page').onclick=printCurrentPage;
$('print-journal-list').onclick=printJournalList;$('journal-print-close').onclick=closeJournalPrintSettings;$('journal-print-cancel').onclick=closeJournalPrintSettings;$('jprint-mode').addEventListener('change',updateJournalPrintMode);$('journal-print-confirm').onclick=confirmJournalPrint;$('journal-print-modal').addEventListener('click',e=>{if(e.target===$('journal-print-modal'))closeJournalPrintSettings()});
$('print-accounts').onclick=printAccounts;
$('print-report').onclick=printTrialBalance;
$('opening-print').onclick=printOpeningBalances;
$('ledger-print').onclick=printLedger;
$('export-trial-xlsx').onclick=exportTrialBalanceXlsx;



/* REDESIGN PREVIEW V89 — contextual module guide */
const moduleGuides={
 'page-dashboard':{
  title:'Dashboard',purpose:'Dashboard adalah halaman ringkasan untuk melihat kondisi pembukuan. Halaman ini membantu pengguna mengetahui gambaran umum tanpa harus membuka laporan satu per satu.',
  prepare:'Pastikan data Master Akun, saldo awal, dan jurnal sudah dimasukkan dengan benar. Dashboard hanya dapat menampilkan informasi yang sudah tersimpan.',
  steps:[
   ['Periksa total debit dan kredit','Kartu Total Debit dan Total Kredit menunjukkan akumulasi nilai transaksi yang tercatat. Bandingkan keduanya untuk melihat apakah pembukuan seimbang.'],
   ['Periksa jumlah transaksi','Jumlah transaksi memberi gambaran aktivitas yang sudah tersimpan. Jika angka tidak sesuai perkiraan, lanjutkan pemeriksaan melalui Daftar Jurnal.'],
   ['Lihat jurnal terbaru','Gunakan daftar aktivitas atau jurnal terbaru untuk menemukan transaksi yang baru dimasukkan. Periksa tanggal, nomor bukti, uraian, dan statusnya.'],
   ['Gunakan akses cepat','Pilih menu Input Jurnal untuk mencatat transaksi, Master Akun untuk memeriksa daftar akun, atau Laporan untuk melihat hasil pembukuan.']
  ],
  example:'Jika total debit Rp10.000.000 dan total kredit Rp10.000.000, jumlahnya seimbang. Jika berbeda, jangan langsung menganggap data benar; telusuri jurnal yang belum seimbang atau data yang belum lengkap.',
  checks:'Dashboard adalah ringkasan, bukan tempat memperbaiki transaksi. Untuk mengetahui penyebab selisih, buka Daftar Jurnal, Validasi, atau Neraca Percobaan.',
  note:'Angka dashboard mengikuti data yang tersimpan dan aturan perhitungan masing-masing kartu. Selalu gunakan laporan terkait untuk pemeriksaan resmi.'
 },
 'page-journal':{
  title:'Input Jurnal',purpose:'Menu ini digunakan untuk mencatat transaksi keuangan berdasarkan bukti yang sah, misalnya nota, faktur, kuitansi, bukti kas, atau dokumen transaksi perusahaan.',
  prepare:'Siapkan dokumen sumber, tanggal transaksi, nomor bukti, uraian transaksi, serta SANDI akun yang benar. Pastikan akun sudah tersedia di Master Akun dan periode pembukuan sesuai.',
  steps:[
   ['Isi tanggal transaksi','Masukkan tanggal sesuai tanggal pada dokumen sumber, bukan tanggal ketika Anda kebetulan membuka aplikasi. Tanggal menentukan periode laporan dan dapat memengaruhi kontrol anggaran.'],
   ['Isi nomor bukti','Gunakan nomor bukti yang mengikuti tata penomoran perusahaan. Nomor ini membantu pencarian dan mencegah transaksi tertukar. Jangan membuat nomor baru secara sembarangan jika sudah ada nomor resmi.'],
   ['Tulis keterangan transaksi','Jelaskan transaksi secara singkat tetapi mudah dikenali. Sebutkan tujuan atau objek transaksi, bukan hanya menulis “biaya” atau “pembelian”.'],
   ['Pilih SANDI akun pada setiap baris','Pilih kode akun dari daftar Master Akun. Pastikan nama akun yang tampil sesuai dengan jenis transaksi pada dokumen. Jangan memilih akun hanya karena namanya terdengar mirip.'],
   ['Isi debit dan kredit','Masukkan nominal pada kolom yang sesuai. Satu baris umumnya diisi debit atau kredit sesuai sifat pencatatannya. Jangan mengisi kedua sisi pada satu baris kecuali aturan aplikasi dan transaksi memang mengharuskannya.'],
   ['Tambahkan baris jika diperlukan','Satu transaksi dapat melibatkan lebih dari dua akun. Tambahkan baris untuk seluruh akun yang terpengaruh, lalu pastikan setiap baris memiliki SANDI dan nominal yang benar.'],
   ['Periksa keseimbangan','Total debit harus sama dengan total kredit. Jika belum sama, periksa nominal, akun, atau baris yang tertinggal. Jangan mengubah angka hanya untuk memaksa selisih menjadi nol tanpa dasar dokumen.'],
   ['Simpan sebagai Draft atau Posting','Draft digunakan untuk menyimpan pekerjaan yang masih perlu diperiksa. Posting digunakan setelah data benar dan siap menjadi transaksi resmi sesuai kewenangan perusahaan.']
  ],
  example:'Contoh sederhana: pembelian perlengkapan tunai Rp500.000. Berdasarkan kebijakan akun perusahaan, catat akun perlengkapan pada sisi debit Rp500.000 dan akun kas pada sisi kredit Rp500.000. Total kedua sisi harus sama.',
  checks:'Periksa kembali tanggal, nomor bukti, SANDI, uraian, dan nominal sebelum Posting. Jurnal berstatus POSTED digunakan dalam perhitungan mutasi laporan; Draft tidak diperlakukan sebagai transaksi Posted.',
  note:'Jangan membuat jurnal berdasarkan perkiraan jika bukti belum tersedia. Jika salah setelah Posting, ikuti prosedur koreksi atau pembatalan yang berlaku; jangan menghapus jejak transaksi secara sembarangan.'
 },
 'page-journal-list':{
  title:'Daftar Jurnal',purpose:'Menu ini merupakan tempat melihat dan menelusuri jurnal yang sudah disimpan, termasuk memeriksa status Draft, Posted, atau status lain yang ditampilkan aplikasi.',
  prepare:'Ketahui nomor bukti, tanggal, periode, atau kata kunci uraian transaksi yang ingin dicari.',
  steps:[
   ['Tentukan periode atau tanggal','Gunakan filter periode untuk mempersempit daftar. Pastikan rentang tanggal sesuai dengan dokumen yang sedang diperiksa.'],
   ['Gunakan kolom pencarian','Ketik nomor bukti, uraian, atau kata kunci yang mudah dikenali. Hapus kata kunci jika hasil tidak ditemukan.'],
   ['Periksa status jurnal','Draft berarti masih berupa catatan yang belum diposting. Posted berarti sudah masuk ke perhitungan mutasi laporan. Baca status yang ditampilkan sebelum melakukan tindakan.'],
   ['Buka rincian jurnal','Periksa seluruh baris akun, SANDI, debit, kredit, dan keterangan. Jangan hanya melihat total karena kesalahan akun bisa terjadi walaupun total tetap seimbang.'],
   ['Lakukan tindakan sesuai kewenangan','Gunakan tombol tindakan yang tersedia berdasarkan status jurnal. Jika perlu koreksi, ikuti prosedur perusahaan dan simpan bukti pendukungnya.']
  ],
  example:'Jika mencari transaksi pembelian tanggal 15, pilih periode yang mencakup tanggal tersebut lalu cari nomor bukti pada kolom pencarian. Buka detail untuk memastikan akun dan nominalnya.',
  checks:'Pastikan jurnal yang diharapkan sudah muncul dan statusnya benar. Jika transaksi tidak masuk laporan, periksa apakah jurnal masih Draft atau tanggalnya berada di periode lain.',
  note:'Jurnal POSTED menjadi sumber mutasi Neraca Percobaan dan realisasi anggaran. Jangan mengubah atau membatalkan jurnal tanpa persetujuan yang berwenang.'
 },
 'page-debit-notes':{
  title:'Nota Debet',purpose:'Nota Debet digunakan untuk mendokumentasikan penyesuaian atau koreksi yang memerlukan catatan tersendiri dan dapat dihubungkan dengan transaksi sumber.',
  prepare:'Siapkan dokumen pendukung, tanggal, pihak terkait, alasan nota, nomor referensi, serta rincian akun dan nominal yang akan dicatat.',
  steps:[
   ['Isi identitas nota','Masukkan tanggal, pihak atau unit terkait, nomor referensi, dan uraian alasan. Gunakan keterangan yang menjelaskan mengapa nota dibuat.'],
   ['Cari transaksi sumber bila ada','Jika nota berhubungan dengan transaksi yang sudah diposting, cari transaksi tersebut melalui pencarian sumber. Periksa nomor bukti dan nilainya sebelum memilih.'],
   ['Masukkan rincian akun','Tambahkan akun yang diperlukan berdasarkan dokumen koreksi. Pastikan SANDI berasal dari Master Akun yang benar.'],
   ['Masukkan nominal debit dan kredit','Catat nilai sesuai dasar koreksi. Jangan menentukan sisi debit/kredit hanya berdasarkan dugaan; ikuti sifat akun dan kebijakan akuntansi perusahaan.'],
   ['Periksa total dan alasan','Pastikan total debit sama dengan kredit dan uraian menjelaskan hubungan antara nota dan transaksi sumber.'],
   ['Simpan Draft atau Posting','Simpan Draft bila masih menunggu pemeriksaan. Posting hanya setelah nota, sumber, dan nominal disetujui.']
  ],
  example:'Misalnya terdapat koreksi biaya berdasarkan dokumen tambahan. Nota harus menjelaskan transaksi asal, alasan koreksi, akun yang terpengaruh, dan nilai koreksinya.',
  checks:'Periksa apakah nota tidak menggandakan koreksi yang sudah pernah dibuat. Pastikan transaksi sumber yang dipilih benar.',
  note:'Pembuatan Nota Debet tidak berarti jurnal asal otomatis berubah. Perlakukan nota sebagai dokumen dan pencatatan koreksi tersendiri sesuai alur aplikasi.'
 },
 'page-accounts':{
  title:'Master Akun',purpose:'Master Akun adalah daftar utama kode atau SANDI dan nama akun. Modul lain menggunakan daftar ini sebagai acuan agar transaksi dicatat pada akun yang konsisten.',
  prepare:'Siapkan daftar akun resmi perusahaan yang memuat kode/SANDI dan nama akun. Jika melakukan import, gunakan file yang sesuai dengan format yang didukung.',
  steps:[
   ['Cari akun yang sudah ada','Gunakan pencarian berdasarkan SANDI atau nama. Periksa dahulu sebelum menambahkan akun baru agar tidak terjadi duplikasi.'],
   ['Tambahkan akun bila diperlukan','Masukkan SANDI dan nama akun sesuai daftar resmi. Pastikan tidak ada spasi, salah ketik, atau kode yang tertukar.'],
   ['Perbarui data dengan hati-hati','Jika nama akun berubah, pastikan perubahan tersebut memang disetujui dan tidak mengubah arti kode akun. Jangan mengganti SANDI hanya untuk merapikan tampilan.'],
   ['Periksa keunikan SANDI','Setiap akun harus memiliki kode yang dapat dibedakan. Kode yang sama untuk dua akun dapat menyebabkan transaksi salah klasifikasi.'],
   ['Gunakan Master Akun sebagai acuan','Saat menginput jurnal, saldo awal, atau anggaran, pilih akun dari daftar ini. Hindari mengetik kode berbeda di file sumber.']
  ],
  example:'Jika SANDI 510101 adalah Biaya Pemeliharaan Mesin, seluruh jurnal dan anggaran untuk akun tersebut harus merujuk pada kode yang sama.',
  checks:'Sebelum import, cocokkan jumlah baris, SANDI, dan nama akun dengan file sumber. Setelah import, cari beberapa akun secara acak untuk memastikan hasilnya benar.',
  note:'Master Akun merupakan sumber referensi akun. Saldo Awal ACC & Program menyimpan nilai saldo dengan mengacu pada SANDI Master Akun, bukan membuat akun duplikat.'
 },
 'page-opening-balances':{
  title:'Saldo Awal ACC & Program',purpose:'Modul ini menyimpan posisi saldo pembukaan setiap akun pada periode tertentu. Saldo awal menjadi titik awal perhitungan saldo dan laporan periode berjalan.',
  prepare:'Pastikan Master Akun sudah benar. Siapkan neraca saldo atau daftar saldo pembukaan yang telah diperiksa dan disetujui, lengkap dengan periode serta nilai debit/kredit.',
  steps:[
   ['Pilih periode saldo','Tentukan bulan dan tahun saldo awal yang sedang dimasukkan. Periode harus sesuai dokumen pembukaan dan tidak boleh tertukar dengan periode transaksi berjalan.'],
   ['Pilih SANDI akun','Gunakan SANDI dari Master Akun. Pastikan nama akun yang tampil cocok dengan dokumen saldo awal.'],
   ['Masukkan saldo pada sisi yang benar','Isi debit awal atau kredit awal sesuai posisi saldo pada dokumen. Jangan memasukkan nilai yang sama ke kedua sisi.'],
   ['Periksa akun yang belum terdaftar','Jika SANDI tidak ditemukan, hentikan proses untuk memeriksa Master Akun atau file sumber. Jangan mengganti kode secara asal agar import lolos.'],
   ['Periksa keseimbangan','Jumlah saldo debit dan kredit harus seimbang sesuai neraca saldo pembukaan. Selisih harus ditelusuri ke dokumen sumber.'],
   ['Simpan atau import setelah pemeriksaan','Periksa ringkasan dan validasi sebelum konfirmasi. Jika aplikasi melaporkan duplikasi, baca baris mana yang dilewati dan jangan menganggap seluruh file otomatis masuk.']
  ],
  example:'Jika akun Kas memiliki saldo debit awal Rp2.000.000, masukkan Rp2.000.000 pada Debit Awal dan nol pada Kredit Awal. Akun dengan saldo kredit diisi pada sisi Kredit Awal.',
  checks:'Pastikan periode, SANDI, nominal, dan total debit/kredit benar. Cocokkan hasilnya dengan neraca saldo pembukaan yang disetujui.',
  note:'Saldo awal menjadi dasar perhitungan Neraca Percobaan. Data saldo awal yang keliru dapat membuat saldo akhir periode ikut keliru.'
 },
 'page-annual-budget':{
  title:'Anggaran Tahunan',purpose:'Modul ini digunakan untuk menetapkan pagu anggaran per SANDI akun dalam satu tahun dan membagi pagu tersebut ke dalam anggaran bulanan.',
  prepare:'Siapkan rencana anggaran yang sudah disetujui, tahun anggaran, daftar SANDI, total pagu per akun, dan pembagian per bulan.',
  steps:[
   ['Pilih tahun anggaran','Pastikan tahun sesuai dokumen rencana kerja. Jangan memasukkan pagu tahun berikutnya ke tahun yang sedang berjalan.'],
   ['Pilih SANDI akun','Tentukan akun yang akan diberi anggaran. Gunakan SANDI Master Akun agar anggaran dapat dibandingkan dengan transaksi.'],
   ['Masukkan pagu tahunan','Isi jumlah total anggaran untuk akun tersebut sesuai persetujuan. Periksa satuan dan jumlah digit agar tidak salah menambahkan nol.'],
   ['Bagi pagu ke Januari sampai Desember','Masukkan alokasi masing-masing bulan. Jumlah seluruh bulan harus sama dengan pagu tahunan, kecuali kebijakan anggaran yang berlaku menyatakan lain.'],
   ['Simpan dan periksa kembali','Pastikan tahun, SANDI, pagu tahunan, dan total bulanan sesuai. Jika menggunakan import, gunakan template resmi dari Pusat Import Data.'],
   ['Pantau realisasi','Bandingkan nilai anggaran dengan jurnal yang telah POSTED pada periode terkait. Perhatikan sisa anggaran dan kemungkinan kelebihan pemakaian.']
  ],
  example:'Pagu tahunan Rp120.000.000 dapat dibagi Rp10.000.000 per bulan. Jika Januari menggunakan Rp8.000.000 dari transaksi Posted, sisa anggaran Januari adalah Rp2.000.000, sesuai aturan perhitungan aplikasi.',
  checks:'Jangan sampai total alokasi bulanan lebih besar atau lebih kecil dari pagu tahunan. Pastikan SANDI dan tahun anggaran benar sebelum import.',
  note:'Realisasi anggaran harus dibaca berdasarkan aturan status transaksi aplikasi. Draft bukan transaksi Posted. Tampilan kontrol anggaran pada Input Jurnal dapat berupa pratinjau dan bukan bukti bahwa transaksi sudah diposting.'
 },
 'page-periods':{
  title:'Periode Akuntansi',purpose:'Modul ini mengatur periode pembukuan yang sedang digunakan dan membantu mengendalikan apakah suatu periode masih dapat menerima transaksi.',
  prepare:'Pastikan kalender pembukuan perusahaan, daftar transaksi yang belum selesai, serta persetujuan penanggung jawab periode tersedia.',
  steps:[
   ['Pilih periode yang akan diperiksa','Tentukan bulan dan tahun yang ingin dibuka atau ditutup. Periksa kembali agar tidak memilih periode yang salah.'],
   ['Periksa transaksi dalam periode','Tinjau jurnal Draft, Posted, dan transaksi yang belum lengkap. Pastikan dokumen sumber sudah diterima dan dicatat.'],
   ['Lakukan rekonsiliasi','Bandingkan catatan dengan dokumen pendukung dan laporan. Selesaikan selisih sebelum periode ditutup.'],
   ['Gunakan tindakan buka atau tutup sesuai hak','Ikuti tombol dan konfirmasi yang tersedia. Jika tidak berwenang, minta persetujuan administrator atau penanggung jawab akuntansi.'],
   ['Catat keputusan periode','Simpan informasi atau bukti persetujuan sesuai prosedur perusahaan agar perubahan status dapat ditelusuri.']
  ],
  example:'Sebelum menutup periode Oktober, pastikan transaksi Oktober sudah diperiksa, saldo akun direkonsiliasi, dan tidak ada dokumen penting yang tertinggal.',
  checks:'Jangan menutup periode hanya karena bulan telah berganti. Pastikan proses pemeriksaan dan persetujuan sudah dilakukan.',
  note:'Perubahan status periode dapat memengaruhi kemampuan pengguna mencatat transaksi pada periode tersebut. Ikuti kebijakan perusahaan.'
 },
 'page-ledger':{
  title:'Buku Besar per Akun',purpose:'Buku Besar menampilkan riwayat mutasi satu akun sehingga pengguna dapat melihat dari mana saldo akun berasal dan bagaimana saldo berubah.',
  prepare:'Pastikan saldo awal dan jurnal sudah dimasukkan. Ketahui periode serta SANDI akun yang ingin ditelusuri.',
  steps:[
   ['Pilih periode','Tentukan rentang waktu yang ingin diperiksa. Pastikan tanggal awal dan akhir sesuai kebutuhan laporan.'],
   ['Pilih akun atau SANDI','Pilih satu akun dari Master Akun. Periksa nama akun agar tidak tertukar dengan akun yang kodenya mirip.'],
   ['Tampilkan Buku Besar','Jalankan tampilan laporan sesuai tombol yang tersedia. Aplikasi akan menyusun saldo awal dan mutasi akun untuk periode tersebut.'],
   ['Baca saldo awal','Saldo awal menunjukkan posisi akun sebelum mutasi periode yang dipilih. Cocokkan dengan saldo pembukaan atau saldo akhir periode sebelumnya.'],
   ['Telusuri mutasi transaksi','Periksa tanggal, nomor bukti, uraian, debit, dan kredit. Jika ada angka yang tidak dikenali, buka jurnal sumbernya.'],
   ['Periksa saldo berjalan dan akhir','Saldo berjalan memperlihatkan perubahan setelah setiap transaksi. Saldo akhir merupakan posisi setelah seluruh mutasi yang dihitung.']
  ],
  example:'Jika saldo awal debit Rp5.000.000, kemudian ada mutasi debit Rp1.000.000 dan kredit Rp500.000, saldo akhir normal debit menjadi Rp5.500.000.',
  checks:'Pastikan filter periode dan SANDI benar. Mutasi laporan mengikuti transaksi yang memenuhi status perhitungan, terutama jurnal POSTED.',
  note:'Buku Besar membantu penelusuran, tetapi tetap cocokkan transaksi dengan bukti sumber jika menemukan perbedaan.'
 },
 'page-reports':{
  title:'Neraca Percobaan & Laporan',purpose:'Neraca Percobaan merangkum saldo setiap akun untuk membantu memeriksa apakah total debit dan kredit seimbang pada periode tertentu.',
  prepare:'Pastikan Master Akun, saldo awal, dan jurnal periode telah dimasukkan serta diperiksa.',
  steps:[
   ['Pilih periode laporan','Tentukan periode yang ingin ditampilkan. Jangan membandingkan laporan dengan periode yang berbeda.'],
   ['Tampilkan Neraca Percobaan','Jalankan laporan agar aplikasi menghitung saldo awal, mutasi, dan saldo akhir per SANDI akun.'],
   ['Periksa kolom saldo awal','Cocokkan nilai saldo awal dengan Daftar Saldo Awal ACC & Program pada periode yang sesuai.'],
   ['Periksa kolom mutasi','Mutasi berasal dari jurnal yang memenuhi status perhitungan pada periode tersebut. Draft tidak dihitung sebagai mutasi Posted.'],
   ['Periksa saldo akhir setiap akun','Pastikan perhitungan per SANDI masuk akal dan tidak ada akun yang hilang atau salah kelompok.'],
   ['Bandingkan total debit dan kredit','Total saldo akhir debit harus sama dengan total saldo akhir kredit. Jika tidak sama, lakukan penelusuran sebelum laporan digunakan.'],
   ['Cetak atau ekspor','Setelah diperiksa, gunakan fungsi ekspor atau cetak untuk menyimpan hasil sesuai kebutuhan kerja.']
  ],
  example:'Saldo akhir suatu akun dihitung dari saldo awal ditambah atau dikurangi mutasi sesuai sifat akun. Jangan hanya melihat total keseluruhan; periksa juga saldo setiap SANDI.',
  checks:'Jika total tidak seimbang, periksa saldo awal, jurnal Posted, periode transaksi, dan akun yang tidak terdaftar. Jangan mengubah angka laporan secara manual untuk menutupi selisih.',
  note:'Laporan adalah hasil dari data sumber. Ketepatan laporan bergantung pada kelengkapan dan kebenaran Master Akun, saldo awal, serta jurnal.'
 },
 'page-import-center':{
  title:'Pusat Import Data',purpose:'Pusat Import Data digunakan untuk memasukkan banyak data dari file Excel, CSV, atau DBF sesuai jenis import yang disediakan. Import membantu mempercepat pekerjaan, tetapi file tetap harus diperiksa sebelum disimpan.',
  prepare:'Simpan salinan file asli. Pastikan format file sesuai template, kolom wajib tersedia, periode benar, dan Master Akun sudah siap jika data menggunakan SANDI.',
  steps:[
   ['Pilih kartu jenis data','Tentukan apakah Anda akan mengimpor Anggaran, Master Akun, Saldo Awal, Jurnal Massal, atau NPTRANS. Jangan memilih jenis import hanya berdasarkan ekstensi file.'],
   ['Unduh template resmi bila tersedia','Gunakan tombol Unduh Format Excel atau CSV pada kartu terkait. Template menunjukkan nama sheet dan kolom yang dikenali aplikasi.'],
   ['Isi file tanpa mengubah struktur penting','Isi data pada kolom yang disediakan. Jangan menghapus nama sheet, mengganti judul kolom wajib, atau menggabungkan sel jika template tidak mengizinkan.'],
   ['Pilih file','Tekan Pilih File pada kartu yang sesuai dan pilih file dari komputer. Periksa nama file yang tampil sebelum melanjutkan.'],
   ['Jalankan pemeriksaan atau pratinjau','Aplikasi membaca file dan menampilkan ringkasan data, baris valid, atau kesalahan. Baca seluruh pesan, jangan langsung menekan konfirmasi.'],
   ['Perbaiki kesalahan pada file sumber','Jika SANDI tidak ditemukan, periksa Master Akun. Jika tanggal atau nominal salah, perbaiki file asli lalu pilih kembali file yang sudah diperbaiki.'],
   ['Konfirmasi import','Lakukan hanya setelah ringkasan, jumlah baris, periode, dan nominal sesuai. Tunggu sampai aplikasi memberi pesan hasil.'],
   ['Verifikasi hasil import','Cari beberapa data yang baru masuk di modul tujuan. Bandingkan jumlah baris dan total nominal dengan file sumber.']
  ],
  example:'Jika mengimpor saldo awal, pastikan periode dan SANDI ada di Master Akun. Jika mengimpor anggaran, gunakan template gabungan dengan sheet Anggaran_Tahunan dan Anggaran_Bulanan.',
  checks:'Jangan import file yang sama berulang kali tanpa memeriksa apakah data sebelumnya sudah masuk. Perhatikan pesan duplikat, baris dilewati, atau gagal validasi.',
  note:'Import bukan pengganti pemeriksaan akuntansi. Simpan file sumber dan backup sebelum melakukan import dalam jumlah besar. Restore Backup berbeda dari import biasa karena dapat mengganti seluruh database lokal.'
 },
 'page-nptrans':{
  title:'NPTRANS / DBF',purpose:'Modul ini digunakan untuk membaca dan mengelola data NPTRANS dengan tetap memperhatikan struktur data lama yang digunakan sistem terdahulu.',
  prepare:'Siapkan backup sebelum mengubah data. Pastikan file DBF/Excel/CSV berasal dari sumber yang benar dan merupakan salinan yang dapat diperiksa. Ketahui apakah tujuan proses adalah menambah, menggabungkan, atau mengganti data.',
  steps:[
   ['Kenali sumber file','Periksa nama file, periode, dan asal data. Jangan menggunakan file dari folder yang tidak diketahui atau file yang belum dipastikan versi terbarunya.'],
   ['Periksa struktur kolom','Pastikan kolom wajib seperti kode akun/SANDI, tanggal, nomor bukti, uraian, debit, dan kredit tersedia sesuai struktur yang diminta aplikasi.'],
   ['Pilih cara penggabungan','Jika tersedia pilihan gabung tanpa duplikat, tambah semua baris, atau ganti seluruh data, pahami dampaknya sebelum memilih.'],
   ['Jalankan pratinjau','Periksa jumlah baris yang akan ditambahkan, dilewati, atau ditolak. Perhatikan pesan SANDI tidak ditemukan dan nilai debit/kredit tidak valid.'],
   ['Cocokkan dengan sumber','Bandingkan jumlah record dan beberapa transaksi sampel dengan file asal. Pastikan tanggal dan nominal tidak berubah akibat format.'],
   ['Konfirmasi proses','Lakukan setelah backup tersedia dan hasil pratinjau dipahami. Tunggu sampai proses selesai dan baca ringkasan hasil.'],
   ['Periksa data setelah import','Cari beberapa nomor bukti dan SANDI pada daftar NPTRANS. Pastikan data yang diharapkan benar-benar ada.']
  ],
  example:'Jika file sumber berisi 1.000 baris dan pratinjau menunjukkan 950 valid, 30 duplikat, dan 20 gagal, jangan langsung menyetujui. Periksa alasan 20 baris gagal dan pastikan 30 duplikat memang sudah ada.',
  checks:'Pastikan pilihan “ganti seluruh data” tidak digunakan jika tujuan Anda hanya menambahkan transaksi baru. Simpan backup sebelum perubahan besar.',
  note:'Struktur NPTRANS lama perlu dijaga agar kompatibilitas tetap baik. Jangan mengubah nama atau tipe kolom DBF tanpa memahami kebutuhan sistem.'
 },
 'page-journal-admin':{
  title:'Administrasi Jurnal',purpose:'Menu ini menyediakan tindakan administratif khusus terhadap data jurnal. Karena dampaknya dapat memengaruhi laporan, menu ini harus digunakan oleh petugas yang berwenang.',
  prepare:'Pastikan tujuan tindakan jelas, periode dan rentang tanggal sudah diketahui, persetujuan tersedia, dan backup terbaru sudah berhasil dibuat.',
  steps:[
   ['Tentukan cakupan tindakan','Pilih tanggal, bulan, atau tahun sesuai kebutuhan. Periksa kembali periode agar tidak mencakup transaksi di luar tujuan.'],
   ['Baca ringkasan sebelum tindakan','Perhatikan jumlah jurnal dan rentang data yang akan terpengaruh. Jika ringkasan tidak sesuai, batalkan dan periksa pilihan.'],
   ['Pahami dampaknya','Penghapusan atau perubahan administratif dapat mengubah mutasi laporan dan saldo terkait. Pastikan dokumen sumber serta alasan tindakan tercatat.'],
   ['Lakukan verifikasi otorisasi','Masukkan kredensial atau persetujuan yang diminta sesuai prosedur. Jangan membagikan password kepada pengguna lain.'],
   ['Konfirmasi hanya jika benar','Baca peringatan terakhir sebelum menyetujui. Jika ragu, batalkan dan minta pemeriksaan administrator.'],
   ['Periksa laporan setelah tindakan','Jalankan kembali validasi dan Neraca Percobaan. Cocokkan hasil dengan backup atau dokumen yang menjadi dasar tindakan.']
  ],
  example:'Jika tindakan ditujukan untuk satu bulan, pastikan pilihan bulan dan tahun benar. Jangan memilih “seluruh tahun” jika hanya satu bulan yang perlu ditangani.',
  checks:'Backup harus dapat dibaca dan berasal dari database yang benar. Simpan catatan alasan, waktu, dan pihak yang menyetujui tindakan.',
  note:'Tindakan administratif dapat berdampak luas dan mungkin sulit dibatalkan. Gunakan hanya sesuai otorisasi perusahaan.'
 },
 'page-print-settings':{
  title:'Pengaturan Template Cetak',purpose:'Menu ini mengatur tampilan hasil cetak agar laporan dan dokumen memiliki format yang konsisten, rapi, serta sesuai kebutuhan kertas.',
  prepare:'Ketahui ukuran kertas yang digunakan kantor, misalnya A4 atau F4, orientasi dokumen, dan elemen tanda tangan yang diperlukan.',
  steps:[
   ['Pilih ukuran kertas','Pilih ukuran yang sesuai dengan kertas printer. F4/Folio dan A4 memiliki panjang berbeda, jadi jangan memilih hanya berdasarkan kebiasaan.'],
   ['Tentukan orientasi','Portrait cocok untuk laporan yang memanjang ke bawah. Landscape cocok untuk tabel dengan banyak kolom. Gunakan otomatis jika aplikasi menyediakan penyesuaian.'],
   ['Atur margin dan ukuran huruf','Gunakan margin yang cukup agar isi tidak terpotong. Huruf harus tetap terbaca setelah dicetak.'],
   ['Atur identitas dan elemen dokumen','Pilih apakah identitas SBP Accounting, tanggal cetak, footer, ringkasan, tanda tangan, dan garis tabel perlu ditampilkan.'],
   ['Simpan pengaturan','Tekan Simpan Pengaturan setelah selesai. Pengaturan disimpan pada browser dan perangkat yang sedang digunakan.'],
   ['Gunakan pratinjau','Lihat halaman sebelum mencetak. Periksa nomor halaman, kop, tanda tangan, tabel, dan bagian bawah dokumen.']
  ],
  example:'Laporan Neraca Percobaan dengan banyak kolom biasanya lebih nyaman dicetak Landscape, sedangkan surat atau dokumen ringkas dapat menggunakan Portrait.',
  checks:'Periksa pratinjau sebelum mencetak banyak salinan. Pastikan printer memakai ukuran kertas yang sama dengan pengaturan aplikasi.',
  note:'Pengaturan cetak tersimpan pada browser/perangkat ini dan tidak otomatis berpindah ke perangkat lain. Pengaturan cetak tidak mengubah data akuntansi.'
 },
 'page-audit':{
  title:'Riwayat Aktivitas / Audit Log',purpose:'Audit Log membantu menelusuri aktivitas perubahan data, misalnya penambahan, perubahan, atau penghapusan pada modul yang dicatat aplikasi.',
  prepare:'Ketahui perkiraan waktu, jenis aktivitas, nama modul, nomor bukti, atau SANDI yang ingin ditelusuri.',
  steps:[
   ['Buka daftar aktivitas','Tunggu sampai catatan dimuat. Perhatikan urutan waktu dan jumlah aktivitas yang tersedia.'],
   ['Cari aktivitas tertentu','Gunakan kolom pencarian untuk memasukkan nomor bukti, akun, uraian, atau kata kunci.'],
   ['Gunakan filter tindakan','Pilih jenis aksi seperti Tambah, Ubah, atau Hapus untuk mempersempit hasil.'],
   ['Baca rincian catatan','Periksa waktu, modul, ID data, ringkasan, dan detail perubahan yang ditampilkan. Cocokkan dengan dokumen pendukung.'],
   ['Ekspor bila diperlukan','Gunakan ekspor CSV untuk menyimpan catatan pemeriksaan atau menyampaikan temuan kepada penanggung jawab.']
  ],
  example:'Jika nama akun berubah, cari SANDI akun tersebut lalu periksa waktu dan rincian aktivitas untuk mengetahui perubahan yang tercatat.',
  checks:'Log yang tersedia bergantung pada tindakan yang memang dicatat aplikasi. Jika ada perubahan yang tidak tercatat, lakukan pemeriksaan melalui backup dan sumber dokumen.',
  note:'Audit Log membantu penelusuran, tetapi bukan sistem keamanan anti-manipulasi yang mutlak. Lindungi perangkat, browser, dan file database.'
 },
 'page-archive':{
  title:'Arsip 5 Tahunan',purpose:'Modul ini digunakan untuk membuat arsip data dalam rentang tahun tertentu agar catatan lama dapat disimpan dan diperiksa tanpa harus selalu berada dalam database aktif.',
  prepare:'Pastikan backup database aktif sudah dibuat. Tentukan rentang tahun yang akan diarsipkan dan lokasi penyimpanan arsip.',
  steps:[
   ['Tentukan rentang tahun','Isi tahun awal dan akhir sesuai kebijakan pengarsipan. Pastikan tidak ada tahun yang terlewat atau salah ketik.'],
   ['Buat arsip','Jalankan proses pembuatan arsip dan tunggu hingga aplikasi menampilkan hasil. Jangan menutup aplikasi saat proses berjalan.'],
   ['Simpan file arsip','Simpan arsip pada lokasi yang aman dan buat salinan terpisah. Gunakan nama file yang mudah dikenali berdasarkan periode.'],
   ['Jalankan verifikasi','Gunakan fitur verifikasi checksum atau pemeriksaan yang tersedia untuk memastikan file arsip tidak berubah atau rusak.'],
   ['Catat lokasi arsip','Catat nama file, rentang tahun, tanggal pembuatan, dan lokasi penyimpanan agar mudah ditemukan saat diperlukan.']
  ],
  example:'Arsip 2021–2025 berarti rentang data yang dipilih mencakup lima tahun tersebut. Pastikan periode dan isi arsip sesuai sebelum menyimpannya sebagai arsip resmi.',
  checks:'Jangan menghapus database aktif hanya karena arsip berhasil dibuat. Pastikan file arsip dapat dibaca kembali.',
  note:'Pembuatan arsip tidak otomatis memindahkan atau menghapus data aktif. Arsip dan backup rutin memiliki tujuan yang berbeda; simpan keduanya sesuai kebijakan.'
 },
 'page-archive-reader':{
  title:'Pembaca Arsip',purpose:'Pembaca Arsip digunakan untuk melihat isi file arsip secara terpisah. Tujuannya agar pengguna dapat mencari data lama tanpa mengganti database aktif.',
  prepare:'Siapkan file arsip yang berasal dari aplikasi dan pastikan file tersebut tidak rusak. Jangan memilih file backup biasa jika modul meminta format arsip khusus.',
  steps:[
   ['Pilih file arsip','Gunakan tombol pilih file dan arahkan ke arsip yang ingin dibaca. Periksa nama serta rentang tahun pada file.'],
   ['Tentukan jenis data','Pilih jurnal, akun, saldo, atau jenis informasi lain yang tersedia pada pembaca arsip.'],
   ['Gunakan filter pencarian','Masukkan periode, SANDI, nomor bukti, atau kata kunci untuk menemukan catatan yang dibutuhkan.'],
   ['Baca hasil secara teliti','Periksa tanggal, akun, uraian, dan nilai. Jika digunakan sebagai dasar koreksi, cocokkan dengan dokumen resmi.'],
   ['Tutup pembacaan setelah selesai','Kembali ke modul aktif tanpa melakukan restore. Database aktif tidak perlu diganti hanya untuk melihat data arsip.']
  ],
  example:'Untuk mencari jurnal tahun 2022, pilih arsip yang mencakup 2022, pilih jenis data jurnal, lalu gunakan filter tahun atau nomor bukti.',
  checks:'Pastikan file arsip yang dibuka mencakup tahun yang dicari. Jika data tidak muncul, periksa rentang arsip dan filter.',
  note:'Modul ini bersifat baca saja. Membaca arsip tidak sama dengan memulihkan backup ke database aktif.'
 },
 'page-backup':{
  title:'Backup & Restore',purpose:'Backup membuat salinan database agar data dapat dipulihkan jika perangkat rusak, browser bermasalah, atau pengguna berpindah komputer. Restore mengembalikan database dari file backup.',
  prepare:'Tentukan lokasi penyimpanan yang aman, misalnya folder server kantor atau media penyimpanan lain. Pastikan folder dapat diakses dan pengguna memiliki izin tulis.',
  steps:[
   ['Hubungkan folder backup','Tekan Pilih Folder Server lalu pilih folder tujuan. Berikan izin baca/tulis kepada browser. Gunakan folder khusus SBP Accounting agar file tidak bercampur dengan dokumen lain.'],
   ['Buat backup pertama','Setelah folder terhubung, aplikasi akan mencoba membuat backup pertama. Periksa pesan status untuk memastikan proses berhasil. Jangan menganggap folder terhubung berarti backup sudah berhasil jika belum ada pesan sukses.'],
   ['Pahami struktur backup','Aplikasi menyimpan salinan terbaru dan arsip harian pada folder yang disiapkan. Jangan mengubah nama atau isi file secara manual jika tidak memahami formatnya.'],
   ['Simpan salinan tambahan','Unduh backup JSON atau salin file backup ke media terpisah sesuai kebijakan kantor. Satu lokasi backup saja tidak cukup jika lokasi tersebut ikut rusak.'],
   ['Saat berpindah perangkat, pulihkan data lama terlebih dahulu','Pada perangkat baru, ambil backup terbaru yang sudah dipastikan benar dari perangkat sebelumnya. Buka menu Backup & Restore, pilih file JSON, baca ringkasan akun, jurnal, NPTRANS, dan saldo awal, lalu lakukan restore hanya jika file memang berasal dari database yang ingin dilanjutkan.'],
   ['Periksa hasil pemulihan','Setelah restore, periksa Master Akun, beberapa jurnal, saldo awal, NPTRANS, dan laporan. Pastikan periode dan jumlah data sesuai dengan perangkat sebelumnya.'],
   ['Hubungkan lokasi backup perangkat baru','Setelah data lama berhasil dipulihkan dan diverifikasi, tentukan folder backup yang akan digunakan perangkat baru. Buat backup baru sebelum mulai bekerja.']
  ],
  example:'Jika komputer lama berisi transaksi sampai 31 Oktober, jangan mulai menginput transaksi baru pada komputer baru dengan database kosong. Ambil backup terbaru komputer lama, pulihkan ke komputer baru, periksa hasilnya, lalu lanjutkan pencatatan dari database yang sama.',
  checks:'Jangan menjalankan dua database terpisah pada dua perangkat lalu menggabungkannya dengan menyalin file secara acak. Backup bukan sinkronisasi langsung. Hindari input bersamaan pada dua perangkat karena transaksi dapat berbeda atau tertinggal.',
  note:'Restore mengganti seluruh database lokal pada perangkat yang sedang digunakan. Selalu buat backup kondisi perangkat tujuan sebelum restore, periksa nama dan ringkasan file, dan jangan memulihkan file yang tidak diketahui asalnya.'
 }
};
function openModuleGuide(){
 const active=document.querySelector('.page.active'),guide=moduleGuides[active?.id];
 const content=$('module-guide-content');
 if(!guide){
  $('module-guide-title').textContent=$('page-title')?.textContent||'Panduan';
  content.innerHTML='<p>Panduan rinci untuk menu ini sedang disiapkan.</p>';
 }else{
  $('module-guide-title').textContent=guide.title;
  const escText=v=>esc(String(v??''));
  content.innerHTML=
   '<div class="guide-learning-intro"><span class="guide-section-kicker">MENGENAL MODUL</span><p>'+escText(guide.purpose)+'</p></div>'+
   '<section class="guide-learning-section"><h3>Persiapan sebelum mulai</h3><p>'+escText(guide.prepare)+'</p></section>'+
   '<section class="guide-learning-section"><h3>Langkah penggunaan</h3><ol class="guide-learning-steps">'+guide.steps.map((step,i)=>'<li><span class="guide-step-number">'+(i+1)+'</span><div><b>'+escText(step[0])+'</b><p>'+escText(step[1])+'</p></div></li>').join('')+'</ol></section>'+
   '<section class="guide-learning-example"><h3>Contoh sederhana</h3><p>'+escText(guide.example)+'</p></section>'+
   '<section class="guide-learning-section"><h3>Hal yang perlu diperiksa</h3><p>'+escText(guide.checks)+'</p></section>'+
   '<section class="guide-learning-warning"><h3><i data-lucide="alert-triangle"></i> Peringatan penting</h3><p>'+escText(guide.note)+'</p></section>';
 }
 $('module-guide-modal').hidden=false;
 if(window.lucide?.createIcons)window.lucide.createIcons();
}
$('module-guide-open').onclick=openModuleGuide;
$('module-guide-close').onclick=()=>$('module-guide-modal').hidden=true;
$('module-guide-modal').addEventListener('click',e=>{if(e.target===$('module-guide-modal'))$('module-guide-modal').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('module-guide-modal')&&!$('module-guide-modal').hidden)$('module-guide-modal').hidden=true});

/* BUILD V66 — read-only validation and data integrity checks. */
function runDataValidation(){
 const issues=[],accounts=Array.isArray(state.accounts)?state.accounts:[],journals=Array.isArray(state.journals)?state.journals:[],openings=Array.isArray(state.openingBalances)?state.openingBalances:[],npRows=Array.isArray(state.nptrans)?state.nptrans:[];
 const accountCodes=new Set(accounts.map(a=>String(a.code??'').trim()).filter(Boolean));
 const add=(level,category,location,detail,action)=>issues.push({level,category,location,detail,action});
 const accountCount=new Map();
 accounts.forEach(a=>{const code=String(a.code??'').trim();if(code)accountCount.set(code,(accountCount.get(code)||0)+1);if(!code)add('GAGAL','Master Akun','Baris akun','Kode/SANDI akun kosong.','Lengkapi kode akun atau periksa data sumber.');if(!String(a.name??'').trim())add('PERINGATAN','Master Akun','Akun '+(code||'(tanpa kode)'),'Nama akun kosong.','Lengkapi nama akun setelah memastikan kode akun benar.')});
 for(const [code,count] of accountCount)if(count>1)add('GAGAL','Master Akun','Kode '+code,'Kode akun muncul '+count+' kali.','Tentukan satu kode akun yang benar dan tinjau transaksi yang menggunakannya.');
 const journalNumbers=new Map();
 journals.forEach((j,index)=>{
  const no=String(j.number??'').trim(),date=String(j.date??''),loc='Jurnal '+(no||('#'+(index+1)));
  if(no){const key=no.toLowerCase();if(!journalNumbers.has(key))journalNumbers.set(key,[]);journalNumbers.get(key).push(loc)}
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))add('GAGAL','Jurnal',loc,'Tanggal tidak valid atau kosong.','Periksa tanggal pada jurnal sumber.');
  if(!no)add('GAGAL','Jurnal',loc,'Nomor bukti kosong.','Periksa dan lengkapi nomor bukti.');
  if(!String(j.description??'').trim())add('PERINGATAN','Jurnal',loc,'Keterangan jurnal kosong.','Tambahkan uraian transaksi yang dapat ditelusuri.');
  const period=date.slice(0,7),lines=Array.isArray(j.lines)?j.lines:[];
  if(period&&isPeriodLocked(period))add('GAGAL','Periode',loc,'Transaksi ditemukan pada periode yang berstatus ditutup ('+period+').','Verifikasi riwayat tutup/buka periode dan sumber transaksi; jangan mengubah status secara langsung.');
  if(!lines.length)add(j.status==='draft'?'PERINGATAN':'GAGAL','Jurnal',loc,'Jurnal tidak memiliki baris akun.','Periksa detail jurnal dan lengkapi melalui prosedur koreksi yang berlaku.');
  let debit=0,credit=0;
  lines.forEach((line,i)=>{
   const code=String(line.code??'').trim(),d=Number(line.debit||0),c=Number(line.credit||0),where=loc+' · baris '+(i+1);
   if(!code)add('GAGAL','Jurnal',where,'Kode akun kosong.','Pilih akun yang benar dari Master Akun.');
   else if(!accountCodes.has(code))add('GAGAL','Jurnal',where,'Kode akun '+code+' tidak ditemukan di Master Akun.','Verifikasi kode terhadap dokumen sumber dan Master Akun.');
   if(!Number.isFinite(d)||!Number.isFinite(c)||d<0||c<0)add('GAGAL','Jurnal',where,'Nilai debit/kredit tidak valid atau negatif.','Periksa nilai nominal pada baris jurnal.');
   if(d>0&&c>0)add('GAGAL','Jurnal',where,'Satu baris berisi debit dan kredit sekaligus.','Pisahkan sisi debit dan kredit sesuai dokumen sumber.');
   if(d===0&&c===0)add('PERINGATAN','Jurnal',where,'Baris tidak memiliki nilai debit maupun kredit.','Pastikan baris kosong memang diperlukan.');
   if(Number.isFinite(d)&&d>0)debit+=d;if(Number.isFinite(c)&&c>0)credit+=c;
  });
  if(lines.length&&Math.abs(debit-credit)>.005)add(j.status==='draft'?'PERINGATAN':'GAGAL','Keseimbangan Jurnal',loc,'Debit '+money(debit)+' dan kredit '+money(credit)+'; selisih '+money(debit-credit)+'.','Telusuri baris jurnal dan dokumen sumber sebelum membuat jurnal koreksi.');
 });
 for(const [no,locations] of journalNumbers)if(locations.length>1)add('PERINGATAN','Nomor Bukti','Nomor '+no,'Nomor bukti digunakan oleh '+locations.length+' jurnal.','Pastikan nomor bukti memang boleh berulang menurut kebijakan penomoran; jika tidak, koreksi dengan prosedur resmi.');
 const openingKeys=new Map(),openingTotals=new Map();
 openings.forEach((o,i)=>{
  const period=String(o.period??''),code=String(o.accountCode??'').trim(),d=Number(o.debit||0),c=Number(o.credit||0),loc='Saldo awal '+(period||'(tanpa periode)')+' / '+(code||'baris '+(i+1));
  if(!/^\d{4}-\d{2}$/.test(period))add('GAGAL','Saldo Awal',loc,'Periode saldo awal tidak valid.','Periksa periode pada data saldo awal.');
  if(!code)add('GAGAL','Saldo Awal',loc,'Kode akun kosong.','Pilih kode akun yang benar.');
  else if(!accountCodes.has(code))add('GAGAL','Saldo Awal',loc,'Kode akun '+code+' tidak ditemukan di Master Akun.','Cocokkan saldo awal dengan Master Akun.');
  if(!Number.isFinite(d)||!Number.isFinite(c)||d<0||c<0)add('GAGAL','Saldo Awal',loc,'Nilai debit/kredit tidak valid atau negatif.','Periksa nominal saldo awal.');
  const key=period+'|'+code;openingKeys.set(key,(openingKeys.get(key)||0)+1);
  const t=openingTotals.get(period)||{debit:0,credit:0};if(Number.isFinite(d)&&d>0)t.debit+=d;if(Number.isFinite(c)&&c>0)t.credit+=c;openingTotals.set(period,t);
 });
 for(const [key,count] of openingKeys)if(count>1)add('PERINGATAN','Saldo Awal',key,'Terdapat '+count+' baris saldo awal untuk akun dan periode yang sama.','Periksa apakah baris tersebut memang disengaja atau merupakan duplikasi.');
 for(const [period,t] of openingTotals)if(Math.abs(t.debit-t.credit)>.005)add('GAGAL','Keseimbangan Saldo Awal',period,'Total debit '+money(t.debit)+' tidak sama dengan kredit '+money(t.credit)+'.','Rekonsiliasi saldo awal berdasarkan neraca saldo pembukaan yang disetujui.');
 const npKeys=new Map();
 npRows.forEach((r,i)=>{
  const key=[r.tanggal,r.nobukti,r.nourut,r.sandi].map(v=>String(v??'').trim().toLowerCase()).join('|');
  npKeys.set(key,(npKeys.get(key)||0)+1);
  if(!String(r.sandi??'').trim())add('PERINGATAN','NPTRANS','Baris '+(i+1),'SANDI kosong.','Periksa record NPTRANS sumber.');
  if(!String(r.nobukti??'').trim())add('PERINGATAN','NPTRANS','Baris '+(i+1),'Nomor bukti kosong.','Periksa record NPTRANS sumber.');
  if(!Number.isFinite(Number(r.jumlah)))add('GAGAL','NPTRANS','Baris '+(i+1),'Nilai JUMLAH bukan angka yang valid.','Periksa nilai pada file sumber.');
 });
 for(const [key,count] of npKeys)if(count>1)add('PERINGATAN','NPTRANS','Kunci '+key,'Kombinasi tanggal, nomor bukti, nomor urut, dan SANDI muncul '+count+' kali.','Bandingkan dengan file NPTRANS asli sebelum memutuskan apakah record duplikat.');
 return {issues,checkedAt:new Date(),counts:{accounts:accounts.length,journals:journals.length,openings:openings.length,nptrans:npRows.length}};
}
function renderValidation(){
 const result=runDataValidation(),filter=$('validation-filter')?.value||'all',errors=result.issues.filter(x=>x.level==='GAGAL').length,warnings=result.issues.length-errors;
 $('validation-total').textContent=result.issues.length.toLocaleString('id-ID');$('validation-errors').textContent=errors.toLocaleString('id-ID');$('validation-warnings').textContent=warnings.toLocaleString('id-ID');
 const status=$('validation-status');status.textContent=errors?'PERLU PERBAIKAN':warnings?'ADA PERINGATAN':'VALID';status.className=errors?'validation-bad':warnings?'validation-warn':'validation-good';
 $('validation-meta').textContent='Diperiksa '+result.checkedAt.toLocaleString('id-ID')+' · '+result.counts.accounts+' akun · '+result.counts.journals+' jurnal · '+result.counts.openings+' saldo awal · '+result.counts.nptrans+' baris NPTRANS.';
 const shown=result.issues.filter(x=>filter==='all'||x.level===filter);
 $('validation-results').innerHTML=shown.length?'<div class="table-wrap"><table class="validation-table"><thead><tr><th>Status</th><th>Kategori</th><th>Lokasi data</th><th>Temuan</th><th>Saran pemeriksaan</th></tr></thead><tbody>'+shown.map(x=>'<tr><td><span class="validation-badge '+(x.level==='GAGAL'?'bad':'warn')+'">'+x.level+'</span></td><td>'+esc(x.category)+'</td><td>'+esc(x.location)+'</td><td>'+esc(x.detail)+'</td><td>'+esc(x.action)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="validation-clear"><i data-lucide="check-circle-2"></i><b>'+(result.issues.length?'Tidak ada temuan pada filter ini.':'Tidak ditemukan masalah pada pemeriksaan yang tersedia.')+'</b><span>Hasil pemeriksaan hanya mencakup aturan validasi BUILD V66.</span></div>';
 if(window.lucide?.createIcons)window.lucide.createIcons();
}
$('validation-run').onclick=renderValidation;$('validation-filter').onchange=renderValidation;

function renderAuditLogs(){const q=($('audit-search')?.value||'').trim().toLowerCase(),filter=$('audit-action-filter')?.value||'all',items=(state.auditLogs||[]).filter(x=>(x.summary+' '+x.entity+' '+x.entityId+' '+x.action).toLowerCase().includes(q)&&(filter==='all'||x.action===filter)).sort((x,y)=>String(y.at).localeCompare(String(x.at)));$('audit-count').textContent=items.length.toLocaleString('id-ID')+' aktivitas';$('audit-rows').innerHTML=items.length?items.slice(0,500).map(x=>'<tr><td>'+esc(new Date(x.at).toLocaleString('id-ID'))+'</td><td><b>'+esc(x.action)+'</b></td><td>'+esc(x.entity)+'</td><td>'+esc(x.entityId)+'</td><td>'+esc(x.summary)+'</td><td><details><summary>Lihat perubahan</summary><pre class="audit-json">'+esc(JSON.stringify({sebelum:x.before,sesudah:x.after},null,2))+'</pre></details></td></tr>').join(''):'<tr><td colspan="6" class="empty">Belum ada aktivitas yang tercatat.</td></tr>'}
function exportAuditCsv(){const rows=[['WAKTU','AKSI','MODUL','ID DATA','RINGKASAN','SEBELUM','SESUDAH'],...(state.auditLogs||[]).map(x=>[x.at,x.action,x.entity,x.entityId,x.summary,JSON.stringify(x.before??''),JSON.stringify(x.after??'')])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\\r\\n');downloadBlob(new Blob(['\\ufeff'+csv],{type:'text/csv;charset=utf-8'}),'SBP-Audit-Log.csv')}
$('audit-search').oninput=renderAuditLogs;$('audit-action-filter').onchange=renderAuditLogs;$('audit-export').onclick=exportAuditCsv;
$('archive-read-file').onchange=e=>loadArchiveReaderFile(e.target.files?.[0]);$('archive-read-mode').onchange=renderArchiveReader;$('archive-read-search').oninput=renderArchiveReader;$('archive-read-period').onchange=renderArchiveReader;$('archive-read-account').onchange=renderArchiveReader;
$('archive-create').onclick=createFiveYearArchive;$('archive-verify').onclick=verifyFiveYearArchive;
$('backup-connect-folder').onclick=connectBackupFolder;$('backup-reconnect-folder').onclick=reconnectBackupFolder;$('backup-now').onclick=()=>runAutomaticBackup('backup manual');$('backup-download').onclick=()=>{const payload=makeBackupPayload();downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),'SBP-Accounting-V19-backup.json');setMessage('backup-message','Backup JSON berhasil diunduh. Simpan juga salinannya di media lain.','good')};
let pendingBackupRestore=null;
 $('backup-file').onchange=async e=>{const f=e.target.files?.[0];pendingBackupRestore=null;$('backup-import-review').hidden=true;if(!f)return;try{const parsed=JSON.parse(await f.text()),candidate=parsed.state||parsed;if(!Array.isArray(candidate.accounts)||!Array.isArray(candidate.journals)||!Array.isArray(candidate.nptrans))throw Error('Struktur backup tidak dikenali atau tidak lengkap.');pendingBackupRestore={fileName:f.name,candidate};$('backup-import-summary').textContent='Backup valid · '+f.name;$('backup-import-detail').textContent='Akun: '+candidate.accounts.length+' · Jurnal: '+candidate.journals.length+' · NPTRANS: '+candidate.nptrans.length+' · Saldo awal: '+(candidate.openingBalances||[]).length+'. Pemulihan mengganti seluruh database lokal.';$('backup-import-review').hidden=false;setMessage('backup-message','File berhasil dibaca. Periksa ringkasan dan setujui pemulihan. Database belum berubah.','good')}catch(err){setMessage('backup-message','Validasi backup gagal: '+err.message,'bad');$('backup-file').value=''}};
 $('backup-import-cancel').onclick=()=>{pendingBackupRestore=null;$('backup-import-review').hidden=true;$('backup-file').value='';setMessage('backup-message','Pemulihan dibatalkan. Database aktif tidak berubah.','good')};
 $('backup-import-confirm').onclick=async()=>{const b=pendingBackupRestore;if(!b)return;if(!requireImportPassword('Pemulihan / Import Backup'))return;if(!confirm('PERINGATAN AKHIR: Ganti seluruh database lokal dengan backup '+b.fileName+'?'))return;try{const candidate=b.candidate,prior=Array.isArray(state.auditLogs)?state.auditLogs:[];state={...emptyState(),...candidate};state.auditLogs=[...new Map([...prior,...(Array.isArray(candidate.auditLogs)?candidate.auditLogs:[])].map(x=>[x.id||JSON.stringify(x),x])).values()].sort((x,y)=>String(y.at).localeCompare(String(x.at)));if(state.npTemplate?.fields)state.npTemplate.fields.forEach(f=>{if(Array.isArray(f.raw))f.raw=new Uint8Array(f.raw)});await persist();pendingBackupRestore=null;$('backup-import-review').hidden=true;$('backup-file').value='';renderDashboard();renderAccounts();renderNptrans();renderJournals();renderOpeningBalances();renderPeriodControl();setMessage('backup-message','Backup '+b.fileName+' berhasil dipulihkan. Database aktif telah diganti.','good');toast('Pemulihan selesai.')}catch(err){setMessage('backup-message','Pemulihan gagal: '+err.message,'bad')}};


async function init(){await loadState();state.auditLogs=Array.isArray(state.auditLogs)?state.auditLogs:[];state.debitNotes=Array.isArray(state.debitNotes)?state.debitNotes:[];state.annualBudgets=Array.isArray(state.annualBudgets)?state.annualBudgets:[];ensurePeriodControl();for(const id of ['ledger-period','report-period','opening-period'])if($(id))$(id).value=state.periodControl.activePeriod;await loadDirectoryHandle();state.accounts=state.accounts.map(a=>({code:String(a.code??'').trim(),name:String(a.name??'')}));syncNptransSandis();auditBaseline=auditClone({accounts:state.accounts,journals:state.journals,nptrans:state.nptrans,openingBalances:state.openingBalances,debitNotes:state.debitNotes,annualBudgets:state.annualBudgets});await persist();resetAccountForm();resetJournalForm();initAnnualBudget();renderDashboard();renderAccounts();renderPeriodControl();resetDebitNoteForm();debitNoteGroupOptions();renderDebitNoteSelectedSources();renderDebitNotes();if(backupDirectoryHandle){const permission=await directoryPermission(backupDirectoryHandle,false);setMessage('backup-message',permission==='granted'?'Folder backup server terhubung. Backup otomatis aktif setiap ada perubahan data.':'Folder backup pernah dihubungkan, tetapi izinnya perlu diaktifkan kembali. Tekan tombol Hubungkan / Aktifkan Ulang.',''+(permission==='granted'?'good':'bad'))}
 const startupNotice=$('startup-backup-notice');if(startupNotice)startupNotice.hidden=false;
 if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(console.warn);setInterval(()=>{if(backupDirectoryHandle&&Date.now()-lastAutoBackupAt>=30*60*1000)runAutomaticBackup('jadwal berkala 30 menit')},60*1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&backupDirectoryHandle&&Date.now()-lastAutoBackupAt>=30*60*1000)runAutomaticBackup('aplikasi aktif kembali')})}
init();

/* BUILD V95 — single click handler for budget help */
(()=>{
 const heading=document.querySelector('#page-journal .journal-budget-heading');
 if(!heading)return;
 const title=heading.querySelector('h3');
 if(!title)return;
 const oldHint=heading.querySelector('p');
 if(oldHint)oldHint.hidden=true;
 let button=document.getElementById('journal-budget-help');
 let popover=document.getElementById('journal-budget-help-popover');
 const wrapper=title.closest('.journal-budget-title-wrap')||title.parentElement;
 if(!button){
  button=document.createElement('button');
  button.type='button';button.id='journal-budget-help';button.className='budget-help-button';
  button.setAttribute('aria-label','Keterangan kontrol anggaran');
  button.setAttribute('aria-expanded','false');
  button.setAttribute('aria-controls','journal-budget-help-popover');
  button.textContent='?';
  title.insertAdjacentElement('afterend',button);
 }
 if(!popover){
  popover=document.createElement('div');
  popover.id='journal-budget-help-popover';popover.className='budget-help-popover';
  popover.hidden=true;
  popover.textContent='Anggaran mengikuti tanggal dan SANDI yang dipilih. Nilai transaksi masih berupa simulasi.';
  wrapper.appendChild(popover);
 }
 if(button.dataset.bound==='1')return;
 button.dataset.bound='1';
 const close=()=>{popover.hidden=true;button.setAttribute('aria-expanded','false')};
 button.addEventListener('click',event=>{
  event.stopPropagation();const opening=popover.hidden;
  popover.hidden=!opening;button.setAttribute('aria-expanded',String(opening));
 });
 document.addEventListener('click',event=>{
  if(!popover.hidden&&!popover.contains(event.target)&&!button.contains(event.target))close();
 });
 document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
})();


/* BUILD V97 — align every help marker directly beside its heading */
(()=>{
 const selectors=[
  '.page .panel-head','.page .section-heading','.page .budget-month-head',
  '.page .budget-hero','.page .import-center-hero','.page .import-center-section-title',
  '.page .accounts-card-title','.page .opening-import-head','.page .validation-hero',
  '.page .debit-note-intro'
 ];
 const closeAll=(except)=>{
  document.querySelectorAll('.sbp-context-help').forEach(pop=>{
   if(pop!==except){
    pop.hidden=true;
    pop.closest('.sbp-title-help-wrap')?.querySelector('.sbp-context-help-button')?.setAttribute('aria-expanded','false');
   }
  });
 };
 document.querySelectorAll(selectors.join(',')).forEach((block,index)=>{
  if(block.dataset.contextHelpReady==='1')return;
  const heading=block.querySelector('h2,h3,h4');
  if(!heading)return;
  const paras=[...block.querySelectorAll('p')].filter(p=>!p.closest('.sbp-context-help'));
  const message=paras.map(p=>p.textContent.trim()).filter(Boolean).join(' ');
  if(!message)return;
  block.dataset.contextHelpReady='1';
  paras.forEach(p=>{p.hidden=true;p.setAttribute('aria-hidden','true')});
  const wrap=document.createElement('span');
  wrap.className='sbp-title-help-wrap';
  heading.parentNode.insertBefore(wrap,heading);
  wrap.appendChild(heading);
  const button=document.createElement('button');
  button.type='button';button.className='budget-help-button sbp-context-help-button';
  button.setAttribute('aria-label','Lihat keterangan bagian');
  button.setAttribute('aria-expanded','false');
  const pop=document.createElement('span');
  pop.className='budget-help-popover sbp-context-help';pop.hidden=true;
  pop.textContent=message;
  const id='sbp-context-help-'+index;
  pop.id=id;button.setAttribute('aria-controls',id);button.textContent='?';
  wrap.appendChild(button);
  wrap.appendChild(pop);
  button.addEventListener('click',event=>{
   event.stopPropagation();
   const opening=pop.hidden;closeAll(pop);pop.hidden=!opening;
   button.setAttribute('aria-expanded',String(opening));
  });
  document.addEventListener('click',event=>{
   if(!pop.hidden&&!pop.contains(event.target)&&!button.contains(event.target)){
    pop.hidden=true;button.setAttribute('aria-expanded','false');
   }
  });
  document.addEventListener('keydown',event=>{
   if(event.key==='Escape'){pop.hidden=true;button.setAttribute('aria-expanded','false')}
  });
 });
})();


/* BUILD V103 — detailed beginner-friendly module learning guides */
(()=>{
 const modal=$('startup-backup-notice');
 if(!modal)return;
 const close=()=>{modal.hidden=true};
 $('startup-continue')?.addEventListener('click',close);
 $('startup-go-backup')?.addEventListener('click',()=>{
  close();go('backup');
  $('backup-connect-folder')?.focus();
 });
 modal.addEventListener('click',event=>{if(event.target===modal)close()});
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!modal.hidden)close();
 });
 if(window.lucide?.createIcons)window.lucide.createIcons();
})();
