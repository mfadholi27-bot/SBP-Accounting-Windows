document.addEventListener("DOMContentLoaded", async () => {
  const $ = (id) => document.getElementById(id);
  const navButtons = Array.from(document.querySelectorAll(".nav[data-view]"));
  const pageNames = {
    dashboard: "Dashboard",
    journal: "Jurnal Maintenance",
    "journal-list": "Daftar Jurnal",
    "debit-notes": "Nota Debet",
    accounts: "Sandi Perkiraan / Master Akun",
    "opening-balances": "Saldo Awal ACC & Program",
    "annual-budget": "Anggaran Tahunan",
    periods: "Periode Akuntansi",
    ledger: "Buku Besar",
    reports: "Laporan Keuangan",
    "import-center": "Import Center / NPTRANS",
    validation: "Validasi Data",
    "journal-admin": "Journal Admin",
    "print-settings": "Pengaturan Cetak",
    audit: "Audit Log",
    archive: "Arsip Tahunan",
    "archive-reader": "Pembaca Arsip",
    backup: "Backup & Restore"
  };

  function showView(name) {
    document.querySelectorAll(".view").forEach(view => view.classList.remove("active-view"));
    const target = $("view-" + name);
    if (target) target.classList.add("active-view");
    navButtons.forEach(button => button.classList.toggle("active", button.dataset.view === name));
    $("page-title").textContent = pageNames[name] || "Dashboard";
    if (name === "accounts") loadAccounts();
  }

  navButtons.forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));

  async function refreshSummary() {
    try {
      const summary = await window.sbpDesktop.summary();
      $("accounts-count").textContent = summary.accountCount;
      $("drafts").textContent = summary.draftCount;
      $("posted").textContent = summary.postedCount;
    } catch (error) {
      console.error("Gagal membaca ringkasan database:", error);
    }
  }

  $("backup").addEventListener("click", async () => {
    try {
      const result = await window.sbpDesktop.backup();
      if (!result.canceled) alert("Backup database berhasil disimpan.");
    } catch (error) {
      alert("Backup gagal: " + error.message);
    }
  });

  const modal = $("account-modal");
  const form = $("account-form");
  const closeModal = () => { modal.hidden = true; $("account-error").textContent = ""; };
  const openModal = (account = null) => {
    form.reset();
    $("account-id").value = account ? account.id : "";
    $("account-modal-title").textContent = account ? "Edit Akun" : "Tambah Akun";
    $("account-sandi").value = account ? account.sandi : "";
    $("account-name").value = account ? account.account_name : "";
    $("account-type").value = account ? (account.account_type || "") : "";
    $("account-normal").value = account ? (account.normal_balance || "DEBIT") : "DEBIT";
    $("account-error").textContent = "";
    modal.hidden = false;
    $("account-sandi").focus();
  };

  $("add-account").addEventListener("click", () => openModal());
  $("close-modal").addEventListener("click", closeModal);
  $("cancel-modal").addEventListener("click", closeModal);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.hidden) closeModal(); });

  async function loadAccounts() {
    const body = $("account-rows");
    body.innerHTML = '<tr><td colspan="6" class="empty">Memuat data akun...</td></tr>';
    try {
      const accounts = await window.sbpDesktop.listAccounts($("account-search").value);
      $("account-total").textContent = accounts.length + " akun";
      if (!accounts.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty">Belum ada akun. Klik Tambah Akun untuk mulai mengisi Master Akun.</td></tr>';
        return;
      }
      body.innerHTML = accounts.map(account => {
        const status = Number(account.is_active) === 1;
        return '<tr><td><b>' + escapeHtml(account.sandi) + '</b></td>' +
          '<td>' + escapeHtml(account.account_name) + '</td>' +
          '<td>' + escapeHtml(account.account_type || "—") + '</td>' +
          '<td>' + escapeHtml(account.normal_balance || "—") + '</td>' +
          '<td><span class="status-pill ' + (status ? "on" : "off") + '">' + (status ? "AKTIF" : "NONAKTIF") + '</span></td>' +
          '<td><div class="row-actions"><button class="small-action" data-action="edit" data-id="' + account.id + '">Edit</button>' +
          '<button class="small-action" data-action="toggle" data-id="' + account.id + '" data-active="' + (status ? "0" : "1") + '">' + (status ? "Nonaktifkan" : "Aktifkan") + '</button>' +
          '<button class="small-action danger" data-action="delete" data-id="' + account.id + '">Hapus</button></div></td></tr>';
      }).join("");
    } catch (error) {
      body.innerHTML = '<tr><td colspan="6" class="empty">Gagal memuat akun: ' + escapeHtml(error.message) + '</td></tr>';
    }
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  $("account-search").addEventListener("input", loadAccounts);
  $("account-rows").addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.action;
    try {
      if (action === "edit") {
        const account = (await window.sbpDesktop.listAccounts("")).find(item => Number(item.id) === id);
        if (account) openModal(account);
      } else if (action === "toggle") {
        const active = button.dataset.active === "1";
        if (!confirm((active ? "Aktifkan" : "Nonaktifkan") + " akun ini?")) return;
        await window.sbpDesktop.setAccountActive({ id, active });
        await loadAccounts();
        await refreshSummary();
      } else if (action === "delete") {
        if (!confirm("Hapus akun ini secara permanen? Tindakan ini tidak dapat dibatalkan.")) return;
        await window.sbpDesktop.deleteAccount(id);
        await loadAccounts();
        await refreshSummary();
      }
    } catch (error) {
      alert(error.message || "Tindakan gagal.");
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    $("account-error").textContent = "";
    const payload = {
      id: Number($("account-id").value || 0),
      sandi: $("account-sandi").value,
      account_name: $("account-name").value,
      account_type: $("account-type").value,
      normal_balance: $("account-normal").value
    };
    try {
      await window.sbpDesktop.saveAccount(payload);
      closeModal();
      await loadAccounts();
      await refreshSummary();
    } catch (error) {
      $("account-error").textContent = error.message || "Gagal menyimpan akun.";
    }
  });

  await refreshSummary();
});