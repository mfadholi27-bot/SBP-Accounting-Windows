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
        if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(period)||!sandi) {skipped++;continue;}
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
  if(!/^\\d{4}-(0[1-9]|1[0-2])$/.test(period))throw new Error("Periode saldo awal tidak valid.");
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
