document.addEventListener("DOMContentLoaded", async () => {
  const backup = document.getElementById("backup");
  try {
    const summary = await window.sbpDesktop.summary();
    document.getElementById("accounts").textContent = summary.accountCount;
    document.getElementById("drafts").textContent = summary.draftCount;
    document.getElementById("posted").textContent = summary.postedCount;
  } catch (error) {
    console.error("Gagal membaca ringkasan database:", error);
  }
  backup.addEventListener("click", async () => {
    try {
      const result = await window.sbpDesktop.backup();
      if (!result.canceled) alert("Backup database berhasil disimpan.");
    } catch (error) {
      alert("Backup gagal: " + error.message);
    }
  });
});