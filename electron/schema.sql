PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  description TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sandi TEXT NOT NULL UNIQUE,
  account_name TEXT NOT NULL,
  account_type TEXT,
  normal_balance TEXT NOT NULL DEFAULT 'DEBIT' CHECK(normal_balance IN ('DEBIT','KREDIT')),
  parent_sandi TEXT,
  account_group TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  period_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CLOSED')),
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  opened_at TEXT,
  closed_at TEXT,
  closed_by TEXT,
  close_note TEXT,
  close_snapshot_json TEXT
);

CREATE TABLE IF NOT EXISTS journal_headers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_date TEXT NOT NULL,
  voucher_number TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
  source_type TEXT,
  source_id TEXT,
  source_voucher TEXT,
  split_from_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  posted_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  FOREIGN KEY(split_from_id) REFERENCES journal_headers(id)
);

CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  journal_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL DEFAULT 1,
  account_id INTEGER,
  sandi TEXT NOT NULL,
  description TEXT,
  debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
  FOREIGN KEY(journal_id) REFERENCES journal_headers(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CHECK(NOT (debit > 0 AND credit > 0))
);

CREATE TABLE IF NOT EXISTS opening_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_key TEXT NOT NULL,
  account_id INTEGER,
  sandi TEXT NOT NULL,
  program_code TEXT,
  debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
  source_type TEXT,
  source_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  UNIQUE(period_key, sandi, program_code)
);

CREATE TABLE IF NOT EXISTS annual_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiscal_year INTEGER NOT NULL,
  account_id INTEGER,
  sandi TEXT NOT NULL,
  month_no INTEGER NOT NULL CHECK(month_no BETWEEN 1 AND 12),
  budget_amount REAL NOT NULL DEFAULT 0 CHECK(budget_amount >= 0),
  program_code TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  UNIQUE(fiscal_year, sandi, month_no, program_code)
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_number TEXT NOT NULL UNIQUE,
  note_date TEXT NOT NULL,
  note_type TEXT,
  partner_name TEXT NOT NULL,
  invoice_reference TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED','CANCELLED')),
  linked_journal_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  posted_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT,
  FOREIGN KEY(linked_journal_id) REFERENCES journal_headers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS debit_note_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debit_note_id INTEGER NOT NULL,
  line_no INTEGER NOT NULL,
  account_id INTEGER,
  sandi TEXT NOT NULL,
  description TEXT,
  debit REAL NOT NULL DEFAULT 0 CHECK(debit >= 0),
  credit REAL NOT NULL DEFAULT 0 CHECK(credit >= 0),
  FOREIGN KEY(debit_note_id) REFERENCES debit_notes(id) ON DELETE CASCADE,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  CHECK(NOT (debit > 0 AND credit > 0))
);

CREATE TABLE IF NOT EXISTS nptrans_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_hash TEXT,
  source_record_count INTEGER NOT NULL DEFAULT 0,
  active_record_count INTEGER NOT NULL DEFAULT 0,
  deleted_record_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PREVIEW',
  mapping_json TEXT,
  summary_json TEXT
);

CREATE TABLE IF NOT EXISTS nptrans_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER,
  source_row_no INTEGER,
  journal_id INTEGER,
  sandi TEXT,
  transaction_date TEXT,
  voucher_number TEXT,
  row_number TEXT,
  description TEXT,
  amount REAL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY(import_id) REFERENCES nptrans_imports(id) ON DELETE SET NULL,
  FOREIGN KEY(journal_id) REFERENCES journal_headers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS nptrans_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_name TEXT NOT NULL,
  file_version INTEGER,
  fields_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor TEXT NOT NULL DEFAULT 'LOCAL_USER',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  before_json TEXT,
  after_json TEXT,
  correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS archive_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_name TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  file_path TEXT,
  sha256 TEXT,
  record_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS print_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS app_preferences (
  preference_key TEXT PRIMARY KEY,
  preference_value TEXT NOT NULL,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_journal_date_status ON journal_headers(journal_date, status);
CREATE INDEX IF NOT EXISTS idx_journal_voucher ON journal_headers(voucher_number);
CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(sandi, journal_id);
CREATE INDEX IF NOT EXISTS idx_opening_period_account ON opening_balances(period_key, sandi);
CREATE INDEX IF NOT EXISTS idx_budget_year_account ON annual_budgets(fiscal_year, sandi, month_no);
CREATE INDEX IF NOT EXISTS idx_nptrans_voucher ON nptrans_rows(transaction_date, voucher_number);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(occurred_at);
