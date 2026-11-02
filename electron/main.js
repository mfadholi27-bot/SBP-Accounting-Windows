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
