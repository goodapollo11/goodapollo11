'use strict';
// NurzWorks HQ - database layer (built-in node:sqlite, no dependencies). Same conventions as the NurzWorks CMMS.
process.removeAllListeners('warning');
process.on('warning', w => { if (w.name !== 'ExperimentalWarning') console.warn(w); });

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.NW_DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_PATH = path.join(DATA_DIR, 'nurzworks-hq.db');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
// digits('(262) 555-0123') -> '2625550123' so phone searches match however numbers were typed
db.function('digits', { deterministic: true }, s => (s == null ? '' : String(s).replace(/\D/g, '')));

const now = () => new Date().toISOString();

// node:sqlite rejects undefined values and unknown named parameters, so bind only what each statement uses.
const stmtCache = new Map();
function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    const names = new Set([...sql.replace(/'[^']*'/g, '').matchAll(/:([A-Za-z_]\w*)/g)].map(m => m[1]));
    s = { stmt: db.prepare(sql), names };
    if (stmtCache.size > 800) stmtCache.clear();
    stmtCache.set(sql, s);
  }
  return s;
}
function bind(names, obj) {
  const o = {};
  for (const k of names) { const v = obj[k]; o[k] = v === undefined ? null : (typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  return o;
}
const all = (sql, p = {}) => { const s = prep(sql); return s.stmt.all(bind(s.names, p)).map(r => ({ ...r })); };
const get = (sql, p = {}) => { const s = prep(sql); const r = s.stmt.get(bind(s.names, p)); return r ? { ...r } : null; };
const run = (sql, p = {}) => { const s = prep(sql); return s.stmt.run(bind(s.names, p)); };
const val = (sql, p = {}) => { const r = get(sql, p); return r ? Object.values(r)[0] : null; };
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn(); // nested: join the outer transaction
  db.exec('BEGIN IMMEDIATE'); txDepth++;
  try { const r = fn(); txDepth--; db.exec('COMMIT'); return r; } catch (e) { txDepth--; db.exec('ROLLBACK'); throw e; }
}
// A blank form field arrives as null. For NOT NULL columns that means "use the column default"
// (0 for amounts, '' for text) instead of failing the write.
const colInfo = new Map();
function defaultsFor(table) {
  let m = colInfo.get(table);
  if (!m) {
    m = new Map();
    for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) {
      if (!c.notnull || c.dflt_value === null) continue;
      const d = String(c.dflt_value);
      m.set(c.name, /^'.*'$/s.test(d) ? d.slice(1, -1).replace(/''/g, "'") : Number(d));
    }
    colInfo.set(table, m);
  }
  return m;
}
function withDefaults(table, obj) {
  const d = defaultsFor(table); const o = { ...obj };
  for (const k of Object.keys(o)) if (o[k] === null && d.has(k)) o[k] = d.get(k);
  return o;
}
// insert helper: columns taken from the object keys
function insert(table, obj) {
  const o = withDefaults(table, obj);
  const cols = Object.keys(o).filter(k => o[k] !== undefined);
  const info = run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(c => ':' + c).join(',')})`, o);
  return Number(info.lastInsertRowid);
}
function update(table, id, obj) {
  const o = withDefaults(table, obj);
  const cols = Object.keys(o).filter(k => o[k] !== undefined && k !== 'id');
  if (!cols.length) return 0;
  return run(`UPDATE ${table} SET ${cols.map(c => `${c}=:${c}`).join(', ')} WHERE id=:id`, { ...o, id }).changes;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'field',
  kind TEXT NOT NULL DEFAULT 'human',
  title TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  cost_rate REAL NOT NULL DEFAULT 0,
  bill_rate REAL NOT NULL DEFAULT 0,
  password_hash TEXT,
  theme TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(lower(email)) WHERE email != '';

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT 'read,write',
  last_used_at TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  revoked_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'residential',
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  alt_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  billing_street TEXT NOT NULL DEFAULT '',
  billing_city TEXT NOT NULL DEFAULT '',
  billing_state TEXT NOT NULL DEFAULT '',
  billing_zip TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tax_exempt INTEGER NOT NULL DEFAULT 0,
  terms_days INTEGER,
  portal_token TEXT NOT NULL UNIQUE,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_customers_email ON customers(lower(email));

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_contacts_customer ON contacts(customer_id);

CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  access_notes TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_locations_customer ON locations(customer_id);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL DEFAULT '',
  details TEXT NOT NULL DEFAULT '',
  preferred_date TEXT,
  preferred_time TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_id INTEGER,
  estimate_id INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pricebook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'service',
  unit TEXT NOT NULL DEFAULT 'ea',
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_type TEXT NOT NULL,
  parent_id INTEGER NOT NULL,
  pricebook_id INTEGER REFERENCES pricebook(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'service',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '',
  unit_price REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT '',
  source_id INTEGER,
  invoice_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_li_parent ON line_items(parent_type, parent_id);

CREATE TABLE IF NOT EXISTS estimates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date TEXT NOT NULL,
  expiry_date TEXT,
  message TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  job_id INTEGER,
  request_id INTEGER,
  public_token TEXT NOT NULL UNIQUE,
  sent_at TEXT,
  viewed_at TEXT,
  approved_at TEXT,
  approved_name TEXT NOT NULL DEFAULT '',
  declined_at TEXT,
  decline_reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_estimates_customer ON estimates(customer_id);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'service',
  status TEXT NOT NULL DEFAULT 'unscheduled',
  priority TEXT NOT NULL DEFAULT 'normal',
  billing TEXT NOT NULL DEFAULT 'fixed',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  hold_reason TEXT NOT NULL DEFAULT '',
  completion_notes TEXT NOT NULL DEFAULT '',
  customer_po TEXT NOT NULL DEFAULT '',
  budget_hours REAL NOT NULL DEFAULT 0,
  budget_amount REAL NOT NULL DEFAULT 0,
  estimate_id INTEGER,
  plan_id INTEGER,
  request_id INTEGER,
  completed_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS ix_jobs_customer ON jobs(customer_id);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  notes TEXT NOT NULL DEFAULT '',
  en_route_at TEXT,
  arrived_at TEXT,
  completed_at TEXT,
  arrive_lat REAL,
  arrive_lng REAL,
  complete_lat REAL,
  complete_lng REAL,
  completion_notes TEXT NOT NULL DEFAULT '',
  gcal_event_id TEXT,
  gcal_synced_at TEXT,
  gcal_error TEXT NOT NULL DEFAULT '',
  reminder_sent_at TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_visits_start ON visits(start_at);
CREATE INDEX IF NOT EXISTS ix_visits_job ON visits(job_id);

CREATE TABLE IF NOT EXISTS visit_assignees (
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (visit_id, user_id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  visit_id INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  work_date TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  hours REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'labor',
  description TEXT NOT NULL DEFAULT '',
  billable INTEGER NOT NULL DEFAULT 1,
  bill_rate REAL NOT NULL DEFAULT 0,
  cost_rate REAL NOT NULL DEFAULT 0,
  invoice_id INTEGER,
  start_lat REAL,
  start_lng REAL,
  end_lat REAL,
  end_lng REAL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_time_user ON time_entries(user_id, work_date);
CREATE INDEX IF NOT EXISTS ix_time_job ON time_entries(job_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'materials',
  vendor TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  miles REAL NOT NULL DEFAULT 0,
  billable INTEGER NOT NULL DEFAULT 0,
  markup_pct REAL NOT NULL DEFAULT 0,
  invoice_id INTEGER,
  receipt_id INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  terms TEXT NOT NULL DEFAULT '',
  internal_notes TEXT NOT NULL DEFAULT '',
  customer_po TEXT NOT NULL DEFAULT '',
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  balance REAL NOT NULL DEFAULT 0,
  public_token TEXT NOT NULL UNIQUE,
  sent_at TEXT,
  viewed_at TEXT,
  paid_at TEXT,
  voided_at TEXT,
  last_reminder_at TEXT,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  overdue_notified_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS ix_invoices_status ON invoices(status, due_date);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'check',
  reference TEXT NOT NULL DEFAULT '',
  received_on TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  external_id TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_payments_date ON payments(received_on);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL DEFAULT 'maintenance',
  interval_value INTEGER NOT NULL DEFAULT 1,
  interval_unit TEXT NOT NULL DEFAULT 'month',
  next_due TEXT NOT NULL,
  lead_days INTEGER NOT NULL DEFAULT 14,
  visit_time TEXT NOT NULL DEFAULT '09:00',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auto_schedule INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0,
  checklist TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  end_date TEXT,
  last_generated TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  due_date TEXT,
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  related_type TEXT NOT NULL DEFAULT '',
  related_id INTEGER,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  result TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_by_id INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_tasks_assignee ON tasks(assigned_to, status);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  customer_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'note',
  author TEXT NOT NULL DEFAULT 'System',
  author_id INTEGER,
  via TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_activity_entity ON activity(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS ix_activity_customer ON activity(customer_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  customer_id INTEGER,
  kind TEXT NOT NULL DEFAULT 'file',
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  stored TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_attach_entity ON attachments(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS email_threads (
  thread_id TEXT PRIMARY KEY,
  history_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '',
  last_date TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  unread INTEGER NOT NULL DEFAULT 0,
  labels TEXT NOT NULL DEFAULT '',
  customer_id INTEGER,
  job_id INTEGER,
  linked_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_email_customer ON email_threads(customer_id);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  calendar_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  transparency TEXT NOT NULL DEFAULT '',
  html_link TEXT NOT NULL DEFAULT '',
  visit_id INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_calevents_start ON calendar_events(start_at);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  last_error TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_outbox_pending ON outbox(status, next_at);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '*',
  secret TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_status TEXT NOT NULL DEFAULT '',
  last_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  key_id INTEGER,
  via TEXT NOT NULL DEFAULT '',
  op TEXT NOT NULL DEFAULT '',
  status INTEGER NOT NULL DEFAULT 200,
  ms INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_api_calls_user ON api_calls(user_id, created_at);

CREATE TABLE IF NOT EXISTS kpi_snapshots (
  period TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  generated_at TEXT NOT NULL
);
`;

const SCHEMA_VERSION = 1;

function setting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key=:key', { key });
  return r ? r.value : fallback;
}
function setSetting(key, value) {
  if (value === null || value === undefined) { run('DELETE FROM settings WHERE key=:key', { key }); return; }
  run('INSERT INTO settings(key,value) VALUES(:key,:value) ON CONFLICT(key) DO UPDATE SET value=excluded.value', { key, value: String(value) });
}
// Sequential document numbers (JOB-00001). Counter lives in settings like the CMMS.
function nextNumber(prefix, key) {
  return tx(() => {
    const k = 'seq_' + key;
    let n = Number(setting(k, '0')) + 1;
    setSetting(k, n);
    return `${prefix}-${String(n).padStart(5, '0')}`;
  });
}

const DEFAULTS = {
  company_name: 'NurzWorks',
  company_tagline: 'Mobile service & consulting',
  company_email: '',
  company_phone: '',
  company_address: '',
  company_website: '',
  timezone: process.env.NW_TIMEZONE || 'America/Chicago',
  currency: 'USD',
  tax_rate: '0',
  default_terms_days: '14',
  default_bill_rate: '95',
  default_cost_rate: '35',
  mileage_rate: '0.70',
  estimate_valid_days: '30',
  estimate_terms: 'Estimate valid for 30 days. Pricing may change if the scope of work changes.',
  invoice_terms: 'Payment due by the due date. Thank you for your business!',
  invoice_message: 'Thanks for choosing us. Your invoice is below.',
  estimate_message: 'Thanks for the opportunity. Here is our estimate for the work we discussed.',
  workday_start: '08:00',
  workday_end: '17:00',
  default_visit_minutes: '60',
  auto_job_on_approval: '1',
  auto_reminders: '0',
  reminder_days: '3,10,30',
  estimate_followup_days: '3',
  theme_default: 'nurzworks',
  base_url: '',
  cmms_url: ''
};

function init() {
  db.exec(SCHEMA);
  const v = Number(get('PRAGMA user_version').user_version || 0);
  // future migrations: if (v < 2) { ... }
  if (v < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  for (const [k, val] of Object.entries(DEFAULTS)) if (setting(k) === null) setSetting(k, val);
}

module.exports = { db, all, get, run, val, tx, insert, update, now, setting, setSetting, nextNumber, init, DB_PATH, DATA_DIR, UPLOAD_DIR, DEFAULTS };
