const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const initSqlJs = require("sql.js");

let db;
let dbPath;
let SQL;

function wasmPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sql-wasm.wasm")
    : require.resolve("sql.js/dist/sql-wasm.wasm");
}

function saveDb() {
  if (!db || !dbPath) return;
  const tempPath = dbPath + ".tmp";
  fs.writeFileSync(tempPath, Buffer.from(db.export()));
  try {
    fs.renameSync(tempPath, dbPath);
  } catch (error) {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    fs.renameSync(tempPath, dbPath);
  }
}

function rows(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const result = [];
    while (stmt.step()) result.push(stmt.getAsObject());
    return result;
  } finally {
    stmt.free();
  }
}

function ensureColumn(table, column, declaration) {
  const columns = rows("PRAGMA table_info(" + table + ")");
  if (!columns.some(item => item.name === column)) {
    db.run("ALTER TABLE " + table + " ADD COLUMN " + column + " " + declaration);
  }
}

function applySchemaMigrations() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.run(schema);

  // Additive-only migration: existing V20 data is preserved.
  ensureColumn("accounts", "parent_sandi", "TEXT");
  ensureColumn("accounts", "account_group", "TEXT");
  ensureColumn("accounts", "created_at", "TEXT");
  ensureColumn("accounts", "updated_at", "TEXT");
  ensureColumn("journal_headers", "source_type", "TEXT");
  ensureColumn("journal_headers", "source_id", "TEXT");
  ensureColumn("journal_headers", "source_voucher", "TEXT");
  ensureColumn("journal_headers", "split_from_id", "INTEGER");
  ensureColumn("journal_headers", "updated_at", "TEXT");
  ensureColumn("journal_headers", "posted_at", "TEXT");
  ensureColumn("journal_headers", "cancelled_at", "TEXT");
  ensureColumn("journal_headers", "cancel_reason", "TEXT");
  ensureColumn("journal_lines", "line_no", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn("journal_lines", "account_id", "INTEGER");

  db.run("INSERT OR IGNORE INTO schema_migrations(version,description) VALUES (1,'Initial V20 desktop schema')");
  db.run("INSERT OR IGNORE INTO schema_migrations(version,description) VALUES (2,'V19 successor domain schema')");
  db.run("INSERT OR REPLACE INTO app_meta(key,value) VALUES ('schema_version','2')");
  db.run("INSERT OR IGNORE INTO app_meta(key,value) VALUES ('application_version','20.0.0')");
}

async function initDatabase() {
  SQL = await initSqlJs({ locateFile: () => wasmPath() });
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, "sbp-accounting.db");

  db = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  db.run("PRAGMA foreign_keys = ON");
  applySchemaMigrations();
  saveDb();
}

ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("db:summary", () => {
  const scalar = (sql) => {
    const result = db.exec(sql);
    return result.length && result[0].values.length ? result[0].values[0][0] : 0;
  };
  return {
    accountCount: scalar("SELECT COUNT(*) FROM accounts WHERE is_active=1"),
    draftCount: scalar("SELECT COUNT(*) FROM journal_headers WHERE status='DRAFT'"),
    postedCount: scalar("SELECT COUNT(*) FROM journal_headers WHERE status='POSTED'")
  };
});

ipcMain.handle("accounts:list", (_event, keyword = "") => {
  const q = String(keyword || "").trim().toLowerCase();
  return rows(
    `SELECT id, sandi, account_name, account_type, normal_balance, is_active
     FROM accounts
     WHERE lower(sandi) LIKE ? OR lower(account_name) LIKE ?
     ORDER BY sandi`,
    [`%${q}%`, `%${q}%`]
  );
});

ipcMain.handle("accounts:save", (_event, account) => {
  const sandi = String(account && account.sandi || "").trim();
  const accountName = String(account && account.account_name || "").trim();
  const accountType = String(account && account.account_type || "").trim();
  const normalBalance = String(account && account.normal_balance || "DEBIT").trim().toUpperCase();
  const id = Number(account && account.id || 0);
  if (!sandi || !accountName) throw new Error("SANDI dan Nama Akun wajib diisi.");
  if (!/^[A-Za-z0-9._/-]{1,30}$/.test(sandi)) throw new Error("Format SANDI tidak valid (maksimal 30 karakter).");
  if (!["DEBIT", "KREDIT"].includes(normalBalance)) throw new Error("Saldo normal harus Debit atau Kredit.");
  const duplicate = rows("SELECT id FROM accounts WHERE sandi=? AND id<>?", [sandi, id]);
  if (duplicate.length) throw new Error("SANDI akun sudah digunakan.");

  db.run("BEGIN IMMEDIATE");
  try {
    if (id) {
      const exists = rows("SELECT id FROM accounts WHERE id=?", [id]);
      if (!exists.length) throw new Error("Akun yang akan diubah tidak ditemukan.");
      const stmt = db.prepare("UPDATE accounts SET sandi=?, account_name=?, account_type=?, normal_balance=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
      try { stmt.run([sandi, accountName, accountType, normalBalance, id]); } finally { stmt.free(); }
    } else {
      const stmt = db.prepare("INSERT INTO accounts(sandi, account_name, account_type, normal_balance, is_active, created_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)");
      try { stmt.run([sandi, accountName, accountType, normalBalance]); } finally { stmt.free(); }
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
  saveDb();
  return { ok: true };
});

ipcMain.handle("accounts:set-active", (_event, payload) => {
  const id = Number(payload && payload.id);
  const active = payload && payload.active ? 1 : 0;
  if (!id) throw new Error("ID akun tidak valid.");
  const stmt = db.prepare("UPDATE accounts SET is_active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  try { stmt.run([active, id]); } finally { stmt.free(); }
  saveDb();
  return { ok: true };
});

ipcMain.handle("accounts:delete", (_event, idValue) => {
  const id = Number(idValue);
  const account = rows("SELECT sandi FROM accounts WHERE id=?", [id]);
  if (!account.length) throw new Error("Akun tidak ditemukan.");
  const usedJournals = rows("SELECT COUNT(*) AS total FROM journal_lines WHERE sandi=?", [account[0].sandi]);
  const usedOpening = rows("SELECT COUNT(*) AS total FROM opening_balances WHERE sandi=?", [account[0].sandi]);
  const usedBudget = rows("SELECT COUNT(*) AS total FROM annual_budgets WHERE sandi=?", [account[0].sandi]);
  if (Number(usedJournals[0].total) + Number(usedOpening[0].total) + Number(usedBudget[0].total) > 0) {
    throw new Error("Akun sudah dipakai dalam transaksi, saldo awal, atau anggaran. Nonaktifkan akun agar riwayat tetap aman.");
  }
  const stmt = db.prepare("DELETE FROM accounts WHERE id=?");
  try { stmt.run([id]); } finally { stmt.free(); }
  saveDb();
  return { ok: true };
});


function journalLinesFor(id) {
  return rows(
    `SELECT jl.id, jl.line_no, jl.sandi, a.account_name, jl.description, jl.debit, jl.credit
     FROM journal_lines jl LEFT JOIN accounts a ON a.sandi=jl.sandi
     WHERE jl.journal_id=? ORDER BY jl.line_no, jl.id`,
    [id]
  );
}

ipcMain.handle("journals:list", (_event, filters = {}) => {
  const keyword = String(filters.keyword || "").trim().toLowerCase();
  const status = String(filters.status || "ALL").toUpperCase();
  const dateFrom = String(filters.dateFrom || "");
  const dateTo = String(filters.dateTo || "");
  const clauses = ["(lower(j.voucher_number) LIKE ? OR lower(j.description) LIKE ?)"];
  const params = ["%" + keyword + "%", "%" + keyword + "%"];
  if (status !== "ALL") { clauses.push("j.status=?"); params.push(status); }
  if (dateFrom) { clauses.push("j.journal_date>=?"); params.push(dateFrom); }
  if (dateTo) { clauses.push("j.journal_date<=?"); params.push(dateTo); }
  const headers = rows(
    "SELECT j.id,j.journal_date,j.voucher_number,j.description,j.status,j.created_at,j.posted_at," +
    "(SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE journal_id=j.id) AS total_debit," +
    "(SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE journal_id=j.id) AS total_credit " +
    "FROM journal_headers j WHERE " + clauses.join(" AND ") +
    " ORDER BY j.journal_date DESC,j.id DESC LIMIT 500",
    params
  );
  return headers.map(item => ({ ...item, lines: journalLinesFor(item.id) }));
});

ipcMain.handle("journals:save", (_event, payload = {}) => {
  const id = Number(payload.id || 0);
  const date = String(payload.journal_date || "").trim();
  const voucher = String(payload.voucher_number || "").trim();
  const description = String(payload.description || "").trim();
  const status = String(payload.status || "DRAFT").toUpperCase();
  const linesInput = Array.isArray(payload.lines) ? payload.lines : [];
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error("Tanggal jurnal tidak valid.");
  if (!voucher || voucher.length > 60) throw new Error("Nomor bukti wajib diisi (maksimal 60 karakter).");
  if (!description) throw new Error("Keterangan jurnal wajib diisi.");
  if (!["DRAFT", "POSTED"].includes(status)) throw new Error("Status jurnal tidak valid.");
  if (linesInput.length < 2) throw new Error("Jurnal minimal memiliki dua baris.");
  if (id) {
    const old = rows("SELECT id,status,journal_date FROM journal_headers WHERE id=?", [id]);
    if (!old.length) throw new Error("Jurnal tidak ditemukan.");
    if (old[0].status !== "DRAFT") throw new Error("Jurnal POSTED tidak dapat diedit. Gunakan jurnal koreksi atau pembalik.");
  }
  if (rows("SELECT id FROM journal_headers WHERE voucher_number=? AND id<>?", [voucher, id]).length) {
    throw new Error("Nomor bukti sudah digunakan.");
  }
  let debit = 0, credit = 0;
  const cleanLines = linesInput.map((line, index) => {
    const sandi = String(line.sandi || "").trim();
    const note = String(line.description || "").trim();
    const d = Number(line.debit || 0), c = Number(line.credit || 0);
    if (!sandi || !Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0 || (d > 0 && c > 0)) {
      throw new Error("Baris " + (index + 1) + ": pilih akun dan isi nilai debit/kredit yang valid.");
    }
    const account = rows("SELECT id FROM accounts WHERE sandi=? AND is_active=1", [sandi]);
    if (!account.length) throw new Error("SANDI " + sandi + " tidak ditemukan atau tidak aktif.");
    debit += d; credit += c;
    return { line_no: index + 1, account_id: account[0].id, sandi, description: note, debit: d, credit: c };
  });
  if (status === "POSTED") {
    if (cleanLines.some(line => line.debit + line.credit <= 0)) throw new Error("Setiap baris POSTED harus memiliki nilai debit atau kredit.");
    if (Math.abs(debit - credit) > 0.005) throw new Error("Jurnal belum seimbang. Debit: " + debit + " | Kredit: " + credit);
  }
  const period = date.slice(0, 7);
  const periodRows = rows("SELECT status FROM accounting_periods WHERE period_key=?", [period]);
  if (periodRows.length && periodRows[0].status === "CLOSED") throw new Error("Periode " + period + " sudah ditutup.");
  db.run("BEGIN IMMEDIATE");
  try {
    let journalId = id;
    if (id) {
      db.run("UPDATE journal_headers SET journal_date=?,voucher_number=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [date, voucher, description, id]);
      db.run("DELETE FROM journal_lines WHERE journal_id=?", [id]);
    } else {
      db.run("INSERT INTO journal_headers(journal_date,voucher_number,description,status,created_at) VALUES(?,?,?,'DRAFT',CURRENT_TIMESTAMP)",
        [date, voucher, description]);
      journalId = db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    }
    const stmt = db.prepare("INSERT INTO journal_lines(journal_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
    try { cleanLines.forEach(line => stmt.run([journalId,line.line_no,line.account_id,line.sandi,line.description,line.debit,line.credit])); }
    finally { stmt.free(); }
    if (status === "POSTED") {
      db.run("UPDATE journal_headers SET status='POSTED',posted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?", [journalId]);
    } else {
      db.run("UPDATE journal_headers SET status='DRAFT',updated_at=CURRENT_TIMESTAMP WHERE id=?", [journalId]);
    }
    db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary) VALUES(?,?,?,?)",
      [id ? "UPDATE_JOURNAL_DRAFT" : (status === "POSTED" ? "CREATE_POSTED_JOURNAL" : "CREATE_JOURNAL_DRAFT"),"JOURNAL",String(journalId),"Nomor bukti " + voucher + " · " + status]);
    db.run("COMMIT");
    saveDb();
    return { ok: true, id: journalId, status, totalDebit: debit, totalCredit: credit };
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
});

ipcMain.handle("journals:delete-draft", (_event, idValue) => {
  const id = Number(idValue);
  const item = rows("SELECT id,voucher_number,status,journal_date FROM journal_headers WHERE id=?", [id]);
  if (!item.length) throw new Error("Jurnal tidak ditemukan.");
  if (item[0].status !== "DRAFT") throw new Error("Hanya jurnal DRAFT yang dapat dihapus.");
  const period = String(item[0].journal_date).slice(0,7);
  const closed = rows("SELECT status FROM accounting_periods WHERE period_key=?", [period]);
  if (closed.length && closed[0].status === "CLOSED") throw new Error("Periode sudah ditutup.");
  db.run("BEGIN IMMEDIATE");
  try {
    db.run("DELETE FROM journal_headers WHERE id=?", [id]);
    db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary) VALUES('DELETE_JOURNAL_DRAFT','JOURNAL',?,?)",
      [String(id),"Hapus draft " + item[0].voucher_number]);
    db.run("COMMIT");
  } catch (error) { db.run("ROLLBACK"); throw error; }
  saveDb();
  return { ok: true };
});

ipcMain.handle("db:backup", async () => {
  const choice = await dialog.showSaveDialog({
    title: "Simpan Backup SBP Accounting",
    defaultPath: "SBP-Accounting-Backup.db",
    filters: [{ name: "SQLite Database", extensions: ["db"] }]
  });
  if (choice.canceled || !choice.filePath) return { canceled: true };
  saveDb();
  fs.copyFileSync(dbPath, choice.filePath);
  return { ok: true };
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 680,
    backgroundColor: "#f3f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await win.loadFile(path.join(__dirname, "../src/index.html"));
}

app.whenReady().then(async () => {
  try {
    await initDatabase();
    await createWindow();
  } catch (error) {
    console.error("SBP database initialization failed:", error);
    dialog.showErrorBox("SBP Accounting - Database", "Database gagal dibuka atau dimigrasikan. Data lama tidak dihapus.\n\n" + error.message);
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("before-quit", saveDb);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
