const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const initSqlJs = require("sql.js");

let db;
let dbPath;

function getWasmPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "sql-wasm.wasm")
    : require.resolve("sql.js/dist/sql-wasm.wasm");
}

async function openDatabase() {
  const SQL = await initSqlJs({ locateFile: () => getWasmPath() });
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  dbPath = path.join(dataDir, "sbp-accounting.db");

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sandi TEXT NOT NULL UNIQUE,
        account_name TEXT NOT NULL,
        account_type TEXT,
        normal_balance TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS journal_headers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_date TEXT NOT NULL,
        voucher_number TEXT,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_id INTEGER NOT NULL,
        sandi TEXT NOT NULL,
        description TEXT,
        debit REAL NOT NULL DEFAULT 0,
        credit REAL NOT NULL DEFAULT 0,
        FOREIGN KEY(journal_id) REFERENCES journal_headers(id)
      );
      INSERT OR REPLACE INTO app_meta(key, value) VALUES ('schema_version', '1');
    `);
    saveDatabase();
  }
}

function saveDatabase() {
  if (!db || !dbPath) return;
  const bytes = db.export();
  fs.writeFileSync(dbPath, Buffer.from(bytes));
}

ipcMain.handle("app:get-version", () => app.getVersion());
ipcMain.handle("db:save", () => {
  saveDatabase();
  return { ok: true };
});
ipcMain.handle("db:query", (_event, sql, params = []) => {
  // Only parameterized read queries are exposed to the UI.
  if (!/^\s*SELECT\b/i.test(sql)) {
    throw new Error("Hanya query SELECT yang diizinkan melalui endpoint ini.");
  }
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
});
ipcMain.handle("backup:create", async () => {
  const result = await dialog.showSaveDialog({
    title: "Simpan Backup SBP Accounting",
    defaultPath: `SBP-Accounting-Backup-${new Date().toISOString().slice(0,10)}.db`,
    filters: [{ name: "SQLite Database", extensions: ["db"] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  saveDatabase();
  fs.copyFileSync(dbPath, result.filePath);
  return { ok: true, filePath: result.filePath };
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
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
  await openDatabase();
  await createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => saveDatabase());
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
