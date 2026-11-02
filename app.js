document.addEventListener("DOMContentLoaded", async () => {
  const backupBtn = document.getElementById("backupBtn");

  // GitHub Pages is an informational preview, not the installed desktop app.
  // Native database and backup functions are available only inside Electron.
  if (!window.sbp || typeof window.sbp.createBackup !== "function") {
    if (backupBtn) {
      backupBtn.disabled = true;
      backupBtn.textContent = "Backup tersedia di aplikasi Windows";
      backupBtn.title = "Halaman web ini hanya pratinjau. Jalankan aplikasi desktop untuk membuat backup lokal.";
    }
    const status = document.querySelector(".sidebar-bottom");
    if (status) status.innerHTML = "PRATINJAU WEB <span class='status-dot'></span>";
    return;
  }

  try {
    const version = await window.sbp.getVersion();
    document.title = `SBP Accounting Windows V20 (${version})`;
  } catch (error) {
    console.error(error);
  }

  if (backupBtn) {
    backupBtn.addEventListener("click", async () => {
      try {
        const result = await window.sbp.createBackup();
        if (!result.canceled) alert("Backup berhasil disimpan.");
      } catch (error) {
        alert("Backup gagal: " + error.message);
      }
    });
  }
});
