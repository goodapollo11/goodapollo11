'use strict';
// NurzWorks HQ - shared helpers: errors, coercion, validation, time zones, CSV, HTML escaping.
const crypto = require('crypto');

// ---------------- errors ----------------
class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; if (extra) this.extra = extra; }
}
const bad = msg => { throw new HttpError(400, msg); };
const notFound = (what = 'Record') => { throw new HttpError(404, `${what} not found.`); };
const forbidden = (msg = 'You do not have permission to do that.') => { throw new HttpError(403, msg); };
const conflict = msg => { throw new HttpError(409, msg); };

// ---------------- coercion ----------------
const str = v => (v == null ? '' : String(v).trim());
const num = (v, d = 0) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));
const idOrNull = v => (v === '' || v == null || v === 'null' || Number(v) === 0 || isNaN(Number(v)) ? null : Number(v));
// strict: rejects impossible dates like 2026-02-30 (JavaScript would silently roll them into March)
const isDate = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};
const dateOrNull = v => (isDate(v) ? v : null);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const round2 = n => Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
const round = (n, d = 1) => (n == null || isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);
const bool = v => v === true || v === 1 || v === '1' || v === 'true' || v === 'on' || v === 'yes';
const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; };
const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const now = () => new Date().toISOString();
const normEmail = v => str(v).toLowerCase();
const emailOk = v => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(v);
const titleCase = s => str(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ---------------- time zones (Intl, no libraries) ----------------
// All stored timestamps are UTC ISO strings. Business dates ("work_date", "due_date") are local YYYY-MM-DD
// in the business time zone, which is a setting (default America/Chicago).
const dtfCache = new Map();
function dtf(tz) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    dtfCache.set(tz, f);
  }
  return f;
}
function validTz(tz) { try { dtf(tz); return true; } catch (_) { return false; } }
function zonedParts(date, tz) {
  const p = {}; for (const x of dtf(tz).formatToParts(date)) p[x.type] = x.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second, weekday: p.weekday,
    date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
// minutes that local time is ahead of UTC at this instant
function tzOffset(date, tz) {
  const p = zonedParts(date, tz);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = String(timeStr || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const off1 = tzOffset(new Date(guess), tz);
  let t = guess - off1 * 60000;
  const off2 = tzOffset(new Date(t), tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}
const localDate = (date, tz) => zonedParts(date instanceof Date ? date : new Date(date), tz).date;
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((Date.UTC(...b.split('-').map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(...a.split('-').map((x, i) => i === 1 ? x - 1 : +x))) / 864e5); }
function addInterval(dateStr, value, unit) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const daysIn = x => new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  if (unit === 'day') dt.setUTCDate(dt.getUTCDate() + value);
  else if (unit === 'week') dt.setUTCDate(dt.getUTCDate() + 7 * value);
  else if (unit === 'month') { dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() + value); dt.setUTCDate(Math.min(d, daysIn(dt))); }
  else if (unit === 'year') { dt.setUTCDate(1); dt.setUTCFullYear(dt.getUTCFullYear() + value); dt.setUTCDate(Math.min(d, daysIn(dt))); }
  return dt.toISOString().slice(0, 10);
}
// Accepts: ISO with offset or Z ("2026-11-18T09:00:00-06:00"), local wall time ("2026-11-18T09:00", "2026-11-18 9:00"),
// or a plain date ("2026-11-18" -> 00:00 local). Wall times are read in the business time zone.
function parseWhen(v, tz) {
  if (v instanceof Date) return v;
  const s = str(v);
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && /\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return isNaN(d) ? null : d; }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  if (!isDate(m[1])) return null;
  return zonedToUtc(m[1], `${m[2] || '00'}:${m[3] || '00'}:${m[4] || '00'}`, tz);
}
function monthKey(date) { return date.slice(0, 7); }
function monthRange(period) {
  const [y, m] = period.split('-').map(Number);
  return { start: `${period}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}
function prevMonth(period, n = 1) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 7);
}
function fmtLocal(iso, tz, opts = {}) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts });
}
function fmtDate(dateStr, opts = {}) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...opts });
}
function fmtMoney(v, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
}

// ---------------- JSON-schema subset validator (with lenient coercion for query strings and AI callers) ----------------
// Supports: type (incl. arrays of types), enum, format(date|date-time|email|time), minimum, maximum, minLength,
// maxLength, items, properties, required, default. Unknown keys are kept.
function typeOf(v) { return v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v; }
function coerce(schema, v) {
  const types = [].concat(schema.type || []);
  if (v === undefined) return v;
  if (types.includes('string') && (typeof v === 'number' || typeof v === 'boolean')) return String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '' && (!types.includes('string') || ['date', 'date-time', 'time'].includes(schema.format))) return null; // a cleared date field means "no date"
    if ((types.includes('number') || types.includes('integer')) && t !== '' && !isNaN(Number(t)) && !types.includes('string')) return Number(t);
    if (types.includes('boolean') && !types.includes('string')) {
      if (['true', '1', 'yes', 'on'].includes(t.toLowerCase())) return true;
      if (['false', '0', 'no', 'off'].includes(t.toLowerCase())) return false;
    }
    if (types.includes('array') && !types.includes('string')) {
      if (t.startsWith('[')) { try { return JSON.parse(t); } catch (_) { /* fall through */ } }
      return t ? t.split(',').map(x => x.trim()).filter(Boolean) : [];
    }
    if (types.includes('object') && t.startsWith('{')) { try { return JSON.parse(t); } catch (_) { /* fall through */ } }
  }
  if ((types.includes('integer') || types.includes('number')) && typeof v === 'boolean') return v ? 1 : 0;
  if (types.includes('boolean') && typeof v === 'number') return v !== 0;
  return v;
}
function validate(schema, value, path = '') {
  if (!schema) return value;
  let v = coerce(schema, value);
  if (v === undefined) { if (schema.default !== undefined) v = JSON.parse(JSON.stringify(schema.default)); else return v; }
  const types = [].concat(schema.type || []);
  const label = path || 'value';
  if (v === null) {
    if (!types.length || types.includes('null')) return null;
    // null for optional scalar fields means "clear" - allow it; required checks happen at the object level
    return null;
  }
  if (types.length) {
    const t = typeOf(v);
    const ok = types.some(x => x === t || (x === 'integer' && t === 'number' && Number.isInteger(v)) || (x === 'number' && t === 'number'));
    if (!ok) bad(`${label} must be ${types.filter(x => x !== 'null').join(' or ')}.`);
  }
  if (schema.enum && !schema.enum.includes(v)) bad(`${label} must be one of: ${schema.enum.join(', ')}.`);
  if (typeof v === 'number') {
    if (!isFinite(v)) bad(`${label} must be a finite number.`);
    if (schema.minimum !== undefined && v < schema.minimum) bad(`${label} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && v > schema.maximum) bad(`${label} must be at most ${schema.maximum}.`);
  }
  if (typeof v === 'string') {
    if (schema.maxLength && v.length > schema.maxLength) bad(`${label} is too long (max ${schema.maxLength} characters).`);
    if (schema.minLength && v.trim().length < schema.minLength) bad(`${label} is required.`);
    if (v !== '' && schema.format === 'date' && !isDate(v)) bad(`${label} must be a date like 2026-03-15.`);
    if (v !== '' && schema.format === 'time' && !/^\d{1,2}:\d{2}$/.test(v)) bad(`${label} must be a time like 09:30.`);
    if (v !== '' && schema.format === 'date-time' && !(/^\d{4}-\d{2}-\d{2}([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})?)?$/.test(v.trim()))) bad(`${label} must be a date-time like 2026-03-15T09:30 (business time zone) or ISO 8601 with offset.`);
    if (v !== '' && schema.format === 'email' && !emailOk(v.trim())) bad(`${label} must be a valid email address.`);
  }
  if (Array.isArray(v)) {
    if (schema.maxItems && v.length > schema.maxItems) bad(`${label} has too many items (max ${schema.maxItems}).`);
    if (schema.items) v = v.map((x, i) => validate(schema.items, x, `${label}[${i}]`));
  }
  if (typeOf(v) === 'object' && schema.properties) {
    const out = { ...v };
    for (const [k, s] of Object.entries(schema.properties)) {
      const r = validate(s, v[k], path ? `${path}.${k}` : k);
      if (r !== undefined) out[k] = r; else delete out[k];
    }
    for (const k of schema.required || []) {
      const x = out[k];
      if (x === undefined || x === null || (typeof x === 'string' && x.trim() === '')) bad(`${path ? path + '.' : ''}${k} is required.`);
    }
    return out;
  }
  return v;
}

// ---------------- output helpers ----------------
const escHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = v => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s) && isNaN(Number(s))) s = "'" + s; // neutralize spreadsheet formula injection
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}
const addressLine = l => l ? [l.street, l.city, [l.state, l.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

module.exports = {
  HttpError, bad, notFound, forbidden, conflict,
  str, num, idOrNull, isDate, dateOrNull, oneOf, round2, round, bool, pick, token, sha256, now, normEmail, emailOk, titleCase,
  validTz, zonedParts, tzOffset, zonedToUtc, localDate, addDays, daysBetween, addInterval, parseWhen, monthKey, monthRange, prevMonth,
  fmtLocal, fmtDate, fmtMoney, validate, escHtml, toCsv, addressLine
};
