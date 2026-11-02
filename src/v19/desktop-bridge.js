(()=> {
 const api=window.sbpDesktop;
 if(!api)return;
 const message=(text,type="")=>{const el=document.getElementById("backup-message");if(el){el.textContent=text;el.className="inline-message"+(type?" "+type:"");}};
 const runBackup=async()=>{try{message("Menyiapkan backup lokal Windows...");const r=await api.backup();if(r?.ok)message("Backup Windows berhasil disimpan: "+r.filePath,"success");else if(r?.message)message(r.message,"warning");else message("Backup dibatalkan.");}catch(e){message("Backup gagal: "+e.message,"error");}};
 const runRestore=async()=>{try{const r=await api.restore();if(r?.ok)message("Pemulihan berhasil. Aplikasi dimuat ulang.","success");else if(r?.canceled)message("Pemulihan dibatalkan.");}catch(e){message("Pemulihan gagal: "+e.message,"error");}};
 document.addEventListener("DOMContentLoaded",()=>{
  for(const id of ["backup-now","backup-download"]){document.getElementById(id)?.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();runBackup();},true);}
  for(const id of ["backup-connect-folder","backup-reconnect-folder"]){document.getElementById(id)?.addEventListener("click",e=>{e.preventDefault();e.stopImmediatePropagation();message("Versi Windows menggunakan backup lokal. Folder server browser tidak digunakan agar penyimpanan desktop tetap terisolasi.");},true);}
  api.onMenuBackup(runBackup);
  api.onMenuRestore(runRestore);
  message("Penyimpanan Windows terpisah dari GitHub. Backup lokal otomatis saat aplikasi ditutup; gunakan Backup Sekarang untuk salinan manual.");
 });
})();