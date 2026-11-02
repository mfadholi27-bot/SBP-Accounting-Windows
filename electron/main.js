const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
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

function createAutomaticBackup(force=false) {
  if (!dbPath || !fs.existsSync(dbPath)) return {created:false};
  const dir=path.join(path.dirname(dbPath),"backups");
  fs.mkdirSync(dir,{recursive:true});
  const today=new Date().toISOString().slice(0,10);
  const target=path.join(dir,"SBP-Auto-"+today+".db");
  if(!force&&fs.existsSync(target))return {created:false,path:target};
  saveDb();
  const temp=target+".tmp";
  fs.copyFileSync(dbPath,temp);
  fs.renameSync(temp,target);
  const files=fs.readdirSync(dir).filter(x=>/^SBP-Auto-\d{4}-\d{2}-\d{2}\.db$/.test(x)).sort().reverse();
  files.slice(30).forEach(name=>{try{fs.unlinkSync(path.join(dir,name));}catch(_){}});
  return {created:true,path:target,retained:Math.min(files.length+1,30)};
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
  createAutomaticBackup(false);
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Tanggal jurnal tidak valid.");
  if (!voucher || voucher.length > 60) throw new Error("Nomor bukti wajib diisi (maksimal 60 karakter).");
  if (!description) throw new Error("Keterangan jurnal wajib diisi.");
  if (!["DRAFT", "POSTED"].includes(status)) throw new Error("Status jurnal tidak valid.");
  if (linesInput.length < 2) throw new Error("Jurnal minimal memiliki dua baris.");
  if (id) {
    const old = rows("SELECT id,status,journal_date FROM journal_headers WHERE id=?", [id]);
    if (!old.length) throw new Error("Jurnal tidak ditemukan.");
    if (old[0].status !== "DRAFT") throw new Error("Jurnal POSTED tidak dapat diedit. Gunakan jurnal koreksi atau pembalik.");
    if (periodIsClosed(old[0].journal_date)) throw new Error("Draft berada pada periode asal yang sudah ditutup.");
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


ipcMain.handle("budgets:list", (_event, yearValue) => {
  const year = Number(yearValue || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Tahun anggaran tidak valid.");
  const budgets = rows(
    `SELECT b.sandi, a.account_name, b.fiscal_year,
       SUM(CASE WHEN b.month_no=1 THEN b.budget_amount ELSE 0 END) AS m01,
       SUM(CASE WHEN b.month_no=2 THEN b.budget_amount ELSE 0 END) AS m02,
       SUM(CASE WHEN b.month_no=3 THEN b.budget_amount ELSE 0 END) AS m03,
       SUM(CASE WHEN b.month_no=4 THEN b.budget_amount ELSE 0 END) AS m04,
       SUM(CASE WHEN b.month_no=5 THEN b.budget_amount ELSE 0 END) AS m05,
       SUM(CASE WHEN b.month_no=6 THEN b.budget_amount ELSE 0 END) AS m06,
       SUM(CASE WHEN b.month_no=7 THEN b.budget_amount ELSE 0 END) AS m07,
       SUM(CASE WHEN b.month_no=8 THEN b.budget_amount ELSE 0 END) AS m08,
       SUM(CASE WHEN b.month_no=9 THEN b.budget_amount ELSE 0 END) AS m09,
       SUM(CASE WHEN b.month_no=10 THEN b.budget_amount ELSE 0 END) AS m10,
       SUM(CASE WHEN b.month_no=11 THEN b.budget_amount ELSE 0 END) AS m11,
       SUM(CASE WHEN b.month_no=12 THEN b.budget_amount ELSE 0 END) AS m12,
       COALESCE(SUM(b.budget_amount),0) AS annual
     FROM annual_budgets b LEFT JOIN accounts a ON a.sandi=b.sandi
     WHERE b.fiscal_year=? AND COALESCE(b.program_code,'')=''
     GROUP BY b.sandi,b.fiscal_year,a.account_name ORDER BY b.sandi`, [year]
  );
  return budgets.map(item => {
    const actual = rows(
      `SELECT CAST(substr(j.journal_date,6,2) AS INTEGER) AS month_no,
       COALESCE(SUM(l.debit-l.credit),0) AS net
       FROM journal_headers j JOIN journal_lines l ON l.journal_id=j.id
       WHERE j.status='POSTED' AND substr(j.journal_date,1,4)=? AND l.sandi=?
       GROUP BY substr(j.journal_date,6,2)`, [String(year), item.sandi]
    );
    const actualByMonth = Array(12).fill(0);
    actual.forEach(x => { if (x.month_no >= 1 && x.month_no <= 12) actualByMonth[x.month_no-1] = Number(x.net || 0); });
    const monthly = Array.from({length:12}, (_,i) => Number(item["m"+String(i+1).padStart(2,"0")] || 0));
    const totalActual = actualByMonth.reduce((a,b)=>a+b,0);
    return { sandi:item.sandi, account_name:item.account_name || "—", fiscal_year:year,
      monthly, actualByMonth, annual:Number(item.annual || 0), actual:totalActual,
      remaining:Number(item.annual || 0)-totalActual };
  });
});

ipcMain.handle("budgets:save", (_event, payload = {}) => {
  const year = Number(payload.fiscal_year);
  const sandi = String(payload.sandi || "").trim();
  const monthly = Array.isArray(payload.monthly) ? payload.monthly.map(Number) : [];
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Tahun anggaran harus 2000–2100.");
  if (!sandi) throw new Error("SANDI akun wajib dipilih.");
  if (monthly.length !== 12 || monthly.some(x => !Number.isFinite(x) || x < 0)) throw new Error("Isi 12 nilai anggaran bulanan yang valid dan tidak negatif.");
  const account = rows("SELECT id FROM accounts WHERE sandi=? AND is_active=1", [sandi]);
  if (!account.length) throw new Error("SANDI tidak ditemukan atau tidak aktif pada Master Akun.");
  db.run("BEGIN IMMEDIATE");
  try {
    db.run("DELETE FROM annual_budgets WHERE fiscal_year=? AND sandi=? AND COALESCE(program_code,'')=''", [year,sandi]);
    const stmt=db.prepare("INSERT INTO annual_budgets(fiscal_year,account_id,sandi,month_no,budget_amount,program_code,updated_at) VALUES(?,?,?,?,?,'',CURRENT_TIMESTAMP)");
    try { monthly.forEach((amount,index)=>stmt.run([year,account[0].id,sandi,index+1,amount])); }
    finally { stmt.free(); }
    db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary) VALUES('SAVE_ANNUAL_BUDGET','ANNUAL_BUDGET',?,?)",
      [year+"|"+sandi,"Anggaran tahunan "+sandi+" tahun "+year+" disimpan"]);
    db.run("COMMIT");
  } catch(error) { db.run("ROLLBACK"); throw error; }
  saveDb();
  return {ok:true,annual:monthly.reduce((a,b)=>a+b,0)};
});

ipcMain.handle("budgets:delete", (_event, payload = {}) => {
  const year=Number(payload.fiscal_year),sandi=String(payload.sandi || "").trim();
  if(!Number.isInteger(year)||!sandi) throw new Error("Tahun atau SANDI tidak valid.");
  db.run("DELETE FROM annual_budgets WHERE fiscal_year=? AND sandi=? AND COALESCE(program_code,'')=''",[year,sandi]);
  db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary) VALUES('DELETE_ANNUAL_BUDGET','ANNUAL_BUDGET',?,?)",
    [year+"|"+sandi,"Anggaran "+sandi+" tahun "+year+" dihapus"]);
  saveDb();
  return {ok:true};
});


ipcMain.handle("imports:accounts", (_event, payload = {}) => {
  const items=Array.isArray(payload.items)?payload.items:[];
  if(!items.length) throw new Error("Tidak ada akun valid untuk diimpor.");
  let inserted=0,updated=0,skipped=0;
  db.run("BEGIN IMMEDIATE");
  try {
    for(const item of items){
      const sandi=String(item.sandi||"").trim(),name=String(item.account_name||"").trim();
      if(!sandi||!name){skipped++;continue;}
      const old=rows("SELECT id FROM accounts WHERE sandi=?",[sandi]);
      if(old.length){
        db.run("UPDATE accounts SET account_name=?,updated_at=CURRENT_TIMESTAMP WHERE sandi=?",[name,sandi]);updated++;
      }else{
        db.run("INSERT INTO accounts(sandi,account_name,account_type,normal_balance,is_active,created_at) VALUES(?,?,?,'DEBIT',1,CURRENT_TIMESTAMP)",
          [sandi,name,String(item.account_type||"")]);inserted++;
      }
    }
    db.run("INSERT INTO audit_logs(action,entity_type,summary) VALUES('IMPORT_ACCOUNTS','IMPORT',?)",
      ["Import Master Akun: "+inserted+" baru, "+updated+" diperbarui, "+skipped+" dilewati"]);
    db.run("COMMIT");
  }catch(error){db.run("ROLLBACK");throw error;}
  saveDb();return {ok:true,inserted,updated,skipped};
});

ipcMain.handle("nptrans:list", (_event, filters = {}) => {
  const q=String(filters.keyword||"").trim().toLowerCase();
  return rows(
    `SELECT id,sandi,transaction_date,voucher_number,row_number,description,amount,raw_json
     FROM nptrans_rows
     WHERE lower(COALESCE(sandi,'')) LIKE ? OR lower(COALESCE(voucher_number,'')) LIKE ?
       OR lower(COALESCE(description,'')) LIKE ?
     ORDER BY transaction_date DESC,id DESC LIMIT 1000`,
    ["%"+q+"%","%"+q+"%","%"+q+"%"]
  ).map(x=>({...x,raw:JSON.parse(x.raw_json||"{}")}));
});

ipcMain.handle("nptrans:import", (_event, payload = {}) => {
  const items=Array.isArray(payload.items)?payload.items:[];
  const mode=String(payload.mode||"merge");
  if(!items.length)throw new Error("Tidak ada baris NPTRANS yang valid.");
  if(!["merge","append","replace"].includes(mode))throw new Error("Mode import tidak dikenal.");
  for(const item of items){const date=String(item.transaction_date||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Tanggal NPTRANS tidak valid pada baris "+String(item.source_row_no||"?")+".");const period=rows("SELECT status FROM accounting_periods WHERE period_key=?",[date.slice(0,7)]);if(period.length&&period[0].status==="CLOSED")throw new Error("Import diblokir: periode "+date.slice(0,7)+" sudah ditutup.");}
  const importName=String(payload.file_name||"NPTRANS import");
  const hash=String(payload.source_hash||"");
  let inserted=0,skipped=0;
  db.run("BEGIN IMMEDIATE");
  try{
    if(mode==="replace") db.run("DELETE FROM nptrans_rows");
    db.run("INSERT INTO nptrans_imports(file_name,file_type,source_hash,source_record_count,active_record_count,deleted_record_count,status,summary_json) VALUES(?,?,?,?,?,?,?,?)",
      [importName,String(payload.file_type||"UNKNOWN"),hash,Number(payload.total_read||items.length),items.length,Number(payload.deleted_count||0),"IMPORTED",JSON.stringify({mode})]);
    const importId=db.exec("SELECT last_insert_rowid()")[0].values[0][0];
    const existing=new Set(rows("SELECT sandi,transaction_date,voucher_number,row_number,description,amount FROM nptrans_rows").map(x=>
      [x.sandi,x.transaction_date,x.voucher_number,x.row_number,x.description,Number(x.amount||0).toFixed(2)].join("|").toUpperCase()
    ));
    const stmt=db.prepare("INSERT INTO nptrans_rows(import_id,source_row_no,sandi,transaction_date,voucher_number,row_number,description,amount,raw_json) VALUES(?,?,?,?,?,?,?,?,?)");
    try{
      items.forEach((x,index)=>{
        const key=[x.sandi,x.transaction_date,x.voucher_number,x.row_number,x.description,Number(x.amount||0).toFixed(2)].join("|").toUpperCase();
        if(mode==="merge"&&existing.has(key)){skipped++;return;}
        stmt.run([importId,Number(x.source_row_no||index+1),String(x.sandi||""),String(x.transaction_date||""),String(x.voucher_number||""),String(x.row_number||""),String(x.description||""),Number(x.amount||0),JSON.stringify(x.raw||x)]);
        existing.add(key);inserted++;
      });
    }finally{stmt.free();}
    db.run("UPDATE nptrans_imports SET active_record_count=? WHERE id=?",[inserted,importId]);
    db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary) VALUES('IMPORT_NPTRANS','NPTRANS_IMPORT',?,?)",
      [String(importId),"Import "+importName+": "+inserted+" baris baru, "+skipped+" duplikat dilewati"]);
    db.run("COMMIT");
  }catch(error){db.run("ROLLBACK");throw error;}
  saveDb();return {ok:true,inserted,skipped,total:items.length};
});

ipcMain.handle("imports:opening-balances", (_event, payload = {}) => {
  const items=Array.isArray(payload.items)?payload.items:[];
  if(!items.length)throw new Error("Tidak ada saldo awal valid untuk diimpor.");
  let inserted=0,skipped=0;
  db.run("BEGIN IMMEDIATE");
  try{
    const stmt=db.prepare("INSERT OR IGNORE INTO opening_balances(period_key,account_id,sandi,program_code,debit,credit,source_type,source_reference) VALUES(?,?,?,? ,?,?,?,?)");
    try{
      for(const x of items){
        const period=String(x.period_key||""),sandi=String(x.sandi||"").trim();
        if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||!sandi) {skipped++;continue;}
        const closed=rows("SELECT status FROM accounting_periods WHERE period_key=?",[period]);if(closed.length&&closed[0].status==="CLOSED")throw new Error("Periode "+period+" sudah ditutup; saldo awal tidak diimpor.");
        const acc=rows("SELECT id FROM accounts WHERE sandi=? AND is_active=1",[sandi]);
        if(!acc.length)throw new Error("SANDI "+sandi+" tidak ditemukan atau tidak aktif.");
        stmt.run([period,acc[0].id,sandi,String(x.program_code||""),Number(x.debit||0),Number(x.credit||0),"IMPORT",String(payload.file_name||"")]);
        if(db.getRowsModified())inserted++;else skipped++;
      }
    }finally{stmt.free();}
    db.run("INSERT INTO audit_logs(action,entity_type,summary) VALUES('IMPORT_OPENING_BALANCES','OPENING_BALANCE',?)",
      ["Import saldo awal: "+inserted+" baru, "+skipped+" dilewati"]);
    db.run("COMMIT");
  }catch(error){db.run("ROLLBACK");throw error;}
  saveDb();return {ok:true,inserted,skipped};
});


ipcMain.handle("opening:list", (_event, periodValue = "") => {
  const period=String(periodValue||"");
  const list=rows(
    `SELECT o.id,o.period_key,o.sandi,o.program_code,o.debit,o.credit,a.account_name
     FROM opening_balances o LEFT JOIN accounts a ON a.sandi=o.sandi
     WHERE (?='' OR o.period_key=?) ORDER BY o.period_key DESC,o.sandi,o.program_code`,
    [period,period]
  );
  return list;
});

ipcMain.handle("opening:save", (_event, payload = {}) => {
  const period=String(payload.period_key||"");
  const sandi=String(payload.sandi||"").trim();
  const program=String(payload.program_code||"").trim();
  const debit=Number(payload.debit||0),credit=Number(payload.credit||0);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new Error("Periode saldo awal tidak valid.");
  if(!sandi)throw new Error("SANDI akun wajib dipilih.");
  if(!Number.isFinite(debit)||!Number.isFinite(credit)||debit<0||credit<0||(debit>0&&credit>0)||(!(debit>0)&&!(credit>0)))throw new Error("Isi salah satu nilai debit atau kredit yang positif.");
  const account=rows("SELECT id FROM accounts WHERE sandi=? AND is_active=1",[sandi]);
  if(!account.length)throw new Error("SANDI tidak ditemukan atau tidak aktif.");
  const closed=rows("SELECT status FROM accounting_periods WHERE period_key=?",[period]);
  if(closed.length&&closed[0].status==="CLOSED")throw new Error("Periode sudah ditutup.");
  db.run("INSERT INTO opening_balances(period_key,account_id,sandi,program_code,debit,credit,source_type,updated_at) VALUES(?,?,?,?,?,?, 'MANUAL',CURRENT_TIMESTAMP) ON CONFLICT(period_key,sandi,program_code) DO UPDATE SET debit=excluded.debit,credit=excluded.credit,updated_at=CURRENT_TIMESTAMP",
    [period,account[0].id,sandi,program,debit,credit]);
  db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary) VALUES('SAVE_OPENING_BALANCE','OPENING_BALANCE',?,?)",
    [period+"|"+sandi+"|"+program,"Saldo awal "+sandi+" periode "+period+" disimpan"]);
  saveDb();return {ok:true};
});


function periodIsClosed(date){const key=String(date||"").slice(0,7);return rows("SELECT status FROM accounting_periods WHERE period_key=?",[key]).some(x=>x.status==="CLOSED");}
function audit(action,type,id,summary,before=null,after=null){
  db.run("INSERT INTO audit_logs(action,entity_type,entity_id,summary,before_json,after_json) VALUES(?,?,?,?,?,?)",
    [action,type,String(id??""),summary,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);
}
function totalsForLines(lines){return lines.reduce((a,x)=>({debit:a.debit+Number(x.debit||0),credit:a.credit+Number(x.credit||0)}),{debit:0,credit:0});}

ipcMain.handle("debit-notes:list",(_e,filters={})=>{
 const q="%"+String(filters.keyword||"").trim().toLowerCase()+"%";
 return rows("SELECT * FROM debit_notes WHERE lower(note_number) LIKE ? OR lower(partner_name) LIKE ? OR lower(description) LIKE ? ORDER BY note_date DESC,id DESC",[q,q,q])
 .map(n=>({...n,lines:rows("SELECT * FROM debit_note_lines WHERE debit_note_id=? ORDER BY line_no",[n.id])}));
});
ipcMain.handle("debit-notes:save",(_e,p={})=>{
 const id=Number(p.id||0),number=String(p.note_number||"").trim(),date=String(p.note_date||""),partner=String(p.partner_name||"").trim(),description=String(p.description||"").trim();
 const linesIn=Array.isArray(p.lines)?p.lines:[];
 if(!number||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!partner||!description||linesIn.length<2)throw new Error("Nomor, tanggal, mitra, uraian, dan minimal dua baris wajib diisi.");
 if(periodIsClosed(date))throw new Error("Periode nota debet sudah ditutup.");
 const old=id?rows("SELECT * FROM debit_notes WHERE id=?",[id])[0]:null;
 if(id&&(!old||old.status!=="DRAFT"))throw new Error("Nota yang sudah POSTED/CANCELLED tidak dapat diedit.");
 if(rows("SELECT id FROM debit_notes WHERE note_number=? AND id<>?",[number,id]).length)throw new Error("Nomor nota sudah digunakan.");
 const clean=linesIn.map((x,i)=>{const sandi=String(x.sandi||"").trim(),d=Number(x.debit||0),cr=Number(x.credit||0),a=rows("SELECT id FROM accounts WHERE sandi=? AND is_active=1",[sandi])[0];if(!a||d<0||cr<0||!Number.isFinite(d)||!Number.isFinite(cr)||(d>0&&cr>0))throw new Error("Baris "+(i+1)+" tidak valid.");return {...x,sandi,account_id:a.id,debit:d,credit:cr};});
 const t=totalsForLines(clean);if(Math.abs(t.debit-t.credit)>0.005||t.debit<=0)throw new Error("Nota debet harus seimbang dan bernilai lebih dari nol.");
 db.run("BEGIN IMMEDIATE");try{
  let noteId=id;
  if(id){db.run("UPDATE debit_notes SET note_number=?,note_date=?,note_type=?,partner_name=?,invoice_reference=?,description=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[number,date,String(p.note_type||""),partner,String(p.invoice_reference||""),description,id]);db.run("DELETE FROM debit_note_lines WHERE debit_note_id=?",[id]);}
  else{db.run("INSERT INTO debit_notes(note_number,note_date,note_type,partner_name,invoice_reference,description,status) VALUES(?,?,?,?,?,?,'DRAFT')",[number,date,String(p.note_type||""),partner,String(p.invoice_reference||""),description]);noteId=db.exec("SELECT last_insert_rowid()")[0].values[0][0];}
  const st=db.prepare("INSERT INTO debit_note_lines(debit_note_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
  try{clean.forEach((x,i)=>st.run([noteId,i+1,x.account_id,x.sandi,String(x.description||""),x.debit,x.credit]));}finally{st.free();}
  audit(id?"UPDATE_DEBIT_NOTE":"CREATE_DEBIT_NOTE","DEBIT_NOTE",noteId,"Nota debet "+number);
  db.run("COMMIT");saveDb();return {ok:true,id:noteId};
 }catch(e){db.run("ROLLBACK");throw e;}
});
ipcMain.handle("debit-notes:post",(_e,idValue)=>{
 const id=Number(idValue),n=rows("SELECT * FROM debit_notes WHERE id=?",[id])[0];if(!n||n.status!=="DRAFT")throw new Error("Nota tidak ditemukan atau bukan Draft.");
 if(periodIsClosed(n.note_date))throw new Error("Periode sudah ditutup.");
 const lines=rows("SELECT * FROM debit_note_lines WHERE debit_note_id=? ORDER BY line_no",[id]);const t=totalsForLines(lines);
 if(lines.length<2||Math.abs(t.debit-t.credit)>0.005||t.debit<=0)throw new Error("Nota tidak seimbang.");
 db.run("BEGIN IMMEDIATE");try{
  db.run("INSERT INTO journal_headers(journal_date,voucher_number,description,status,source_type,source_id) VALUES(?,?,?,'POSTED','DEBIT_NOTE',?)",[n.note_date,n.note_number,"Nota Debet "+n.partner_name+" · "+n.description,String(id)]);
  const jid=db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  const st=db.prepare("INSERT INTO journal_lines(journal_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
  try{lines.forEach(x=>st.run([jid,x.line_no,x.account_id,x.sandi,x.description,x.debit,x.credit]));}finally{st.free();}
  db.run("UPDATE journal_headers SET posted_at=CURRENT_TIMESTAMP WHERE id=?",[jid]);
  db.run("UPDATE debit_notes SET status='POSTED',linked_journal_id=?,posted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",[jid,id]);
  audit("POST_DEBIT_NOTE","DEBIT_NOTE",id,"Nota "+n.note_number+" diposting ke jurnal "+jid);
  db.run("COMMIT");saveDb();return {ok:true,journal_id:jid};
 }catch(e){db.run("ROLLBACK");throw e;}
});
ipcMain.handle("debit-notes:cancel",(_e,p={})=>{
 const id=Number(p.id),reason=String(p.reason||"").trim(),n=rows("SELECT * FROM debit_notes WHERE id=?",[id])[0];
 if(!n||n.status==="CANCELLED"||!reason)throw new Error("Nota tidak valid atau alasan pembatalan kosong.");
 if(n.status==="POSTED"||n.linked_journal_id)throw new Error("Nota yang sudah POSTED tidak boleh dibatalkan langsung karena jurnal tertaut sudah masuk pembukuan. Buat jurnal pembalik/koreksi terlebih dahulu.");
 if(periodIsClosed(n.note_date))throw new Error("Periode sudah ditutup.");
 db.run("BEGIN IMMEDIATE");try{db.run("UPDATE debit_notes SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,cancel_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",[reason,id]);audit("CANCEL_DEBIT_NOTE","DEBIT_NOTE",id,"Nota Draft dibatalkan: "+reason);db.run("COMMIT");saveDb();return {ok:true};}catch(e){db.run("ROLLBACK");throw e;}
});

ipcMain.handle("periods:list",()=>rows("SELECT * FROM accounting_periods ORDER BY period_key DESC"));
ipcMain.handle("periods:open",(_e,p={})=>{
 const key=String(p.period_key||"");if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw new Error("Periode harus YYYY-MM.");
 db.run("INSERT INTO accounting_periods(period_key,status,is_active,opened_at) VALUES(?,'OPEN',1,CURRENT_TIMESTAMP) ON CONFLICT(period_key) DO UPDATE SET status=CASE WHEN status='CLOSED' THEN status ELSE 'OPEN' END,is_active=1,opened_at=COALESCE(opened_at,CURRENT_TIMESTAMP)");
 db.run("UPDATE accounting_periods SET is_active=0 WHERE period_key<>?",[key]);audit("OPEN_PERIOD","PERIOD",key,"Periode "+key+" dibuka");saveDb();return {ok:true};
});
ipcMain.handle("periods:close",(_e,p={})=>{
 const key=String(p.period_key||""),note=String(p.note||"").trim();if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))throw new Error("Periode tidak valid.");
 const drafts=rows("SELECT COUNT(*) total FROM journal_headers WHERE substr(journal_date,1,7)=? AND status='DRAFT'",[key])[0].total;
 if(drafts)throw new Error("Tidak dapat menutup periode: masih ada "+drafts+" jurnal Draft.");
 const tb=rows(`SELECT COALESCE(SUM(o.debit-o.credit),0) opening,
 COALESCE(SUM(j.debit),0) debit,COALESCE(SUM(j.credit),0) credit
 FROM accounts a LEFT JOIN opening_balances o ON o.sandi=a.sandi AND o.period_key=?
 LEFT JOIN (SELECT l.sandi,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id WHERE substr(h.journal_date,1,7)=? AND h.status='POSTED' GROUP BY l.sandi) j ON j.sandi=a.sandi`,[key,key]);
 const balances=rows(`SELECT a.sandi,
 COALESCE(o.debit,0)-COALESCE(o.credit,0)+COALESCE(m.debit,0)-COALESCE(m.credit,0) net
 FROM accounts a
 LEFT JOIN (SELECT sandi,SUM(debit) debit,SUM(credit) credit FROM opening_balances WHERE period_key=? GROUP BY sandi) o ON o.sandi=a.sandi
 LEFT JOIN (SELECT l.sandi,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id WHERE substr(h.journal_date,1,7)=? AND h.status='POSTED' GROUP BY l.sandi) m ON m.sandi=a.sandi
 WHERE a.is_active=1`,[key,key]);
 const endingDebit=balances.reduce((s,x)=>s+Math.max(0,Number(x.net||0)),0);
 const endingCredit=balances.reduce((s,x)=>s+Math.max(0,-Number(x.net||0)),0);
 if(Math.abs(endingDebit-endingCredit)>0.005)throw new Error("Neraca Percobaan saldo akhir belum seimbang. Debit "+endingDebit+" · Kredit "+endingCredit+". Periode tidak dapat ditutup.");
 const snap={period:key,postedJournalCount:Number(rows("SELECT COUNT(*) total FROM journal_headers WHERE substr(journal_date,1,7)=? AND status='POSTED'",[key])[0].total),endingDebit,endingCredit,closedAt:new Date().toISOString()};
 db.run("INSERT INTO accounting_periods(period_key,status,is_active,closed_at,closed_by,close_note,close_snapshot_json) VALUES(?,'CLOSED',0,CURRENT_TIMESTAMP,'LOCAL_USER',?,?) ON CONFLICT(period_key) DO UPDATE SET status='CLOSED',is_active=0,closed_at=CURRENT_TIMESTAMP,closed_by='LOCAL_USER',close_note=excluded.close_note,close_snapshot_json=excluded.close_snapshot_json",[key,note,JSON.stringify(snap)]);
 audit("CLOSE_PERIOD","PERIOD",key,"Periode "+key+" ditutup",null,snap);saveDb();return {ok:true,snapshot:snap};
});
ipcMain.handle("periods:reopen",(_e,p={})=>{
 const key=String(p.period_key||""),reason=String(p.reason||"").trim();if(!reason)throw new Error("Alasan buka kembali wajib diisi.");
 const old=rows("SELECT * FROM accounting_periods WHERE period_key=?",[key])[0];if(!old||old.status!=="CLOSED")throw new Error("Periode bukan periode tertutup.");
 db.run("UPDATE accounting_periods SET status='OPEN',opened_at=CURRENT_TIMESTAMP,close_note=? WHERE period_key=?",[reason,key]);audit("REOPEN_PERIOD","PERIOD",key,"Periode dibuka kembali: "+reason,old);saveDb();return {ok:true};
});



ipcMain.handle("journals:correction-draft",(_e,p={})=>{
 const id=Number(p.id),voucher=String(p.voucher_number||"").trim(),date=String(p.journal_date||"");
 const source=rows("SELECT * FROM journal_headers WHERE id=?",[id])[0];if(!source||source.status!=="POSTED")throw new Error("Jurnal sumber harus berstatus POSTED.");
 if(!voucher||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Nomor bukti dan tanggal koreksi wajib diisi.");
 if(periodIsClosed(date))throw new Error("Periode koreksi sudah ditutup.");
 if(rows("SELECT id FROM journal_headers WHERE voucher_number=?",[voucher]).length)throw new Error("Nomor bukti koreksi sudah digunakan.");
 const lines=rows("SELECT * FROM journal_lines WHERE journal_id=? ORDER BY line_no",[id]);
 db.run("BEGIN IMMEDIATE");try{
  db.run("INSERT INTO journal_headers(journal_date,voucher_number,description,status,source_type,source_id,source_voucher) VALUES(?,?,?,'DRAFT','CORRECTION',?,?)",
   [date,voucher,"Koreksi atas "+source.voucher_number,String(id),source.voucher_number]);
  const cid=db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  const st=db.prepare("INSERT INTO journal_lines(journal_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
  try{lines.forEach((x,i)=>st.run([cid,i+1,x.account_id,x.sandi,"Koreksi: "+(x.description||""),x.debit,x.credit]));}finally{st.free();}
  audit("CREATE_CORRECTION_DRAFT","JOURNAL",cid,"Draft koreksi dibuat dari jurnal "+source.voucher_number);
  db.run("COMMIT");saveDb();return {ok:true,id:cid};
 }catch(e){db.run("ROLLBACK");throw e;}
});
ipcMain.handle("journals:reverse",(_e,p={})=>{
 const id=Number(p.id),voucher=String(p.voucher_number||"").trim(),date=String(p.journal_date||""),reason=String(p.reason||"").trim();
 const source=rows("SELECT * FROM journal_headers WHERE id=?",[id])[0];if(!source||source.status!=="POSTED")throw new Error("Jurnal sumber tidak ditemukan atau belum POSTED.");
 if(!voucher||!reason||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Nomor bukti, tanggal, dan alasan wajib diisi.");
 if(periodIsClosed(date))throw new Error("Periode pembalik sudah ditutup.");
 if(rows("SELECT id FROM journal_headers WHERE voucher_number=?",[voucher]).length)throw new Error("Nomor bukti pembalik sudah digunakan.");
 const lines=rows("SELECT * FROM journal_lines WHERE journal_id=? ORDER BY line_no",[id]);
 db.run("BEGIN IMMEDIATE");try{
  db.run("INSERT INTO journal_headers(journal_date,voucher_number,description,status,source_type,source_id,source_voucher,split_from_id,posted_at) VALUES(?,?,?,'POSTED','REVERSAL',?,?,?,CURRENT_TIMESTAMP)",
   [date,voucher,"PEMBALIK "+source.voucher_number+" · "+reason,String(id),source.voucher_number,id]);
  const rid=db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  const st=db.prepare("INSERT INTO journal_lines(journal_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
  try{lines.forEach((x,i)=>st.run([rid,i+1,x.account_id,x.sandi,"Pembalik "+(x.description||""),x.credit,x.debit]));}finally{st.free();}
  audit("CREATE_REVERSAL_JOURNAL","JOURNAL",rid,"Jurnal "+voucher+" membalik "+source.voucher_number);
  db.run("COMMIT");saveDb();return {ok:true,id:rid};
 }catch(e){db.run("ROLLBACK");throw e;}
});
ipcMain.handle("reports:trial-balance",(_e,p={})=>{
 const period=String(p.period_key||"");if(!/^\d{4}-\d{2}$/.test(period))throw new Error("Pilih periode YYYY-MM.");
 return rows(`SELECT a.sandi,a.account_name,a.normal_balance,
 COALESCE(o.debit,0) opening_debit,COALESCE(o.credit,0) opening_credit,
 COALESCE(m.debit,0) movement_debit,COALESCE(m.credit,0) movement_credit,
 COALESCE(o.debit,0)+COALESCE(m.debit,0) debit_total,
 COALESCE(o.credit,0)+COALESCE(m.credit,0) credit_total,
 (COALESCE(o.debit,0)-COALESCE(o.credit,0)+COALESCE(m.debit,0)-COALESCE(m.credit,0)) net_balance
 FROM accounts a
 LEFT JOIN (SELECT sandi,SUM(debit) debit,SUM(credit) credit FROM opening_balances WHERE period_key=? GROUP BY sandi) o ON o.sandi=a.sandi
 LEFT JOIN (SELECT l.sandi,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id WHERE substr(h.journal_date,1,7)=? AND h.status='POSTED' GROUP BY l.sandi) m ON m.sandi=a.sandi
 WHERE a.is_active=1 AND (o.sandi IS NOT NULL OR m.sandi IS NOT NULL)
 ORDER BY a.sandi`,[period,period]);
});
ipcMain.handle("reports:ledger",(_e,p={})=>{
 const sandi=String(p.sandi||"").trim(),from=String(p.date_from||"0000-01-01"),to=String(p.date_to||"9999-12-31");
 if(!sandi)throw new Error("Pilih SANDI akun.");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error("Rentang tanggal Buku Besar tidak valid.");
 const opening=Number(rows("SELECT COALESCE(SUM(debit-credit),0) net FROM opening_balances WHERE sandi=? AND period_key<=?",[sandi,from.slice(0,7)])[0].net||0);
 const before=Number(rows("SELECT COALESCE(SUM(l.debit-l.credit),0) net FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id WHERE l.sandi=? AND h.status='POSTED' AND h.journal_date<?",[sandi,from])[0].net||0);
 const tx=rows(`SELECT h.journal_date,h.voucher_number,h.description journal_description,l.description line_description,l.debit,l.credit,h.id,l.line_no
 FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id
 WHERE l.sandi=? AND h.status='POSTED' AND h.journal_date BETWEEN ? AND ?
 ORDER BY h.journal_date,h.id,l.line_no`,[sandi,from,to]);
 let balance=opening+before;return tx.map(x=>{balance+=Number(x.debit)-Number(x.credit);return {...x,running_balance:balance};});
});
ipcMain.handle("reports:income-summary",(_e,p={})=>{
 const from=String(p.date_from||"0000-01-01"),to=String(p.date_to||"9999-12-31");
 return rows(`SELECT a.sandi,a.account_name,a.account_type,a.normal_balance,SUM(l.debit) debit,SUM(l.credit) credit
 FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id JOIN accounts a ON a.sandi=l.sandi
 WHERE h.status='POSTED' AND h.journal_date BETWEEN ? AND ? GROUP BY a.sandi,a.account_name,a.account_type,a.normal_balance ORDER BY a.sandi`,[from,to]);
});

ipcMain.handle("reports:income-statement",(_e,p={})=>{
 const from=String(p.date_from||""),to=String(p.date_to||"");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error("Rentang tanggal laporan laba rugi tidak valid.");
 const rowsOut=rows(`SELECT a.sandi,a.account_name,a.account_type,a.normal_balance,
 COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit
 FROM accounts a JOIN journal_lines l ON l.sandi=a.sandi JOIN journal_headers h ON h.id=l.journal_id
 WHERE h.status='POSTED' AND h.journal_date BETWEEN ? AND ? AND UPPER(COALESCE(a.account_type,'')) IN ('PENDAPATAN','BEBAN')
 GROUP BY a.sandi,a.account_name,a.account_type,a.normal_balance ORDER BY a.account_type,a.sandi`,[from,to]);
 const result=rowsOut.map(x=>({...x,net: String(x.account_type).toUpperCase()==="PENDAPATAN"?Number(x.credit)-Number(x.debit):Number(x.debit)-Number(x.credit)}));
 const revenue=result.filter(x=>String(x.account_type).toUpperCase()==="PENDAPATAN").reduce((s,x)=>s+x.net,0);
 const expense=result.filter(x=>String(x.account_type).toUpperCase()==="BEBAN").reduce((s,x)=>s+x.net,0);
 return {rows:result,revenue,expense,netProfit:revenue-expense,dateFrom:from,dateTo:to};
});
ipcMain.handle("reports:balance-sheet",(_e,p={})=>{
 const date=String(p.as_of||"");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error("Tanggal posisi neraca tidak valid.");
 const rowsOut=rows(`SELECT a.sandi,a.account_name,a.account_type,a.normal_balance,
 COALESCE(o.debit,0) opening_debit,COALESCE(o.credit,0) opening_credit,
 COALESCE(m.debit,0) movement_debit,COALESCE(m.credit,0) movement_credit
 FROM accounts a
 LEFT JOIN (SELECT sandi,SUM(debit) debit,SUM(credit) credit FROM opening_balances WHERE period_key<=? GROUP BY sandi) o ON o.sandi=a.sandi
 LEFT JOIN (SELECT l.sandi,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_lines l JOIN journal_headers h ON h.id=l.journal_id WHERE h.status='POSTED' AND h.journal_date<=? GROUP BY l.sandi) m ON m.sandi=a.sandi
 WHERE UPPER(COALESCE(a.account_type,'')) IN ('ASET','KEWAJIBAN','EKUITAS') AND (o.sandi IS NOT NULL OR m.sandi IS NOT NULL)
 ORDER BY CASE UPPER(a.account_type) WHEN 'ASET' THEN 1 WHEN 'KEWAJIBAN' THEN 2 ELSE 3 END,a.sandi`,[date.slice(0,7),date]);
 const result=rowsOut.map(x=>{const net=Number(x.opening_debit||0)-Number(x.opening_credit||0)+Number(x.movement_debit||0)-Number(x.movement_credit||0);const type=String(x.account_type).toUpperCase();return {...x,net,display_balance:type==="ASET"?net:-net};});
 const total=type=>result.filter(x=>String(x.account_type).toUpperCase()===type).reduce((s,x)=>s+x.display_balance,0);
 const assets=total("ASET"),liabilities=total("KEWAJIBAN"),equity=total("EKUITAS");
 return {rows:result,assets,liabilities,equity,liabilitiesEquity:liabilities+equity,difference:assets-liabilities-equity,asOf:date};
});
ipcMain.handle("audit:export",async(_e,p={})=>{
 const items=rows("SELECT occurred_at,actor,action,entity_type,entity_id,summary,before_json,after_json,correlation_id FROM audit_logs ORDER BY id");
 if(!items.length)throw new Error("Belum ada data audit untuk diekspor.");
 const csvCell=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
 const csv=["WAKTU,PELAKU,AKSI,ENTITAS,ID ENTITAS,RINGKASAN,SEBELUM,SESUDAH,KORELASI",...items.map(x=>[x.occurred_at,x.actor,x.action,x.entity_type,x.entity_id,x.summary,x.before_json,x.after_json,x.correlation_id].map(csvCell).join(","))].join("\r\n");
 const choice=await dialog.showSaveDialog({title:"Ekspor Audit Log",defaultPath:"SBP-Audit-"+new Date().toISOString().slice(0,10)+".csv",filters:[{name:"CSV",extensions:["csv"]}]});
 if(choice.canceled||!choice.filePath)return {canceled:true};
 fs.writeFileSync(choice.filePath,"\uFEFF"+csv,"utf8");audit("EXPORT_AUDIT","AUDIT",choice.filePath,"Ekspor "+items.length+" baris audit.");saveDb();return {ok:true,count:items.length,path:choice.filePath};
});

ipcMain.handle("validation:run",()=>{
 const issues=[];
 rows("SELECT voucher_number,COUNT(*) n FROM journal_headers GROUP BY voucher_number HAVING COUNT(*)>1").forEach(x=>issues.push({severity:"ERROR",code:"DUPLICATE_VOUCHER",detail:"Nomor bukti "+x.voucher_number+" terduplikasi ("+x.n+")."}));
 rows("SELECT h.id,h.voucher_number,SUM(l.debit) debit,SUM(l.credit) credit FROM journal_headers h JOIN journal_lines l ON l.journal_id=h.id WHERE h.status='POSTED' GROUP BY h.id HAVING ABS(SUM(l.debit)-SUM(l.credit))>0.005").forEach(x=>issues.push({severity:"ERROR",code:"UNBALANCED_POSTED",detail:"Jurnal "+x.voucher_number+" tidak seimbang."}));
 rows("SELECT l.sandi,COUNT(*) n FROM journal_lines l LEFT JOIN accounts a ON a.sandi=l.sandi WHERE a.id IS NULL GROUP BY l.sandi").forEach(x=>issues.push({severity:"WARNING",code:"MISSING_ACCOUNT",detail:"SANDI "+x.sandi+" tidak ditemukan di Master Akun ("+x.n+" baris)."}));
 rows("SELECT h.id,h.voucher_number FROM journal_headers h WHERE h.status='DRAFT' AND substr(h.journal_date,1,7) IN (SELECT period_key FROM accounting_periods WHERE status='CLOSED')").forEach(x=>issues.push({severity:"ERROR",code:"DRAFT_IN_CLOSED_PERIOD",detail:"Draft "+x.voucher_number+" berada di periode tertutup."}));
 audit("RUN_VALIDATION","SYSTEM","", "Validasi dijalankan: "+issues.length+" temuan.");saveDb();return issues;
});
ipcMain.handle("audit:list",(_e,p={})=>{
 const limit=Math.min(1000,Math.max(1,Number(p.limit||300)));
 return rows("SELECT * FROM audit_logs ORDER BY id DESC LIMIT "+limit);
});
ipcMain.handle("print-settings:get",()=>rows("SELECT setting_key,setting_value FROM print_settings ORDER BY setting_key"));
ipcMain.handle("print-settings:save",(_e,p={})=>{
 const entries=Object.entries(p);db.run("BEGIN IMMEDIATE");try{const st=db.prepare("INSERT INTO print_settings(setting_key,setting_value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value,updated_at=CURRENT_TIMESTAMP");try{entries.forEach(([k,v])=>st.run([k,String(v)]));}finally{st.free();}audit("SAVE_PRINT_SETTINGS","PRINT","", "Pengaturan cetak diperbarui.");db.run("COMMIT");}catch(e){db.run("ROLLBACK");throw e;}saveDb();return {ok:true};
});
ipcMain.handle("archive:create",(_e,p={})=>{
 const from=String(p.date_from||""),to=String(p.date_to||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw new Error("Rentang tanggal arsip tidak valid.");
 const data={version:1,createdAt:new Date().toISOString(),dateFrom:from,dateTo:to,accounts:rows("SELECT * FROM accounts"),journals:rows("SELECT * FROM journal_headers WHERE journal_date BETWEEN ? AND ?",[from,to]).map(h=>({...h,lines:rows("SELECT * FROM journal_lines WHERE journal_id=?",[h.id])})),openingBalances:rows("SELECT * FROM opening_balances WHERE period_key BETWEEN ? AND ?",[from.slice(0,7),to.slice(0,7)]),budgets:rows("SELECT * FROM annual_budgets WHERE fiscal_year BETWEEN ? AND ?",[Number(from.slice(0,4)),Number(to.slice(0,4))]),debitNotes:rows("SELECT * FROM debit_notes WHERE note_date BETWEEN ? AND ?",[from,to]),nptrans:rows("SELECT * FROM nptrans_rows WHERE (transaction_date BETWEEN ? AND ?) OR transaction_date IS NULL",[from,to]),audit:rows("SELECT * FROM audit_logs WHERE substr(occurred_at,1,10) BETWEEN ? AND ?",[from,to])};
 const choice=dialog.showSaveDialogSync({title:"Simpan Arsip SBP Accounting",defaultPath:"SBP-Archive-"+from+"-"+to+".json",filters:[{name:"SBP Archive",extensions:["json"]}]});if(!choice)return {canceled:true};
 const archiveText=JSON.stringify(data,null,2);fs.writeFileSync(choice,archiveText,"utf8");const checksum=crypto.createHash("sha256").update(archiveText,"utf8").digest("hex");const count=data.journals.length;
 db.run("INSERT INTO archive_records(archive_name,period_start,period_end,file_path,sha256,record_count,metadata_json) VALUES(?,?,?,?,?,?,?)",["SBP Archive "+from+"-"+to,from,to,choice,checksum,count,JSON.stringify({journals:count,accounts:data.accounts.length,nptrans:(data.nptrans||[]).length,sha256:checksum})]);
 audit("CREATE_ARCHIVE","ARCHIVE",choice,"Arsip "+from+" s.d. "+to+" dibuat.");saveDb();return {ok:true,path:choice,recordCount:count};
});
ipcMain.handle("archive:list",()=>rows("SELECT * FROM archive_records ORDER BY created_at DESC"));
ipcMain.handle("archive:read",async(_e,p={})=>{
 const choice=await dialog.showOpenDialog({title:"Buka Arsip SBP Accounting",properties:["openFile"],filters:[{name:"SBP Archive",extensions:["json"]}]});
 if(choice.canceled||!choice.filePaths[0])return {canceled:true};
 const filePath=choice.filePaths[0],raw=fs.readFileSync(filePath,"utf8");
 let data;try{data=JSON.parse(raw);}catch(e){throw new Error("File arsip bukan JSON yang valid: "+e.message);}
 if(data.version!==1||!Array.isArray(data.journals))throw new Error("Format arsip tidak dikenali.");
 const record=rows("SELECT metadata_json FROM archive_records WHERE file_path=? ORDER BY id DESC LIMIT 1",[filePath])[0];
 if(record&&record.metadata_json){
   let meta={};try{meta=JSON.parse(record.metadata_json);}catch(_){}
   if(meta.sha256){const actual=crypto.createHash("sha256").update(raw,"utf8").digest("hex");if(actual!==meta.sha256)throw new Error("VERIFIKASI GAGAL: checksum SHA-256 arsip berubah atau file rusak. Data tidak dibuka.");}
 }
 const journalLines=data.journals.reduce((n,j)=>n+(Array.isArray(j.lines)?j.lines.length:0),0);
 return {ok:true,verified:Boolean(record&&record.metadata_json&&JSON.parse(record.metadata_json).sha256),metadata:{createdAt:data.createdAt,dateFrom:data.dateFrom,dateTo:data.dateTo,journalCount:data.journals.length,journalLineCount:journalLines,accountCount:(data.accounts||[]).length},data};
});

ipcMain.handle("migration:import-v19", (_event, payload = {}) => {
  const legacy = payload.state || {};
  if (Number(payload.version) !== 19 || !Array.isArray(legacy.accounts) || !Array.isArray(legacy.journals)) {
    throw new Error("File bukan backup SBP Accounting V19 yang dikenali.");
  }
  const accounts = legacy.accounts.map(a => ({
    sandi: String(a.code ?? a.sandi ?? "").trim(),
    name: String(a.name ?? a.account_name ?? "").trim(),
    type: String(a.type ?? a.account_type ?? ""),
    normal: String(a.normalBalance ?? a.normal_balance ?? "DEBIT").toUpperCase() === "KREDIT" ? "KREDIT" : "DEBIT"
  })).filter(a => a.sandi && a.name);
  const accountCodes = new Set([...rows("SELECT sandi FROM accounts").map(x => String(x.sandi)), ...accounts.map(x => x.sandi)]);
  const journals = legacy.journals.map(j => ({
    date: String(j.date ?? j.journal_date ?? "").slice(0,10),
    voucher: String(j.number ?? j.voucher_number ?? "").trim(),
    description: String(j.description ?? "").trim(),
    status: ["posted","POSTED"].includes(j.status) ? "POSTED" : "DRAFT",
    lines: Array.isArray(j.lines) ? j.lines : []
  })).filter(j => j.voucher);
  const invalid = [];
  journals.forEach((j, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(j.date)) invalid.push("Jurnal "+j.voucher+": tanggal tidak valid.");
    if (!j.description) invalid.push("Jurnal "+j.voucher+": keterangan kosong.");
    if (j.lines.length < 2) invalid.push("Jurnal "+j.voucher+": kurang dari dua baris.");
    j.lines.forEach((line, n) => {
      const code = String(line.code ?? line.sandi ?? "").trim();
      const debit = Number(line.debit || 0), credit = Number(line.credit || 0);
      if (!accountCodes.has(code)) invalid.push("Jurnal "+j.voucher+" baris "+(n+1)+": SANDI "+code+" tidak ada di Master Akun.");
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0 || (debit > 0 && credit > 0)) invalid.push("Jurnal "+j.voucher+" baris "+(n+1)+": nominal tidak valid.");
    });
    if (j.status === "POSTED") {
      const d=j.lines.reduce((n,x)=>n+Number(x.debit||0),0), cr=j.lines.reduce((n,x)=>n+Number(x.credit||0),0);
      if (Math.abs(d-cr) > 0.005) invalid.push("Jurnal "+j.voucher+": jurnal POSTED tidak seimbang.");
    }
  });
  const opening = Array.isArray(legacy.openingBalances) ? legacy.openingBalances : [];
  opening.forEach((x,i) => {
    const period=String(x.period ?? x.period_key ?? ""), code=String(x.accountCode ?? x.sandi ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(period)) invalid.push("Saldo awal baris "+(i+1)+": periode tidak valid.");
    if (!accountCodes.has(code)) invalid.push("Saldo awal baris "+(i+1)+": SANDI "+code+" tidak ditemukan.");
  });
  if (invalid.length) throw new Error("Migrasi dibatalkan karena ada "+invalid.length+" masalah. Contoh: "+invalid.slice(0,8).join(" | "));
  let accountInserted=0,journalInserted=0,journalSkipped=0,openingInserted=0,nptransInserted=0;
  db.run("BEGIN IMMEDIATE");
  try {
    for (const a of accounts) {
      if (!rows("SELECT id FROM accounts WHERE sandi=?", [a.sandi]).length) {
        db.run("INSERT INTO accounts(sandi,account_name,account_type,normal_balance,is_active,created_at) VALUES(?,?,?,?,1,CURRENT_TIMESTAMP)", [a.sandi,a.name,a.type,a.normal]); accountInserted++;
      }
    }
    for (const j of journals) {
      if (rows("SELECT id FROM journal_headers WHERE voucher_number=?", [j.voucher]).length) { journalSkipped++; continue; }
      const period=j.date.slice(0,7), closed=rows("SELECT status FROM accounting_periods WHERE period_key=?", [period]);
      if (closed.length && closed[0].status === "CLOSED") throw new Error("Periode "+period+" tertutup; migrasi jurnal dihentikan.");
      db.run("INSERT INTO journal_headers(journal_date,voucher_number,description,status,source_type,created_at,posted_at) VALUES(?,?,?,?, 'V19_MIGRATION',CURRENT_TIMESTAMP,CASE WHEN ?='POSTED' THEN CURRENT_TIMESTAMP ELSE NULL END)", [j.date,j.voucher,j.description,j.status,j.status]);
      const jid=db.exec("SELECT last_insert_rowid()")[0].values[0][0];
      const st=db.prepare("INSERT INTO journal_lines(journal_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
      try { j.lines.forEach((line,i) => { const code=String(line.code ?? line.sandi ?? "").trim(), acc=rows("SELECT id FROM accounts WHERE sandi=?", [code])[0]; st.run([jid,i+1,acc.id,code,String(line.note ?? line.description ?? ""),Number(line.debit||0),Number(line.credit||0)]); }); } finally { st.free(); }
      journalInserted++;
    }
    const os=db.prepare("INSERT OR IGNORE INTO opening_balances(period_key,account_id,sandi,program_code,debit,credit,source_type,source_reference) VALUES(?,?,?,?,?,?,?,?)");
    try { for (const x of opening) { const code=String(x.accountCode ?? x.sandi ?? "").trim(),acc=rows("SELECT id FROM accounts WHERE sandi=?", [code])[0]; os.run([String(x.period ?? x.period_key),acc.id,code,String(x.program ?? x.program_code ?? ""),Number(x.debit||0),Number(x.credit||0),"V19_MIGRATION","Backup V19"]); if(db.getRowsModified()) openingInserted++; } } finally { os.free(); }
    const notes=Array.isArray(legacy.debitNotes)?legacy.debitNotes:[];
    for(const n of notes){
      const number=String(n.number||"").trim(),date=String(n.date||"").slice(0,10),partner=String(n.partner||"").trim(),description=String(n.description||"").trim();
      if(!number||!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)||!partner||!description||rows("SELECT id FROM debit_notes WHERE note_number=?",[number]).length) continue;
      const status=n.status==="posted"?"POSTED":n.status==="cancelled"?"CANCELLED":"DRAFT";
      const linked=rows("SELECT id FROM journal_headers WHERE voucher_number=?",[number])[0];
      db.run("INSERT INTO debit_notes(note_number,note_date,note_type,partner_name,invoice_reference,description,status,linked_journal_id,posted_at,cancelled_at,cancel_reason) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [number,date,String(n.kind||""),partner,String(n.reference||""),description,status,linked?linked.id:null,n.postedAt||null,n.cancelledAt||null,n.cancelReason||null]);
      const noteId=db.exec("SELECT last_insert_rowid()")[0].values[0][0], lines=Array.isArray(n.lines)?n.lines:[];
      const ds=db.prepare("INSERT INTO debit_note_lines(debit_note_id,line_no,account_id,sandi,description,debit,credit) VALUES(?,?,?,?,?,?,?)");
      try{lines.forEach((line,index)=>{const code=String(line.code||"").trim(),acc=rows("SELECT id FROM accounts WHERE sandi=?",[code])[0];if(acc)ds.run([noteId,index+1,acc.id,code,String(line.note||""),Number(line.debit||0),Number(line.credit||0)]);});}finally{ds.free();}
    }
    const budgets=Array.isArray(legacy.annualBudgets)?legacy.annualBudgets:[];
    const bs=db.prepare("INSERT OR IGNORE INTO annual_budgets(fiscal_year,account_id,sandi,month_no,budget_amount,program_code,notes) VALUES(?,?,?,?,?,?,?)");
    try { for(const b of budgets){ const year=Number(b.year ?? b.fiscal_year),code=String(b.accountCode ?? b.sandi ?? "").trim(),acc=rows("SELECT id FROM accounts WHERE sandi=?",[code])[0],monthly=Array.isArray(b.monthly)?b.monthly:(Array.isArray(b.months)?b.months:[]); if(!acc||!Number.isInteger(year)||monthly.length!==12) continue; monthly.forEach((amount,index)=>{const value=Number(amount||0);if(Number.isFinite(value)&&value>=0)bs.run([year,acc.id,code,index+1,value,String(b.programCode||""),String(b.notes||"")]);}); } } finally { bs.free(); }
    if(legacy.npTemplate&&Array.isArray(legacy.npTemplate.fields)&&legacy.npTemplate.fields.length){
      db.run("UPDATE nptrans_templates SET is_active=0");
      db.run("INSERT INTO nptrans_templates(template_name,file_version,fields_json,is_active) VALUES(?,?,?,1)",["Template NPTRANS V19",Number(legacy.npTemplate.version||3),JSON.stringify(legacy.npTemplate.fields)]);
    }
    const np=Array.isArray(legacy.nptrans)?legacy.nptrans:[];
    const ns=db.prepare("INSERT INTO nptrans_rows(sandi,transaction_date,voucher_number,row_number,description,amount,raw_json) VALUES(?,?,?,?,?,?,?)");
    try { for(const x of np) { const date=String(x.tanggal ?? x.transaction_date ?? ""); const iso=/^\d{4}-\d{2}-\d{2}$/.test(date)?date:(/^\d{8}$/.test(date)?date.slice(0,4)+"-"+date.slice(4,6)+"-"+date.slice(6,8):""); if(!iso) continue; ns.run([String(x.sandi||""),iso,String(x.nobukti ?? x.voucher_number ?? ""),String(x.nourut ?? x.row_number ?? ""),String(x.ket ?? x.description ?? ""),Number(x.jumlah ?? x.amount ?? 0),JSON.stringify(x)]); nptransInserted++; } } finally { ns.free(); }
    db.run("INSERT INTO audit_logs(action,entity_type,summary) VALUES('MIGRATE_V19','MIGRATION',?)", ["Migrasi V19: "+accountInserted+" akun, "+journalInserted+" jurnal, "+openingInserted+" saldo awal, "+nptransInserted+" NPTRANS; "+journalSkipped+" jurnal dilewati karena nomor bukti sudah ada."]);
    db.run("COMMIT");
  } catch(error) { db.run("ROLLBACK"); throw error; }
  saveDb();
  return {ok:true,accountInserted,journalInserted,journalSkipped,openingInserted,nptransInserted};
});

ipcMain.handle("db:restore",async()=>{
 const choice=await dialog.showOpenDialog({title:"Pilih Backup Database untuk Dipulihkan",properties:["openFile"],filters:[{name:"SQLite Database",extensions:["db"]}]});
 if(choice.canceled||!choice.filePaths[0])return {canceled:true};
 const bytes=fs.readFileSync(choice.filePaths[0]);let test;
 try{test=new SQL.Database(bytes);test.run("PRAGMA integrity_check");const check=test.exec("PRAGMA integrity_check");if(!check.length||check[0].values[0][0]!=="ok")throw new Error("Pemeriksaan integritas SQLite gagal.");const tables=test.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='journal_headers'");if(!tables.length)throw new Error("File bukan database SBP Accounting.");}
 catch(e){if(test)test.close();throw new Error("Backup tidak valid: "+e.message);}
 const safety=path.join(path.dirname(dbPath),"before-restore-"+Date.now()+".db");saveDb();fs.copyFileSync(dbPath,safety);
 try{db.close();fs.copyFileSync(choice.filePaths[0],dbPath);db=new SQL.Database(fs.readFileSync(dbPath));db.run("PRAGMA foreign_keys = ON");applySchemaMigrations();saveDb();return {ok:true,safetyBackup:safety};}
 catch(e){try{if(db)db.close();fs.copyFileSync(safety,dbPath);db=new SQL.Database(fs.readFileSync(dbPath));db.run("PRAGMA foreign_keys = ON");}catch(_){}throw new Error("Pemulihan gagal; database sebelum restore dipulihkan. "+e.message);}
});
ipcMain.handle("db:auto-backup", () => createAutomaticBackup(true));
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
