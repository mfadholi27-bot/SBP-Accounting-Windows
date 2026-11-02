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
    if (name === "annual-budget") loadAnnualBudgets();
    if (name === "opening-balances") loadOpeningBalances();
    if (name === "import-center") refreshNptransRows();
    if (["debit-notes","periods","ledger","reports","validation","journal-admin","print-settings","audit","archive","archive-reader","backup"].includes(name)) loadAdminModules();
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
      refreshJournalBudgetPreview();
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


  const budgetMonthNames = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  let budgetRowsCache = [];
  let editingBudgetSandi = "";

  async function loadBudgetAccounts() {
    const accounts = (await window.sbpDesktop.listAccounts("")).filter(a => Number(a.is_active) === 1);
    $("budget-account").innerHTML = '<option value="">Pilih SANDI akun</option>' + accounts.map(a =>
      '<option value="' + escapeHtml(a.sandi) + '">' + escapeHtml(a.sandi + " — " + a.account_name) + '</option>'
    ).join("");
    $("budget-account").onchange = () => {
      const account = accounts.find(a => a.sandi === $("budget-account").value);
      $("budget-account-name").value = account ? account.account_name : "";
    };
  }

  function renderBudgetMonthInputs(values = Array(12).fill(0)) {
    $("budget-month-grid").innerHTML = budgetMonthNames.map((month,index) =>
      '<label>' + month + '<input class="budget-month-input" type="number" min="0" step="1" value="' +
      Number(values[index] || 0) + '" data-month="' + (index+1) + '"></label>'
    ).join("");
    document.querySelectorAll(".budget-month-input").forEach(input => input.addEventListener("input", validateBudgetForm));
    validateBudgetForm();
  }

  function currentBudgetMonths() {
    return Array.from(document.querySelectorAll(".budget-month-input")).map(input => Number(input.value || 0));
  }

  function validateBudgetForm() {
    const annual = Number($("budget-annual").value || 0);
    const monthly = currentBudgetMonths();
    const sum = monthly.reduce((a,b)=>a+b,0);
    const valid = Boolean($("budget-account").value) && Number.isInteger(Number($("budget-year").value)) &&
      Number($("budget-year").value) >= 2000 && Number($("budget-year").value) <= 2100 &&
      annual > 0 && monthly.every(x => Number.isFinite(x) && x >= 0) && Math.abs(sum-annual) <= 0.005;
    $("budget-validation").textContent = "Total distribusi: " + money(sum) + " · Anggaran tahunan: " + money(annual) +
      " · " + (valid ? "SEIMBANG — siap disimpan" : "Belum seimbang atau data belum lengkap");
    $("budget-validation").classList.toggle("good", valid);
    $("budget-validation").classList.toggle("warn", !valid);
    $("budget-save").disabled = !valid;
    return valid;
  }

  function resetBudgetForm() {
    editingBudgetSandi = "";
    $("budget-year").value = new Date().getFullYear();
    $("budget-account").disabled = false;
    $("budget-account").value = "";
    $("budget-account-name").value = "";
    $("budget-annual").value = "";
    $("budget-form-title").textContent = "Buat Anggaran Akun";
    $("budget-save").textContent = "Simpan Anggaran";
    renderBudgetMonthInputs();
  }

  async function loadAnnualBudgets() {
    try {
      await loadBudgetAccounts();
      const year = Number($("budget-filter-year").value || new Date().getFullYear());
      const years = [year, new Date().getFullYear(), new Date().getFullYear()+1];
      $("budget-filter-year").innerHTML = Array.from(new Set(years)).sort((a,b)=>b-a).map(y =>
        '<option value="' + y + '"' + (y===year ? " selected" : "") + '>' + y + '</option>'
      ).join("");
      budgetRowsCache = await window.sbpDesktop.listBudgets(year);
      renderAnnualBudgetRows();
      if (!$("budget-month-grid").children.length) resetBudgetForm();
    } catch(error) {
      $("budget-rows").innerHTML = '<tr><td colspan="7" class="empty">Gagal memuat anggaran: ' + escapeHtml(error.message) + '</td></tr>';
    }
  }

  function renderAnnualBudgetRows() {
    const query = $("budget-search").value.trim().toLowerCase();
    const items = budgetRowsCache.filter(item => (item.sandi + " " + item.account_name).toLowerCase().includes(query));
    const totalBudget = items.reduce((sum,item)=>sum+item.annual,0);
    const totalActual = items.reduce((sum,item)=>sum+item.actual,0);
    $("budget-total-annual").textContent = money(totalBudget);
    $("budget-total-actual").textContent = money(totalActual);
    $("budget-total-remaining").textContent = money(totalBudget-totalActual);
    $("budget-total-percent").textContent = (totalBudget ? (totalActual/totalBudget*100).toFixed(1) : "0.0") + "%";
    $("budget-rows").innerHTML = items.length ? items.map(item => {
      const pct = item.annual ? item.actual/item.annual*100 : 0;
      return '<tr><td><b>' + escapeHtml(item.sandi) + '</b></td><td>' + escapeHtml(item.account_name) +
        '</td><td class="money-cell">' + money(item.annual) + '</td><td class="money-cell">' + money(item.actual) +
        '</td><td class="money-cell ' + (item.remaining<0 ? "budget-negative" : "budget-positive") + '">' + money(item.remaining) +
        '</td><td>' + pct.toFixed(1) + '%</td><td><div class="row-actions"><button class="small-action" data-budget-action="edit" data-sandi="' +
        escapeHtml(item.sandi) + '">Edit</button><button class="small-action danger" data-budget-action="delete" data-sandi="' +
        escapeHtml(item.sandi) + '">Hapus</button></div></td></tr>';
    }).join("") : '<tr><td colspan="7" class="empty">Belum ada anggaran pada tahun ini.</td></tr>';
  }

  function editAnnualBudget(sandi) {
    const item = budgetRowsCache.find(x => x.sandi === sandi);
    if (!item) return;
    editingBudgetSandi = sandi;
    $("budget-year").value = item.fiscal_year;
    $("budget-account").value = sandi;
    $("budget-account").disabled = true;
    $("budget-account-name").value = item.account_name;
    $("budget-annual").value = item.annual;
    $("budget-form-title").textContent = "Edit Anggaran " + sandi;
    $("budget-save").textContent = "Simpan Perubahan";
    renderBudgetMonthInputs(item.monthly);
  }

  async function saveAnnualBudget() {
    if (!validateBudgetForm()) return;
    try {
      const payload = { fiscal_year:Number($("budget-year").value), sandi:$("budget-account").value, monthly:currentBudgetMonths() };
      await window.sbpDesktop.saveBudget(payload);
      alert("Anggaran tahunan berhasil disimpan.");
      resetBudgetForm();
      await loadAnnualBudgets();
      refreshJournalBudgetPreview();
    } catch(error) { alert("Anggaran gagal disimpan: " + error.message); }
  }

  $("budget-annual").addEventListener("input", validateBudgetForm);
  $("budget-year").addEventListener("input", validateBudgetForm);
  $("budget-distribute").addEventListener("click", () => {
    const annual = Number($("budget-annual").value || 0);
    if (!(annual > 0)) { alert("Isi total anggaran tahunan terlebih dahulu."); return; }
    const base = Math.floor(annual/12);
    const remainder = Math.round((annual-base*12)*100)/100;
    renderBudgetMonthInputs(Array.from({length:12},(_,i)=>base+(i===11?remainder:0)));
  });
  $("budget-reset").addEventListener("click", resetBudgetForm);
  $("budget-save").addEventListener("click", saveAnnualBudget);
  $("budget-filter-year").addEventListener("change", loadAnnualBudgets);
  $("budget-search").addEventListener("input", renderAnnualBudgetRows);
  $("budget-rows").addEventListener("click", async event => {
    const button = event.target.closest("button[data-budget-action]");
    if (!button) return;
    const sandi = button.dataset.sandi;
    if (button.dataset.budgetAction === "edit") return editAnnualBudget(sandi);
    if (button.dataset.budgetAction === "delete" && confirm("Hapus anggaran SANDI " + sandi + "?")) {
      try {
        await window.sbpDesktop.deleteBudget({fiscal_year:Number($("budget-filter-year").value),sandi});
        await loadAnnualBudgets();
        refreshJournalBudgetPreview();
      } catch(error) { alert(error.message); }
    }
  });

  async function refreshJournalBudgetPreview() {
    const host = $("journal-budget-content");
    if (!host || !$("j-date").value) return;
    const date = $("j-date").value;
    const year = Number(date.slice(0,4)), month = Number(date.slice(5,7));
    if (!year || !month) { host.innerHTML = '<div class="budget-empty">Tanggal jurnal belum valid.</div>'; return; }
    try {
      const budgets = await window.sbpDesktop.listBudgets(year);
      const draftBySandi = new Map();
      document.querySelectorAll(".journal-entry-row").forEach(row => {
        const sandi = row.querySelector(".journal-line-account").value;
        if (!sandi) return;
        const net = Number(row.querySelector(".journal-line-debit").value || 0) -
          Number(row.querySelector(".journal-line-credit").value || 0);
        draftBySandi.set(sandi,(draftBySandi.get(sandi)||0)+net);
      });
      const selected = budgets.filter(item => draftBySandi.has(item.sandi));
      if (!selected.length) {
        host.innerHTML = '<div class="budget-empty">Belum ada SANDI terpilih yang memiliki anggaran ' +
          budgetMonthNames[month-1] + ' ' + year + '.</div>';
        return;
      }
      host.innerHTML = '<div class="journal-budget-grid">' + selected.map(item => {
        const limit = Number(item.monthly[month-1] || 0);
        const actual = Number(item.actualByMonth[month-1] || 0);
        const input = Number(draftBySandi.get(item.sandi) || 0);
        const remain = limit - actual - input;
        const usage = limit ? (actual+input)/limit*100 : 0;
        const level = remain < 0 ? "over" : usage >= 80 ? "warn" : "safe";
        const label = level === "over" ? "Melebihi anggaran" : level === "warn" ? "Mendekati batas" : "Aman";
        return '<article class="journal-budget-card ' + level + '"><div class="journal-budget-card-top"><div><b>' +
          escapeHtml(item.sandi) + '</b><span>' + escapeHtml(item.account_name) + '</span></div><em class="budget-state ' +
          level + '">' + label + '</em></div><div class="journal-budget-metrics"><div><small>Anggaran bulan ini</small><strong>' +
          money(limit) + '</strong></div><div><small>Realisasi POSTED</small><strong>' + money(actual) +
          '</strong></div><div><small>Input saat ini</small><strong>' + money(input) +
          '</strong></div><div class="remaining"><small>Sisa setelah input</small><strong>' + money(remain) +
          '</strong></div></div><div class="budget-progress"><span style="width:' + Math.max(0,Math.min(100,usage)) +
          '%"></span></div><small class="budget-usage">Penggunaan termasuk input: ' + usage.toFixed(1).replace(".",",") +
          '%</small></article>';
      }).join("") + '</div><div class="budget-footnote">Simulasi belum mengubah anggaran. Realisasi hanya dari jurnal POSTED; kredit pada SANDI yang sama mengurangi realisasi bersih.</div>';
    } catch(error) {
      host.innerHTML = '<div class="budget-empty">Gagal menghitung preview anggaran: ' + escapeHtml(error.message) + '</div>';
    }
  }

  $("j-date").addEventListener("change", refreshJournalBudgetPreview);

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
    refreshJournalBudgetPreview();
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



  // Integrated A/B/C module controllers.
  function adminOptions(selected=""){return '<option value="">Pilih SANDI</option>'+journalAccounts.map(a=>'<option value="'+escapeHtml(a.sandi)+'" '+(a.sandi===selected?'selected':'')+'>'+escapeHtml(a.sandi+" — "+a.account_name)+'</option>').join("");}
  async function refreshPeriods(){
    const list=await window.sbpDesktop.listPeriods();
    $("period-rows").innerHTML=list.length?list.map(x=>'<tr><td>'+escapeHtml(x.period_key)+'</td><td><span class="status-pill '+(x.status==="CLOSED"?"off":"on")+'">'+x.status+'</span></td><td>'+escapeHtml(x.opened_at||"—")+'</td><td>'+escapeHtml(x.closed_at||"—")+'</td><td>'+(x.status==="CLOSED"?'<button class="small-action" data-reopen="'+escapeHtml(x.period_key)+'">Buka Kembali</button>':'Aktif')+'</td></tr>').join(""):'<tr><td colspan="5" class="empty">Belum ada periode.</td></tr>';
  }
  $("period-open").addEventListener("click",async()=>{try{await window.sbpDesktop.openPeriod({period_key:$("period-key").value});$("period-message").textContent="Periode dibuka/diaktifkan.";$("period-message").className="import-message success";await refreshPeriods();}catch(e){$("period-message").textContent=e.message;}});
  $("period-close").addEventListener("click",async()=>{try{const r=await window.sbpDesktop.closePeriod({period_key:$("period-key").value,note:$("period-note").value});$("period-message").textContent="Periode ditutup. Jurnal POSTED: "+r.snapshot.postedJournalCount+"."; $("period-message").className="import-message success";await refreshPeriods();}catch(e){$("period-message").textContent=e.message;$("period-message").className="import-message error";}});
  $("period-rows").addEventListener("click",async e=>{const b=e.target.closest("[data-reopen]");if(!b)return;const reason=prompt("Alasan membuka kembali periode "+b.dataset.reopen+"?");if(!reason)return;try{await window.sbpDesktop.reopenPeriod({period_key:b.dataset.reopen,reason});await refreshPeriods();}catch(err){alert(err.message);}});
  async function fillAdminAccounts(){
    journalAccounts=await window.sbpDesktop.listAccounts("");
    $("ledger-account").innerHTML=adminOptions();
  }
  $("ledger-run").addEventListener("click",async()=>{
    try{const list=await window.sbpDesktop.ledgerReport({sandi:$("ledger-account").value,date_from:$("ledger-from").value,date_to:$("ledger-to").value});
      $("ledger-rows").innerHTML=list.length?list.map(x=>'<tr><td>'+escapeHtml(x.journal_date)+'</td><td>'+escapeHtml(x.voucher_number)+'</td><td>'+escapeHtml(x.line_description||x.journal_description)+'</td><td>'+money(x.debit)+'</td><td>'+money(x.credit)+'</td><td>'+money(x.running_balance)+'</td></tr>').join(""):'<tr><td colspan="6" class="empty">Tidak ada transaksi POSTED pada rentang ini.</td></tr>';
      $("ledger-message").textContent=list.length+" transaksi POSTED ditampilkan.";
    }catch(e){$("ledger-message").textContent=e.message;}
  });
$("ledger-export").addEventListener("click",()=>{const rows=Array.from($("ledger-rows").querySelectorAll("tr")).map(tr=>Array.from(tr.children).map(td=>td.textContent));if(!rows.length||rows[0].length!==6){alert("Tampilkan Buku Besar terlebih dahulu.");return;}const csv=[["Tanggal","Nomor Bukti","Keterangan","Debit","Kredit","Saldo"],...rows].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(",")).join("\\r\\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="Buku-Besar-"+$("ledger-account").value+".csv";a.click();URL.revokeObjectURL(url);});
  $("ledger-print").addEventListener("click",()=>window.print());
  $("report-trial-run").addEventListener("click",async()=>{
    try{const list=await window.sbpDesktop.trialBalance({period_key:$("report-period").value});
      let debit=0,credit=0;
      $("trial-balance-rows").innerHTML=list.map(x=>{
        const net=Number(x.net_balance||0),endD=Math.max(0,net),endC=Math.max(0,-net);
        debit+=endD;credit+=endC;
        return '<tr><td>'+escapeHtml(x.sandi)+'</td><td>'+escapeHtml(x.account_name)+'</td><td>'+money(x.opening_debit)+'</td><td>'+money(x.opening_credit)+'</td><td>'+money(x.movement_debit)+'</td><td>'+money(x.movement_credit)+'</td><td>'+money(endD)+'</td><td>'+money(endC)+'</td></tr>';
      }).join("");
      $("report-summary").textContent="Total saldo akhir debit "+money(debit)+" · kredit "+money(credit)+" · selisih "+money(debit-credit)+". "+(Math.abs(debit-credit)<0.005?"SEIMBANG":"BELUM SEIMBANG");
      $("report-summary").className="import-message "+(Math.abs(debit-credit)<0.005?"success":"error");
    }catch(e){$("report-summary").textContent=e.message;}
  });

  function renderReportTable(headers,rowsHtml){$("report-table-head").innerHTML="<tr>"+headers.map(x=>"<th>"+escapeHtml(x)+"</th>").join("")+"</tr>";$("trial-balance-rows").innerHTML=rowsHtml;}
  $("report-income-run").addEventListener("click",async()=>{
    try{const p=$("report-period").value,from=p+"-01",last=new Date(Number(p.slice(0,4)),Number(p.slice(5,7)),0).getDate(),to=p+"-"+String(last).padStart(2,"0");
      const r=await window.sbpDesktop.incomeStatement({date_from:from,date_to:to});
      renderReportTable(["SANDI","Nama Akun","Jenis","Debit","Kredit","Saldo Laporan"],r.rows.map(x=>"<tr><td>"+escapeHtml(x.sandi)+"</td><td>"+escapeHtml(x.account_name)+"</td><td>"+escapeHtml(x.account_type)+"</td><td>"+money(x.debit)+"</td><td>"+money(x.credit)+"</td><td>"+money(x.net)+"</td></tr>").join(""));
      $("report-summary").textContent="Pendapatan "+money(r.revenue)+" · Beban "+money(r.expense)+" · Laba/(Rugi) "+money(r.netProfit)+". Periode "+from+" s.d. "+to;
      $("report-summary").className="import-message "+(r.netProfit>=0?"success":"error");
    }catch(e){$("report-summary").textContent=e.message;}
  });
  $("report-balance-run").addEventListener("click",async()=>{
    try{const p=$("report-period").value,last=new Date(Number(p.slice(0,4)),Number(p.slice(5,7)),0).getDate(),asOf=p+"-"+String(last).padStart(2,"0");
      const r=await window.sbpDesktop.balanceSheet({as_of:asOf});
      renderReportTable(["SANDI","Nama Akun","Kelompok","Saldo Posisi"],r.rows.map(x=>"<tr><td>"+escapeHtml(x.sandi)+"</td><td>"+escapeHtml(x.account_name)+"</td><td>"+escapeHtml(x.account_type)+"</td><td>"+money(x.display_balance)+"</td></tr>").join(""));
      $("report-summary").textContent="Posisi "+asOf+" · Aset "+money(r.assets)+" · Kewajiban "+money(r.liabilities)+" · Ekuitas "+money(r.equity)+" · Selisih "+money(r.difference)+(Math.abs(r.difference)<0.005?" · SEIMBANG":" · PERLU REKONSILIASI");
      $("report-summary").className="import-message "+(Math.abs(r.difference)<0.005?"success":"error");
    }catch(e){$("report-summary").textContent=e.message;}
  });
  $("audit-export").addEventListener("click",async()=>{try{const r=await window.sbpDesktop.exportAudit();$("audit-rows").dataset.exportMessage=r.canceled?"Ekspor dibatalkan.":"CSV audit diekspor: "+r.count+" baris.";}catch(e){alert(e.message);}});

  $("report-print").addEventListener("click",()=>window.print());
  $("validation-run").addEventListener("click",async()=>{
    try{const issues=await window.sbpDesktop.runValidation();
      $("validation-summary").textContent=issues.length?issues.length+" temuan ditemukan.":"Tidak ada temuan pada pemeriksaan yang tersedia.";
      $("validation-summary").className="import-message "+(issues.some(x=>x.severity==="ERROR")?"error":"success");
      $("validation-rows").innerHTML=issues.length?issues.map(x=>'<tr><td>'+escapeHtml(x.severity)+'</td><td>'+escapeHtml(x.code)+'</td><td>'+escapeHtml(x.detail)+'</td></tr>').join(""):'<tr><td colspan="3" class="empty">Semua pemeriksaan lulus.</td></tr>';
    }catch(e){$("validation-summary").textContent=e.message;}
  });
  async function refreshAudit(){
    const list=await window.sbpDesktop.listAudit({limit:500});
    $("audit-rows").innerHTML=list.length?list.map(x=>'<tr><td>'+escapeHtml(x.occurred_at)+'</td><td>'+escapeHtml(x.action)+'</td><td>'+escapeHtml(x.entity_type)+'</td><td>'+escapeHtml(x.entity_id)+'</td><td>'+escapeHtml(x.summary)+'</td></tr>').join(""):'<tr><td colspan="5" class="empty">Belum ada catatan audit.</td></tr>';
  }
  $("audit-refresh").addEventListener("click",refreshAudit);
  $("admin-reverse").addEventListener("click",async()=>{
    try{const r=await window.sbpDesktop.reverseJournal({id:Number($("admin-journal-id").value),voucher_number:$("admin-reversal-voucher").value,journal_date:$("admin-reversal-date").value,reason:$("admin-reversal-reason").value});
      $("admin-message").textContent="Jurnal pembalik POSTED berhasil dibuat. ID "+r.id+".";
      $("admin-message").className="import-message success";
      await refreshSummary();
    }catch(e){$("admin-message").textContent=e.message;$("admin-message").className="import-message error";}
  });
  $("admin-correction-date").value=new Date().toISOString().slice(0,10);
  $("admin-correction-create").addEventListener("click",async()=>{
    try{const r=await window.sbpDesktop.createCorrectionDraft({id:Number($("admin-correction-id").value),voucher_number:$("admin-correction-voucher").value,journal_date:$("admin-correction-date").value});
      $("admin-correction-message").textContent="Draft koreksi dibuat dengan ID "+r.id+". Buka Jurnal Maintenance untuk memeriksa dan menyelesaikannya.";
      $("admin-correction-message").className="import-message success";await refreshSummary();
    }catch(e){$("admin-correction-message").textContent=e.message;$("admin-correction-message").className="import-message error";}
  });
  let debitNoteLines=[];
  let editingDebitNoteId=0;
  function renderDebitNoteLines(){
    $("dn-lines").innerHTML=debitNoteLines.map((x,i)=>'<tr><td><select data-dn-account="'+i+'">'+adminOptions(x.sandi)+'</select></td><td><input data-dn-description="'+i+'" value="'+escapeHtml(x.description||"")+'"></td><td><input type="number" min="0" step="0.01" data-dn-debit="'+i+'" value="'+(x.debit||"")+'"></td><td><input type="number" min="0" step="0.01" data-dn-credit="'+i+'" value="'+(x.credit||"")+'"></td><td><button class="small-action danger" data-dn-remove="'+i+'">Hapus</button></td></tr>').join("");
  }
  function addDebitNoteLine(){debitNoteLines.push({sandi:"",description:"",debit:0,credit:0});renderDebitNoteLines();}
  $("dn-add-line").addEventListener("click",addDebitNoteLine);
  $("dn-new").addEventListener("click",()=>{editingDebitNoteId=0;$("dn-number").value="";$("dn-date").value=new Date().toISOString().slice(0,10);$("dn-partner").value="";$("dn-type").value="";$("dn-invoice").value="";$("dn-description").value="";debitNoteLines=[];addDebitNoteLine();addDebitNoteLine();});
  $("dn-lines").addEventListener("input",e=>{const el=e.target,idx=Number(el.dataset.dnDescription??el.dataset.dnDebit??el.dataset.dnCredit);if(!Number.isInteger(idx)||!debitNoteLines[idx])return;if(el.dataset.dnDescription!==undefined)debitNoteLines[idx].description=el.value;if(el.dataset.dnDebit!==undefined)debitNoteLines[idx].debit=Number(el.value||0);if(el.dataset.dnCredit!==undefined)debitNoteLines[idx].credit=Number(el.value||0);});
  $("dn-lines").addEventListener("change",e=>{if(e.target.dataset.dnAccount!==undefined)debitNoteLines[Number(e.target.dataset.dnAccount)].sandi=e.target.value;});
  $("dn-lines").addEventListener("click",e=>{const b=e.target.closest("[data-dn-remove]");if(!b)return;debitNoteLines.splice(Number(b.dataset.dnRemove),1);renderDebitNoteLines();});
  async function refreshDebitNotes(){
    const list=await window.sbpDesktop.listDebitNotes({});
    $("dn-list").innerHTML=list.length?list.map(x=>'<tr><td>'+escapeHtml(x.note_number)+'</td><td>'+escapeHtml(x.note_date)+'</td><td>'+escapeHtml(x.partner_name)+'</td><td>'+escapeHtml(x.description)+'</td><td>'+escapeHtml(x.status)+'</td><td>'+(x.status==="DRAFT"?'<button class="small-action" data-dn-edit="'+x.id+'">Edit</button> <button class="small-action" data-dn-post="'+x.id+'">Posting</button> <button class="small-action danger" data-dn-cancel="'+x.id+'">Batal</button>':'—')+'</td></tr>').join(""):'<tr><td colspan="6" class="empty">Belum ada nota debet.</td></tr>';
  }
  $("dn-save").addEventListener("click",async()=>{
    try{const r=await window.sbpDesktop.saveDebitNote({id:editingDebitNoteId,note_number:$("dn-number").value,note_date:$("dn-date").value,note_type:$("dn-type").value,partner_name:$("dn-partner").value,invoice_reference:$("dn-invoice").value,description:$("dn-description").value,lines:debitNoteLines});
      editingDebitNoteId=r.id;$("dn-message").textContent="Draft nota debet tersimpan (ID "+r.id+").";$("dn-message").className="import-message success";await refreshDebitNotes();
    }catch(e){$("dn-message").textContent=e.message;$("dn-message").className="import-message error";}
  });
  $("dn-list").addEventListener("click",async e=>{
    const post=e.target.closest("[data-dn-post]"),cancel=e.target.closest("[data-dn-cancel]"),edit=e.target.closest("[data-dn-edit]");
    try{if(edit){const item=(await window.sbpDesktop.listDebitNotes({})).find(x=>Number(x.id)===Number(edit.dataset.dnEdit));if(!item)return;editingDebitNoteId=item.id;$("dn-number").value=item.note_number;$("dn-date").value=item.note_date;$("dn-partner").value=item.partner_name;$("dn-type").value=item.note_type||"";$("dn-invoice").value=item.invoice_reference||"";$("dn-description").value=item.description;debitNoteLines=item.lines.map(x=>({sandi:x.sandi,description:x.description||"",debit:Number(x.debit||0),credit:Number(x.credit||0)}));renderDebitNoteLines();$("dn-message").textContent="Mengedit draft nota "+item.note_number;}else if(post){await window.sbpDesktop.postDebitNote(Number(post.dataset.dnPost));}else if(cancel){const reason=prompt("Alasan pembatalan nota?");if(!reason)return;await window.sbpDesktop.cancelDebitNote({id:Number(cancel.dataset.dnCancel),reason});if(editingDebitNoteId===Number(cancel.dataset.dnCancel))editingDebitNoteId=0;}else return;await refreshDebitNotes();await refreshSummary();}
    catch(err){alert(err.message);}
  });
  async function refreshPrintSettings(){
    const s=Object.fromEntries((await window.sbpDesktop.getPrintSettings()).map(x=>[x.setting_key,x.setting_value]));
    $("print-paper").value=s.paper||"F4";$("print-orientation").value=s.orientation||"Auto";$("print-company").value=s.company||"";$("print-header").value=s.header||"";
    $("print-signature").checked=s.signature!=="false";$("print-summary").checked=s.summary!=="false";$("print-page-number").checked=s.page_number!=="false";
    let printStyle=document.getElementById("sbp-print-page-style");
    if(!printStyle){printStyle=document.createElement("style");printStyle.id="sbp-print-page-style";document.head.appendChild(printStyle);}
    const orientation=String(s.orientation||"Auto").toLowerCase();
    const paper=String(s.paper||"F4").toUpperCase();
    let dimensions=paper==="A4"?[210,297]:paper==="LETTER"?[216,279]:[210,330];
    if(orientation==="landscape")dimensions.reverse();
    const pageSize=dimensions[0]+"mm "+dimensions[1]+"mm";
    const printHead=[s.company,s.header].filter(Boolean).join(" · ");
    const signature=s.signature==="false"?"":" body::after { content: 'Mengetahui,\\\\A\\\\A\\\\A(____________________)'; white-space:pre; display:block; text-align:right; margin-top:28px; }";
    const pageNo=s.page_number==="false"?"":" @page { @bottom-right { content: counter(page); } }";
    printStyle.textContent="@media print { @page { size: "+pageSize+"; margin: 12mm; } body::before { content: "+JSON.stringify(printHead)+"; display:block; font-weight:700; text-align:center; margin-bottom:10px; }"+signature+pageNo+" }";
  }
  $("print-save").addEventListener("click",async()=>{
    try{await window.sbpDesktop.savePrintSettings({paper:$("print-paper").value,orientation:$("print-orientation").value,company:$("print-company").value,header:$("print-header").value,signature:String($("print-signature").checked),summary:String($("print-summary").checked),page_number:String($("print-page-number").checked)});
      $("print-message").textContent="Pengaturan cetak disimpan.";$("print-message").className="import-message success";
    }catch(e){$("print-message").textContent=e.message;}
  });
  $("print-preview").addEventListener("click",()=>window.print());
  async function refreshArchives(){
    const list=await window.sbpDesktop.listArchives();
    $("archive-rows").innerHTML=list.length?list.map(x=>'<tr><td>'+escapeHtml(x.archive_name)+'</td><td>'+escapeHtml(x.period_start)+' – '+escapeHtml(x.period_end)+'</td><td>'+escapeHtml(x.created_at)+'</td><td>'+escapeHtml(x.record_count)+'</td></tr>').join(""):'<tr><td colspan="4" class="empty">Belum ada arsip.</td></tr>';
  }
  $("archive-create").addEventListener("click",async()=>{
    try{const r=await window.sbpDesktop.createArchive({date_from:$("archive-from").value,date_to:$("archive-to").value});if(r.canceled)return;$("archive-message").textContent="Arsip dibuat. Jumlah jurnal: "+r.recordCount+".";$("archive-message").className="import-message success";await refreshArchives();}
    catch(e){$("archive-message").textContent=e.message;$("archive-message").className="import-message error";}
  });
  $("archive-read").addEventListener("click",async()=>{
    try{const r=await window.sbpDesktop.readArchive();if(r.canceled)return;$("archive-reader-summary").textContent="Arsip "+r.metadata.dateFrom+" s.d. "+r.metadata.dateTo+" · "+r.metadata.journalCount+" jurnal · "+r.metadata.accountCount+" akun. Mode hanya baca.";
      $("archive-reader-rows").innerHTML=r.data.journals.map(x=>'<tr><td>'+escapeHtml(x.journal_date)+'</td><td>'+escapeHtml(x.voucher_number)+'</td><td>'+escapeHtml(x.description)+'</td><td>'+escapeHtml(x.status)+'</td><td>'+x.lines.length+'</td></tr>').join("");
    }catch(e){$("archive-reader-summary").textContent="Gagal membuka arsip: "+e.message;}
  });
  $("backup-now").addEventListener("click",async()=>{try{const r=await window.sbpDesktop.backup();$("backup-message").textContent=r.canceled?"Backup dibatalkan.":"Backup database berhasil disimpan.";$("backup-message").className="import-message success";}catch(e){$("backup-message").textContent=e.message;$("backup-message").className="import-message error";}});
  $("backup-auto-now").addEventListener("click",async()=>{try{const r=await window.sbpDesktop.automaticBackup();$("backup-message").textContent=r.created?"Backup otomatis dibuat: "+r.path:"Backup hari ini sudah tersedia: "+r.path;$("backup-message").className="import-message success";}catch(e){$("backup-message").textContent=e.message;$("backup-message").className="import-message error";}});
  $("restore-now").addEventListener("click",async()=>{if(!confirm("Restore akan mengganti database aktif dengan file backup. Database saat ini akan diamankan terlebih dahulu. Lanjutkan?"))return;try{const r=await window.sbpDesktop.restoreDatabase();$("backup-message").textContent=r.canceled?"Restore dibatalkan.":"Restore berhasil. Backup keselamatan: "+r.safetyBackup+". Tutup dan buka ulang aplikasi."; $("backup-message").className="import-message success";}catch(e){$("backup-message").textContent=e.message;$("backup-message").className="import-message error";}});
  async function loadAdminModules(){
    await fillAdminAccounts();await refreshPeriods();await refreshDebitNotes();await refreshAudit();await refreshArchives();await refreshPrintSettings();
  }

  // Legacy Import Center: local XLSX/CSV/DBF parsing with explicit preview and approval.
  let pendingNptransBatch=null,pendingAccountBatch=null,pendingOpeningBatch=null;
  const importNorm=value=>String(value??"").trim().toUpperCase().replace(/[\s_./-]+/g,"").replace(/[^A-Z0-9]/g,"");
  const importAmount=value=>{
    if(value===null||value===undefined||value==="")return 0;
    if(typeof value==="number")return Number.isFinite(value)?value:NaN;
    let s=String(value).trim().replace(/[\s\u00a0]/g,"").replace(/^Rp/i,"").replace(/[^0-9,.-]/g,"");
    if(s.includes(",")&&s.includes("."))s=s.lastIndexOf(",")>s.lastIndexOf(".")?s.replace(/\./g,"").replace(",","."):s.replace(/,/g,"");
    else if(s.includes(",")){const a=s.split(",");s=a.length===2&&a[1].length<=2?s.replace(",","."):s.replace(/,/g,"");}
    const n=Number(s);return Number.isFinite(n)?n:NaN;
  };
  function parseImportCsv(text){
    const rows=[];let row=[],cell="",quoted=false;
    const s=String(text||"").replace(/^\uFEFF/,"");
    for(let i=0;i<s.length;i++){
      const ch=s[i],next=s[i+1];
      if(ch==='"'&&quoted&&next==='"'){cell+='"';i++;}
      else if(ch==='"'){quoted=!quoted;}
      else if((ch===","||ch===";"||ch==="\\t")&&!quoted){row.push(cell);cell="";}
      else if((ch==="\\n"||ch==="\\r")&&!quoted){if(ch==="\\r"&&next==="\\n")i++;row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);row=[];cell="";}
      else cell+=ch;
    }
    row.push(cell);if(row.some(x=>String(x).trim()))rows.push(row);
    if(!rows.length)throw new Error("File kosong.");
    const commaCount=(rows[0].join("").match(/,/g)||[]).length,semiCount=(rows[0].join("").match(/;/g)||[]).length;
    return rows;
  }
  function importDbf(buffer){
    const b=new Uint8Array(buffer),v=new DataView(buffer);
    if(b.length<33)throw new Error("File terlalu kecil untuk DBF.");
    const count=v.getUint32(4,true),headerLen=v.getUint16(8,true),recordLen=v.getUint16(10,true);
    if(headerLen<33||recordLen<2||headerLen>b.length)throw new Error("Header DBF tidak valid.");
    const fields=[];let fieldBytes=0;
    for(let p=32;p<headerLen-1&&b[p]!==0x0d;p+=32){
      let end=p;while(end<p+11&&b[end])end++;
      const name=new TextDecoder("ascii").decode(b.slice(p,end));
      const f={name,type:String.fromCharCode(b[p+11]),length:b[p+16],decimals:b[p+17]};
      if(!name||!f.length)throw new Error("Struktur field DBF tidak lengkap.");
      fields.push(f);fieldBytes+=f.length;
    }
    if(!fields.length||fieldBytes+1>recordLen)throw new Error("Panjang field DBF tidak cocok dengan record.");
    if(count>Math.floor((b.length-headerLen)/recordLen))throw new Error("Jumlah record DBF tidak cocok dengan ukuran file.");
    const records=[],decoder=new TextDecoder("windows-1252");
    for(let i=0,p=headerLen;i<count;i++,p+=recordLen){
      if(b[p]===0x2a)continue;
      let q=p+1,obj={};
      for(const f of fields){
        const raw=decoder.decode(b.slice(q,q+f.length)).replace(/\u0000/g,"").trim();q+=f.length;
        let val=raw;
        if(f.type==="N"||f.type==="F")val=raw===""?0:importAmount(raw);
        else if(f.type==="D"&&/^\d{8}$/.test(raw))val=raw.slice(0,4)+"-"+raw.slice(4,6)+"-"+raw.slice(6,8);
        obj[f.name]=val;
      }
      records.push(obj);
    }
    return {records,fields:fields.map(x=>x.name),recordCount:count,deletedCount:count-records.length};
  }
  async function readImportRows(file){
    const ext=file.name.toLowerCase().split(".").pop();
    if(ext==="dbf"){const parsed=importDbf(await file.arrayBuffer());return {rows:[parsed.fields,...parsed.records.map(record=>parsed.fields.map(field=>record[field]))],deletedCount:parsed.deletedCount};}
    if(ext==="csv"||ext==="txt")return {rows:parseImportCsv(await file.text())};
    if(ext==="xls"||ext==="xlsx"){
      if(!window.XLSX)throw new Error("Mesin Excel lokal belum tersedia. Jalankan npm install lalu buka ulang aplikasi.");
      const wb=window.XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:false});
      const sheet=wb.SheetNames[0];if(!sheet)throw new Error("Workbook tidak memiliki sheet.");
      return {rows:window.XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:"",raw:false})};
    }
    throw new Error("Format file tidak didukung.");
  }
  function findImportHeader(rows,required,aliases={}){
    for(let i=0;i<Math.min(rows.length,40);i++){
      const headers=rows[i].map(importNorm),map={};
      for(const key of required){
        const opts=[key,...(aliases[key]||[])].map(importNorm);
        map[key]=headers.findIndex(h=>opts.includes(h));
      }
      if(required.every(k=>map[k]>=0))return {index:i,map};
    }
    throw new Error("Header wajib tidak ditemukan: "+required.join(", "));
  }
  function importDate(value){
    let s=String(value??"").trim();
    if(/^\d{8}$/.test(s))return s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8);
    if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
    let m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if(m)return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
    return s;
  }
  function showImportTab(tab){
    document.querySelectorAll("[data-import-tab]").forEach(b=>b.classList.toggle("active",b.dataset.importTab===tab));
    ["nptrans","accounts","opening"].forEach(name=>{const el=$("import-panel-"+name);if(el)el.hidden=name!==tab;});
  }
  document.querySelectorAll("[data-import-tab]").forEach(b=>b.addEventListener("click",()=>showImportTab(b.dataset.importTab)));
  async function refreshNptransRows(){
    const rows=await window.sbpDesktop.listNptrans({keyword:$("nptrans-search").value});
    $("nptrans-saved-summary").textContent=rows.length+" baris ditampilkan (maksimum 1.000).";
    $("nptrans-saved-rows").innerHTML=rows.length?rows.map(x=>'<tr><td>'+escapeHtml(x.sandi)+'</td><td>'+escapeHtml(x.transaction_date)+'</td><td>'+escapeHtml(x.voucher_number)+'</td><td>'+escapeHtml(x.row_number)+'</td><td>'+escapeHtml(x.description)+'</td><td class="money-cell">'+money(x.amount)+'</td></tr>').join(""):'<tr><td colspan="6" class="empty">Belum ada data NPTRANS.</td></tr>';
  }

  let pendingV19Migration=null;
  $("v19-backup-file").addEventListener("change",e=>{
    const file=e.target.files[0]||null;
    $("v19-backup-name").textContent=file?file.name:"Belum ada file dipilih.";
    $("v19-backup-preview").disabled=!file;
    $("v19-backup-review").hidden=true;
    pendingV19Migration=null;
  });
  $("v19-backup-preview").addEventListener("click",async()=>{
    const file=$("v19-backup-file").files[0];if(!file)return;
    try{
      const payload=JSON.parse(await file.text());
      if(Number(payload.version)!==19||!payload.state||!Array.isArray(payload.state.accounts)||!Array.isArray(payload.state.journals))throw new Error("File bukan backup JSON SBP Accounting V19 yang dikenali.");
      const state=payload.state;
      pendingV19Migration={version:19,state,file_name:file.name};
      $("v19-backup-summary").textContent="Backup V19 terbaca: "+state.accounts.length+" akun · "+state.journals.length+" jurnal · "+(state.openingBalances||[]).length+" saldo awal · "+(state.nptrans||[]).length+" baris NPTRANS";
      $("v19-backup-detail").textContent="Data akan digabungkan ke V20. Data V20 yang sudah ada tidak dihapus. Jurnal dengan nomor bukti yang sudah digunakan akan dilewati. Pastikan backup asli tetap disimpan di lokasi terpisah.";
      $("v19-backup-review").hidden=false;
      $("v19-backup-confirm").disabled=false;
      $("v19-backup-message").textContent="Struktur backup berhasil dibaca. Periksa ringkasan sebelum menjalankan migrasi.";
      $("v19-backup-message").className="import-message success";
    }catch(error){
      pendingV19Migration=null;$("v19-backup-review").hidden=true;
      $("v19-backup-message").textContent="Pemeriksaan gagal: "+error.message;
      $("v19-backup-message").className="import-message error";
    }
  });
  $("v19-backup-cancel").addEventListener("click",()=>{pendingV19Migration=null;$("v19-backup-review").hidden=true;});
  $("v19-backup-confirm").addEventListener("click",async()=>{
    if(!pendingV19Migration)return;
    if(!confirm("Migrasi akan menambahkan data V19 ke database V20. Data yang sudah ada tidak dihapus. Lanjutkan?"))return;
    $("v19-backup-confirm").disabled=true;
    try{
      const result=await window.sbpDesktop.importV19Backup(pendingV19Migration);
      $("v19-backup-message").textContent="Migrasi selesai: "+result.accountInserted+" akun baru, "+result.journalInserted+" jurnal masuk, "+result.journalSkipped+" jurnal dilewati, "+result.openingInserted+" saldo awal, "+result.nptransInserted+" baris NPTRANS.";
      $("v19-backup-message").className="import-message success";
      pendingV19Migration=null;$("v19-backup-review").hidden=true;
      await refreshSummary();await loadAccounts();await loadOpeningBalances();await refreshNptransRows();await loadJournalList();
    }catch(error){
      $("v19-backup-message").textContent="Migrasi dibatalkan: "+error.message;
      $("v19-backup-message").className="import-message error";
      $("v19-backup-confirm").disabled=false;
    }
  });

  let selectedNpFile=null,selectedAccountFile=null,selectedOpeningFile=null;
  $("nptrans-file").addEventListener("change",e=>{selectedNpFile=e.target.files[0]||null;$("nptrans-file-name").textContent=selectedNpFile?selectedNpFile.name:"Belum ada file dipilih.";$("nptrans-preview").disabled=!selectedNpFile;$("nptrans-review").hidden=true;pendingNptransBatch=null;});
  $("nptrans-preview").addEventListener("click",async()=>{
    const file=selectedNpFile;if(!file)return;
    try{
      const parsed=await readImportRows(file);let raw=parsed.records||parsed.rows;
      const header=findImportHeader(raw,["SANDI","TANGGAL","NOBUKTI","NOURUT","KET","JUMLAH"],{TANGGAL:["DATE"],NOBUKTI:["NOMORBUKTI","BUKTI"],NOURUT:["URUT","NO"],KET:["KETERANGAN","URAIAN"],JUMLAH:["NILAI","AMOUNT"]});
      const items=raw.slice(header.index+1).map((r,i)=>({sandi:String(r[header.map.SANDI]??"").trim(),transaction_date:importDate(r[header.map.TANGGAL]),voucher_number:String(r[header.map.NOBUKTI]??"").trim(),row_number:String(r[header.map.NOURUT]??"").trim(),description:String(r[header.map.KET]??"").trim(),amount:importAmount(r[header.map.JUMLAH]),source_row_no:header.index+i+2,raw:r}))
        .filter(x=>x.sandi||x.voucher_number||x.description||x.amount);
      const valid=items.filter(x=>x.sandi&&x.voucher_number&&/^\d{4}-\d{2}-\d{2}$/.test(x.transaction_date)&&Number.isFinite(x.amount));
      const invalid=items.length-valid.length;
      const mode=$("nptrans-mode").value;
      const current=await window.sbpDesktop.listNptrans({});
      const key=x=>[x.sandi,x.transaction_date,x.voucher_number,x.row_number,x.description,Number(x.amount).toFixed(2)].join("|").toUpperCase();
      const existing=new Set(current.map(key)),seen=new Set();let duplicates=0;
      valid.forEach(x=>{if(existing.has(key(x))||seen.has(key(x)))duplicates++;seen.add(key(x));});
      pendingNptransBatch={file_name:file.name,file_type:file.name.split(".").pop().toUpperCase(),items:valid,total_read:items.length,deleted_count:parsed.deletedCount||0,mode,invalid,duplicates};
      $("nptrans-review-summary").textContent=items.length+" record dibaca · "+valid.length+" valid · "+invalid+" ditolak";
      $("nptrans-review-detail").textContent="Duplikat terdeteksi: "+duplicates+". Mode: "+mode+". Data belum disimpan.";
      $("nptrans-preview-rows").innerHTML=valid.slice(0,100).map(x=>'<tr><td>'+x.source_row_no+'</td><td>'+escapeHtml(x.sandi)+'</td><td>'+escapeHtml(x.transaction_date)+'</td><td>'+escapeHtml(x.voucher_number)+'</td><td>'+escapeHtml(x.row_number)+'</td><td>'+escapeHtml(x.description)+'</td><td>'+money(x.amount)+'</td></tr>').join("");
      $("nptrans-review").hidden=false;$("nptrans-confirm").disabled=!valid.length||invalid>0;
      $("nptrans-message").textContent=invalid?"Ada baris tidak valid. Perbaiki file sumber sebelum menyimpan.":"Pratinjau berhasil. Periksa sampel data sebelum menyimpan.";
      $("nptrans-message").className="import-message "+(invalid?"error":"success");
    }catch(error){pendingNptransBatch=null;$("nptrans-review").hidden=true;$("nptrans-message").textContent="Gagal membaca file: "+error.message;$("nptrans-message").className="import-message error";}
  });
  $("nptrans-cancel").addEventListener("click",()=>{pendingNptransBatch=null;$("nptrans-review").hidden=true;});
  $("nptrans-confirm").addEventListener("click",async()=>{
    const batch=pendingNptransBatch;if(!batch)return;
    if(batch.mode==="replace"&&!confirm("PERINGATAN: seluruh data NPTRANS lama akan diganti. Lanjutkan hanya setelah backup."))return;
    try{const result=await window.sbpDesktop.importNptrans({...batch,items:batch.items});$("nptrans-message").textContent="Import selesai: "+result.inserted+" baris masuk, "+result.skipped+" duplikat dilewati.";$("nptrans-message").className="import-message success";pendingNptransBatch=null;$("nptrans-review").hidden=true;await refreshNptransRows();}
    catch(error){$("nptrans-message").textContent="Import gagal: "+error.message;$("nptrans-message").className="import-message error";}
  });
  $("nptrans-search").addEventListener("input",refreshNptransRows);

  $("account-import-file").addEventListener("change",e=>{selectedAccountFile=e.target.files[0]||null;$("account-import-file-name").textContent=selectedAccountFile?selectedAccountFile.name:"Belum ada file dipilih.";$("account-import-preview").disabled=!selectedAccountFile;$("account-import-review").hidden=true;pendingAccountBatch=null;});
  $("account-import-preview").addEventListener("click",async()=>{
    try{
      const parsed=await readImportRows(selectedAccountFile),raw=parsed.records||parsed.rows;
      const header=findImportHeader(raw,["SANDI"],{SANDI:["KODE","KODEAKUN","ACCOUNTCODE"]});
      const h=raw[header.index].map(importNorm),nameIndex=h.findIndex(x=>["NAMA","NAMAAKUN","DES","KETERANGAN","URAIAN","ACCOUNTNAME"].includes(x));
      const items=raw.slice(header.index+1).map(r=>({sandi:String(r[header.map.SANDI]??"").trim(),account_name:nameIndex>=0?String(r[nameIndex]??"").trim():""})).filter(x=>x.sandi);
      if(!items.length)throw new Error("Tidak ada baris SANDI di bawah header.");
      const bad=items.filter(x=>!x.account_name);
      pendingAccountBatch={items,file_name:selectedAccountFile.name,bad:bad.length};
      const current=await window.sbpDesktop.listAccounts("");
      $("account-import-summary").textContent=items.length+" akun terbaca · "+items.filter(x=>current.some(a=>a.sandi===x.sandi)).length+" akan diperbarui · "+items.filter(x=>!current.some(a=>a.sandi===x.sandi)).length+" akun baru";
      $("account-import-detail").textContent=bad.length+" baris tanpa nama akun. Semua baris harus memiliki SANDI dan nama akun.";
      $("account-import-preview-rows").innerHTML=items.slice(0,150).map(x=>'<tr><td>'+escapeHtml(x.sandi)+'</td><td>'+escapeHtml(x.account_name)+'</td><td>'+ (current.some(a=>a.sandi===x.sandi)?"Perbarui nama":"Tambah akun")+'</td></tr>').join("");
      $("account-import-review").hidden=false;$("account-import-confirm").disabled=bad.length>0;
      $("account-import-message").textContent=bad.length?"Ada baris tanpa nama akun. Perbaiki file sumber.":"Pratinjau Master Akun siap diperiksa.";
      $("account-import-message").className="import-message "+(bad.length?"error":"success");
    }catch(error){pendingAccountBatch=null;$("account-import-message").textContent="Gagal membaca file: "+error.message;$("account-import-message").className="import-message error";}
  });
  $("account-import-cancel").addEventListener("click",()=>{pendingAccountBatch=null;$("account-import-review").hidden=true;});
  $("account-import-confirm").addEventListener("click",async()=>{
    if(!pendingAccountBatch)return;
    try{const result=await window.sbpDesktop.importAccounts(pendingAccountBatch);$("account-import-message").textContent="Selesai: "+result.inserted+" akun baru, "+result.updated+" diperbarui.";$("account-import-message").className="import-message success";pendingAccountBatch=null;$("account-import-review").hidden=true;await loadAccounts();await prepareJournal();}
    catch(error){$("account-import-message").textContent="Import gagal: "+error.message;$("account-import-message").className="import-message error";}
  });

  $("opening-import-file").addEventListener("change",e=>{selectedOpeningFile=e.target.files[0]||null;$("opening-import-file-name").textContent=selectedOpeningFile?selectedOpeningFile.name:"Belum ada file dipilih.";$("opening-import-preview").disabled=!selectedOpeningFile;$("opening-import-review").hidden=true;pendingOpeningBatch=null;});
  $("opening-import-preview").addEventListener("click",async()=>{
    try{
      const parsed=await readImportRows(selectedOpeningFile),raw=parsed.records||parsed.rows;
      const head=findImportHeader(raw,["PERIODE","SANDI"],{PERIODE:["BULAN","PERIOD"],SANDI:["KODE","KODEAKUN"]});
      const h=raw[head.index].map(importNorm);
      const ix=(names)=>h.findIndex(x=>names.map(importNorm).includes(x));
      const d=ix(["DEBIT","DEBITAWAL","SALDOAWALDEBIT"]),cr=ix(["KREDIT","KREDITAWAL","SALDOAWALKREDIT"]),program=ix(["PROGRAM","KODEPROGRAM"]);
      if(d<0||cr<0)throw new Error("Kolom DEBIT dan KREDIT (atau DEBIT AWAL dan KREDIT AWAL) wajib tersedia.");
      const items=raw.slice(head.index+1).map((r,i)=>({period_key:String(r[head.map.PERIODE]??"").trim(),sandi:String(r[head.map.SANDI]??"").trim(),debit:importAmount(r[d]),credit:importAmount(r[cr]),program_code:program>=0?String(r[program]??"").trim():"",row:i+head.index+2})).filter(x=>x.sandi||x.period_key);
      const accounts=await window.sbpDesktop.listAccounts("");
      const errors=[];
      items.forEach(x=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(x.period_key))errors.push("Baris "+x.row+": periode harus YYYY-MM.");if(!accounts.some(a=>a.sandi===x.sandi))errors.push("Baris "+x.row+": SANDI tidak ada di Master Akun.");if(!Number.isFinite(x.debit)||!Number.isFinite(x.credit)||x.debit<0||x.credit<0||(x.debit>0&&x.credit>0)||(!(x.debit>0)&&!(x.credit>0)))errors.push("Baris "+x.row+": isi salah satu debit/kredit dengan nominal positif.");});
      pendingOpeningBatch={file_name:selectedOpeningFile.name,items,errors};
      $("opening-import-summary").textContent=items.length+" baris dibaca · "+(items.length-errors.length)+" baris berpotensi valid";
      $("opening-import-detail").textContent=errors.length?errors.slice(0,12).join(" | "):"Validasi format dan Master Akun berhasil. Duplikat di database akan dilewati.";
      $("opening-import-preview-rows").innerHTML=items.slice(0,150).map(x=>'<tr><td>'+escapeHtml(x.period_key)+'</td><td>'+escapeHtml(x.sandi)+'</td><td>'+money(x.debit)+'</td><td>'+money(x.credit)+'</td><td>'+ (errors.some(e=>e.includes("Baris "+x.row+":"))?"Periksa":"Siap")+'</td></tr>').join("");
      $("opening-import-review").hidden=false;$("opening-import-confirm").disabled=errors.length>0||!items.length;
      $("opening-import-message").textContent=errors.length?"Ada kesalahan yang harus diperbaiki. Tidak ada data disimpan.":"Pratinjau saldo awal siap diimpor.";
      $("opening-import-message").className="import-message "+(errors.length?"error":"success");
    }catch(error){pendingOpeningBatch=null;$("opening-import-message").textContent="Gagal membaca file: "+error.message;$("opening-import-message").className="import-message error";}
  });
  $("opening-import-cancel").addEventListener("click",()=>{pendingOpeningBatch=null;$("opening-import-review").hidden=true;});
  $("opening-import-confirm").addEventListener("click",async()=>{
    if(!pendingOpeningBatch||pendingOpeningBatch.errors.length)return;
    try{const result=await window.sbpDesktop.importOpeningBalances(pendingOpeningBatch);$("opening-import-message").textContent="Import selesai: "+result.inserted+" saldo awal baru, "+result.skipped+" dilewati.";$("opening-import-message").className="import-message success";pendingOpeningBatch=null;$("opening-import-review").hidden=true;await loadOpeningBalances();}
    catch(error){$("opening-import-message").textContent="Import gagal: "+error.message;$("opening-import-message").className="import-message error";}
  });

  async function loadOpeningBalances(){
    const period=$("opening-period").value;
    const items=await window.sbpDesktop.listOpeningBalances(period);
    const accounts=await window.sbpDesktop.listAccounts("");
    $("opening-account").innerHTML='<option value="">Pilih SANDI</option>'+accounts.filter(a=>Number(a.is_active)===1).map(a=>'<option value="'+escapeHtml(a.sandi)+'">'+escapeHtml(a.sandi+" — "+a.account_name)+'</option>').join("");
    $("opening-rows").innerHTML=items.length?items.map(x=>'<tr><td>'+escapeHtml(x.period_key)+'</td><td>'+escapeHtml(x.sandi)+'</td><td>'+escapeHtml(x.program_code||"")+'</td><td>'+money(x.debit)+'</td><td>'+money(x.credit)+'</td></tr>').join(""):'<tr><td colspan="5" class="empty">Belum ada saldo awal.</td></tr>';
    const debit=items.reduce((a,x)=>a+Number(x.debit||0),0),credit=items.reduce((a,x)=>a+Number(x.credit||0),0);
    $("opening-totals").textContent="Debit "+money(debit)+" · Kredit "+money(credit)+" · Selisih "+money(debit-credit);
  }
  $("opening-period").addEventListener("change",loadOpeningBalances);
  $("opening-save").addEventListener("click",async()=>{
    try{await window.sbpDesktop.saveOpeningBalance({period_key:$("opening-period").value,sandi:$("opening-account").value,program_code:$("opening-program").value,debit:Number($("opening-debit").value||0),credit:Number($("opening-credit").value||0)});$("opening-message").textContent="Saldo awal berhasil disimpan.";$("opening-message").className="import-message success";$("opening-debit").value="";$("opening-credit").value="";await loadOpeningBalances();}
    catch(error){$("opening-message").textContent=error.message;$("opening-message").className="import-message error";}
  });
  document.querySelectorAll('[data-import-launch]').forEach(button=>button.addEventListener("click",()=>showImportTab(button.dataset.importLaunch==="nptrans"?"nptrans":"accounts")));
  $("budget-filter-year").addEventListener("change",()=>{});
  showImportTab("nptrans");
  refreshNptransRows().catch(()=>{});
  $("opening-period").value=new Date().toISOString().slice(0,7);
  loadOpeningBalances().catch(()=>{});

  $("dn-date").value=new Date().toISOString().slice(0,10);
  $("period-key").value=new Date().toISOString().slice(0,7);
  $("report-period").value=new Date().toISOString().slice(0,7);
  $("admin-reversal-date").value=new Date().toISOString().slice(0,10);
  $("archive-from").value=new Date().getFullYear()+"-01-01";
  $("archive-to").value=new Date().toISOString().slice(0,10);
  await loadAdminModules();
  addDebitNoteLine();addDebitNoteLine();
  await refreshSummary();
});