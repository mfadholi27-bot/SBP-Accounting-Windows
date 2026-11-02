document.addEventListener("DOMContentLoaded", async () => {
  const backupBtn = document.getElementById("backupBtn");
  try {
    const version = await window.sbp.getVersion();
    document.title = `SBP Accounting Windows V20 (${version})`;
  } catch (err) {
    console.error(err);
  }
  backupBtn.addEventListener("click", async () => {
    try {
      const result = await window.sbp.createBackup();
      if (result.canceled) return;
      alert("Backup berhasil disimpan.");
    } catch (err) {
      alert("Backup gagal: " + err.message);
    }
  });
});