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
    if (name === "journal") prepareJournal();
    if (name === "journal-list") loadJournalList();
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
      
  // Journal Maintenance: local SQLite-backed draft and posting workflow.
  let journalAccounts = [];
  let editingJournalId = 0;
  const money = value => "Rp " + Number(value || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });

  async function prepareJournal() {
    try {
      journalAccounts = (await window.sbpDesktop.listAccounts("")).filter(a => Number(a.is_active) === 1);
      if (!document.querySelector("#journal-entry-rows .journal-entry-row")) resetJournalForm();
      else refreshJournalTotals();
    } catch (error) {
      setJournalMessage("Gagal memuat Master Akun: " + error.message, true);
    }
  }

  function accountOptions(selected = "") {
    return '<option value="">Pilih SANDI akun</option>' + journalAccounts.map(a =>
      '<option value="' + escapeHtml(a.sandi) + '"' + (a.sandi === selected ? " selected" : "") + '>' +
      escapeHtml(a.sandi + " — " + a.account_name) + '</option>'
    ).join("");
  }

  function addJournalLine(line = {}) {
    const tr = document.createElement("tr");
    tr.className = "journal-entry-row";
    tr.innerHTML =
      '<td><select class="journal-line-account">' + accountOptions(line.sandi || "") + '</select></td>' +
      '<td class="journal-line-account-name">' + escapeHtml((journalAccounts.find(a => a.sandi === line.sandi) || {}).account_name || "—") + '</td>' +
      '<td><input class="journal-line-note" maxlength="250" placeholder="Keterangan baris" value="' + escapeHtml(line.description || "") + '"></td>' +
      '<td><input class="journal-line-debit amount-input" type="number" min="0" step="0.01" value="' + (line.debit || "") + '" placeholder="0"></td>' +
      '<td><input class="journal-line-credit amount-input" type="number" min="0" step="0.01" value="' + (line.credit || "") + '" placeholder="0"></td>' +
      '<td><button type="button" class="remove-journal-line" title="Hapus baris">×</button></td>';
    tr.querySelector(".journal-line-account").addEventListener("change", event => {
      const a = journalAccounts.find(item => item.sandi === event.target.value);
      tr.querySelector(".journal-line-account-name").textContent = a ? a.account_name : "—";
    });
    tr.querySelectorAll("input").forEach(input => input.addEventListener("input", refreshJournalTotals));
    tr.querySelector(".remove-journal-line").addEventListener("click", () => {
      if (document.querySelectorAll(".journal-entry-row").length <= 2) {
        setJournalMessage("Minimal dua baris jurnal harus tersedia.", true);
        return;
      }
      tr.remove();
      refreshJournalTotals();
    });
    $("journal-entry-rows").appendChild(tr);
    refreshJournalTotals();
  }

  function setJournalMessage(message, isError = false) {
    const el = $("journal-message");
    el.textContent = message;
    el.classList.toggle("error", Boolean(isError));
  }

  function refreshJournalTotals() {
    let debit = 0, credit = 0;
    document.querySelectorAll(".journal-entry-row").forEach(row => {
      debit += Number(row.querySelector(".journal-line-debit").value || 0);
      credit += Number(row.querySelector(".journal-line-credit").value || 0);
    });
    $("journal-total-debit").textContent = money(debit);
    $("journal-total-credit").textContent = money(credit);
    $("journal-total-diff").textContent = money(Math.abs(debit - credit));
    $("journal-total-diff").classList.toggle("balanced", Math.abs(debit - credit) <= 0.005);
    $("journal-total-diff").classList.toggle("unbalanced", Math.abs(debit - credit) > 0.005);
  }

  function resetJournalForm() {
    editingJournalId = 0;
    $("j-date").value = new Date().toISOString().slice(0, 10);
    $("j-number").value = "";
    $("j-description").value = "";
    $("journal-entry-rows").innerHTML = "";
    addJournalLine();
    addJournalLine();
    $("save-journal-draft").textContent = "Simpan Draft";
    $("post-journal").textContent = "Posting Jurnal";
    setJournalMessage("Isi transaksi. Draft boleh belum seimbang; posting wajib seimbang.");
  }

  function collectJournalPayload(status) {
    const lines = Array.from(document.querySelectorAll(".journal-entry-row")).map(row => ({
      sandi: row.querySelector(".journal-line-account").value,
      description: row.querySelector(".journal-line-note").value.trim(),
      debit: Number(row.querySelector(".journal-line-debit").value || 0),
      credit: Number(row.querySelector(".journal-line-credit").value || 0)
    }));
    return {
      id: editingJournalId,
      journal_date: $("j-date").value,
      voucher_number: $("j-number").value.trim(),
      description: $("j-description").value.trim(),
      status,
      lines
    };
  }

  async function saveJournal(status) {
    const payload = collectJournalPayload(status);
    if (!payload.journal_date || !payload.voucher_number || !payload.description) {
      setJournalMessage("Tanggal, nomor bukti, dan keterangan wajib diisi.", true);
      return;
    }
    if (payload.lines.length < 2) {
      setJournalMessage("Jurnal minimal memiliki dua baris.", true);
      return;
    }
    try {
      const result = await window.sbpDesktop.saveJournal(payload);
      setJournalMessage(status === "POSTED" ? "Jurnal berhasil diposting." : "Draft jurnal berhasil disimpan.");
      editingJournalId = 0;
      await refreshSummary();
      resetJournalForm();
      showView("journal-list");
      await loadJournalList();
    } catch (error) {
      setJournalMessage(error.message || "Gagal menyimpan jurnal.", true);
    }
  }

  async function editDraftJournal(id) {
    try {
      const all = await window.sbpDesktop.listJournals({ status: "DRAFT" });
      const item = all.find(j => Number(j.id) === Number(id));
      if (!item) throw new Error("Draft tidak ditemukan.");
      if (item.status !== "DRAFT") throw new Error("Jurnal POSTED tidak dapat diedit.");
      await prepareJournal();
      editingJournalId = Number(item.id);
      $("j-date").value = item.journal_date;
      $("j-number").value = item.voucher_number;
      $("j-description").value = item.description;
      $("journal-entry-rows").innerHTML = "";
      item.lines.forEach(line => addJournalLine(line));
      while (document.querySelectorAll(".journal-entry-row").length < 2) addJournalLine();
      $("save-journal-draft").textContent = "Perbarui Draft";
      $("post-journal").textContent = "Posting Jurnal";
      setJournalMessage("Mengedit draft " + item.voucher_number + ". Jurnal POSTED tidak dapat diubah.");
      showView("journal");
    } catch (error) {
      alert(error.message || "Draft gagal dibuka.");
    }
  }

  async function loadJournalList() {
    const body = $("journal-list-rows");
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" class="empty">Memuat daftar jurnal...</td></tr>';
    try {
      const items = await window.sbpDesktop.listJournals({
        keyword: $("journal-search").value,
        status: $("journal-status").value,
        dateFrom: $("journal-from").value,
        dateTo: $("journal-to").value
      });
      $("journal-list-count").textContent = items.length + " jurnal";
      if (!items.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty">Belum ada jurnal yang cocok dengan filter.</td></tr>';
        return;
      }
      body.innerHTML = items.map(item => {
        const draft = item.status === "DRAFT";
        return '<tr><td>' + escapeHtml(item.journal_date) + '</td>' +
          '<td><b>' + escapeHtml(item.voucher_number) + '</b></td>' +
          '<td>' + escapeHtml(item.description) + '</td>' +
          '<td><span class="status-pill ' + (draft ? "off" : "on") + '">' + (draft ? "DRAFT" : "POSTED") + '</span></td>' +
          '<td class="money-cell">' + money(item.total_debit) + '</td>' +
          '<td class="money-cell">' + money(item.total_credit) + '</td>' +
          '<td><div class="row-actions">' + (draft ? '<button class="small-action" data-journal-action="edit" data-id="' + item.id + '">Edit</button><button class="small-action danger" data-journal-action="delete" data-id="' + item.id + '">Hapus</button>' : '<button class="small-action" data-journal-action="detail" data-id="' + item.id + '">Detail</button>') + '</div></td></tr>';
      }).join("");
    } catch (error) {
      body.innerHTML = '<tr><td colspan="7" class="empty">Gagal memuat jurnal: ' + escapeHtml(error.message) + '</td></tr>';
    }
  }

  $("add-journal-line").addEventListener("click", () => addJournalLine());
  $("reset-journal").addEventListener("click", () => {
    if (confirm("Kosongkan seluruh isian form jurnal?")) resetJournalForm();
  });
  $("save-journal-draft").addEventListener("click", () => saveJournal("DRAFT"));
  $("post-journal").addEventListener("click", () => saveJournal("POSTED"));
  $("new-journal").addEventListener("click", async () => {
    await prepareJournal();
    resetJournalForm();
    showView("journal");
  });
  $("filter-journals").addEventListener("click", loadJournalList);
  $("journal-search").addEventListener("keydown", event => { if (event.key === "Enter") loadJournalList(); });
  $("journal-list-rows").addEventListener("click", async event => {
    const button = event.target.closest("button[data-journal-action]");
    if (!button) return;
    const id = Number(button.dataset.id);
    const action = button.dataset.journalAction;
    if (action === "edit") return editDraftJournal(id);
    if (action === "delete") {
      if (!confirm("Hapus draft jurnal ini?")) return;
      try {
        await window.sbpDesktop.deleteDraftJournal(id);
        await loadJournalList();
        await refreshSummary();
      } catch (error) { alert(error.message || "Draft tidak dapat dihapus."); }
    }
    if (action === "detail") {
      const items = await window.sbpDesktop.listJournals({ status: "POSTED" });
      const item = items.find(j => Number(j.id) === id);
      if (item) alert(item.voucher_number + "\\n" + item.description + "\\n\\nDebit: " + money(item.total_debit) + "\\nKredit: " + money(item.total_credit) + "\\n\\nJurnal POSTED bersifat terkunci.");
    }
  });

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