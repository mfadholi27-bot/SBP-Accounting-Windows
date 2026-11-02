(()=> {
 const api=window.sbpDesktop;
 if(!api)return;
 const message=(text,type="")=>{const el=document.getElementById("backup-message");if(el){el.textContent=text;el.className="inline-message"+(type?" "+type:"");}};
 const runBackup=async()=>{try{message("Menyiapkan backup lokal Windows...");const r=await api.backup();if(r?.ok)message("Backup Windows berhasil disimpan: "+r.filePath,"success");else if(r?.message)message(r.message,"warning");else message("Backup dibatalkan.");}catch(e){message("Backup gagal: "+e.message,"error");}};
 const runRestore=async()=>{try{const r=await api.restore();if(r?.ok)message("Pemulihan berhasil. Aplikasi dimuat ulang.","success");else if(r?.canceled)message("Pemulihan dibatalkan.");}catch(e){message("Pemulihan gagal: "+e.message,"error");}};
 document.addEventListener("DOMContentLoaded",()=>{
  document.getElementById("backup-now")?.addEventListener("click",runBackup);
  document.getElementById("backup-download")?.addEventListener("click",runBackup);
  document.getElementById("backup-connect-folder")?.addEventListener("click",e=>{e.preventDefault();message("Versi Windows menggunakan backup lokal melalui tombol Backup Sekarang. Folder server browser tidak digunakan agar data desktop tetap terisolasi.");});
  document.getElementById("backup-reconnect-folder")?.addEventListener("click",e=>{e.preventDefault();message("Untuk Windows, gunakan Backup Sekarang atau menu File → Backup Data Windows.");});
  api.onMenuBackup(runBackup);
  api.onMenuRestore(runRestore);
  message("Penyimpanan Windows terpisah dari GitHub. Atur backup lokal sebelum mulai bekerja.");
 });
})();