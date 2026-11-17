'use strict';
// HTTP plumbing (no framework): auth, CSRF, security headers, JSON ops, uploads, downloads, OAuth, Slack, MCP, static files.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const D = require('./db');
const { all, get, setting, setSetting, now } = D;
const { HttpError, str, toCsv, normEmail, sha256 } = require('./util');
const AU = require('./auth');
const { match, execute, userCtx, permitted, BY_NAME } = require('./ops');
const { rememberBaseUrl, baseUrl, today } = require('./config');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self' blob: about:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=(), payment=()', 'Content-Security-Policy': CSP };
const COOKIE = 'nw_session';

// ---------------- small helpers ----------------
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  if (res.headersSent) return;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(code, { ...SEC, 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': buf.length, ...extra });
  res.end(buf);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let done = false;
    req.on('data', c => { if (done) return; size += c.length; if (size > limit) { done = true; reject(new HttpError(413, 'Request too large.')); req.resume(); } else chunks.push(c); });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', e => { if (!done) { done = true; reject(e); } });
  });
}
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
  return out;
}
function isHttps(req) {
  return !!(req.socket && req.socket.encrypted) || (process.env.NW_TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https')) || baseUrl().startsWith('https://');
}
function originOf(req) {
  const proto = process.env.NW_TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : (req.socket && req.socket.encrypted ? 'https' : 'http');
  const host = (process.env.NW_TRUST_PROXY && req.headers['x-forwarded-host']) || req.headers.host;
  return host ? `${proto}://${host}` : '';
}
function sessionCookie(req, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`;
}
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  return o === originOf(req) || o === baseUrl();
}

// ---------------- authentication ----------------
function authFrom(req) {
  const h = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(h)) {
    const r = AU.resolveApiKey(h.replace(/^Bearer\s+/i, '').trim());
    if (!r) throw new HttpError(401, 'Invalid or revoked API key.');
    return userCtx(r.user, 'api', r.key, AU.scopesFor(r.user, r.key));
  }
  const t = parseCookies(req)[COOKIE];
  const u = t ? AU.resolveSession(t) : null;
  return u ? { ...userCtx(u, 'ui'), session: t } : null;
}
function requireAuth(req, { csrf = false } = {}) {
  const ctx = authFrom(req);
  if (!ctx) throw new HttpError(401, 'Sign in required.');
  if (csrf && ctx.via === 'ui' && (req.headers['x-nw-request'] !== '1' || !sameOrigin(req))) throw new HttpError(403, 'Request blocked (missing app header).');
  return ctx;
}

// ---------------- session endpoints ----------------
async function sessionRoutes(req, res, p) {
  if (p === '/api/session' && req.method === 'GET') {
    if (AU.needsSetup()) { AU.setupCode(); return send(res, 200, { needs_setup: true }); }
    let ctx = null; try { ctx = authFrom(req); } catch (_) { ctx = null; }
    if (!ctx) return send(res, 200, { signed_in: false });
    return send(res, 200, { signed_in: true, user: AU.publicUser(get('SELECT * FROM users WHERE id=:id', { id: ctx.user.id })), scopes: ctx.scopes });
  }
  if (req.method !== 'POST' || !['/api/setup', '/api/login', '/api/logout'].includes(p)) return false;
  if (!sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked.');
  const body = await jsonBody(req);
  const ip = AU.clientIp(req);
  if (p === '/api/setup') {
    if (!AU.needsSetup()) throw new HttpError(409, 'Setup is already complete. Sign in instead.');
    AU.throttle('setup:' + ip);
    const code = String(body.setup_code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (!code || code !== AU.setupCode().replace(/[^A-Za-z0-9]/g, '')) throw new HttpError(403, 'That setup code is not right. It is printed in the window where the server is running.');
    const name = str(body.name), email = normEmail(body.email);
    if (!name || !email) throw new HttpError(400, 'Enter your name and email.');
    const pw = AU.passwordProblem(body.password); if (pw) throw new HttpError(400, pw);
    if (body.timezone && require('./util').validTz(body.timezone)) setSetting('timezone', body.timezone);
    if (str(body.company_name)) setSetting('company_name', str(body.company_name));
    if (!setting('company_email')) setSetting('company_email', email);
    const id = D.insert('users', { name, email, role: 'owner', kind: 'human', title: 'Owner', color: '#1f6fd1', cost_rate: 0, bill_rate: Number(setting('default_bill_rate')) || 0,
      password_hash: AU.hashPassword(body.password), created_at: now(), updated_at: now() });
    setSetting('setup_code', null);
    const t = AU.createSession(id, req);
    AU.clearThrottle('setup:' + ip);
    return send(res, 200, { user: AU.publicUser(get('SELECT * FROM users WHERE id=:id', { id })) }, undefined, { 'Set-Cookie': sessionCookie(req, t, AU.SESSION_DAYS * 86400) });
  }
  if (p === '/api/login') {
    const email = normEmail(body.email);
    AU.throttle('login:' + ip + ':' + email);
    const u = get("SELECT * FROM users WHERE lower(email)=:e AND kind='human'", { e: email });
    if (!u || !u.active || !AU.verifyPassword(body.password || '', u.password_hash)) throw new HttpError(401, 'Email or password is not correct.');
    AU.clearThrottle('login:' + ip + ':' + email);
    const t = AU.createSession(u.id, req);
    D.run('UPDATE users SET last_seen_at=:t WHERE id=:id', { t: now(), id: u.id });
    return send(res, 200, { user: AU.publicUser(u) }, undefined, { 'Set-Cookie': sessionCookie(req, t, AU.SESSION_DAYS * 86400) });
  }
  if (p === '/api/logout') {
    AU.destroySession(parseCookies(req)[COOKIE]);
    return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  return false;
}
async function jsonBody(req, limit = 4 * 1024 * 1024) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' ? v : {}; } catch (_) { throw new HttpError(400, 'Body must be valid JSON.'); }
}

// ---------------- special routes ----------------
const EXPORTS = {
  customers: `SELECT number, name, kind, company, email, phone, status, source, tags, billing_street, billing_city, billing_state, billing_zip, created_at FROM customers ORDER BY number`,
  jobs: `SELECT j.number, c.name customer, j.title, j.type, j.status, j.priority, j.billing, u.name owner, j.due_date, j.created_at, j.completed_at FROM jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.assigned_to ORDER BY j.id`,
  visits: `SELECT j.number job, c.name customer, v.start_at, v.end_at, v.status, (SELECT group_concat(u.name, '; ') FROM visit_assignees a JOIN users u ON u.id=a.user_id WHERE a.visit_id=v.id) crew, v.arrived_at, v.completed_at FROM visits v JOIN jobs j ON j.id=v.job_id JOIN customers c ON c.id=j.customer_id ORDER BY v.start_at`,
  estimates: `SELECT e.number, c.name customer, e.title, e.status, e.issue_date, e.expiry_date, e.subtotal, e.discount, e.tax, e.total, e.approved_at FROM estimates e JOIN customers c ON c.id=e.customer_id ORDER BY e.id`,
  invoices: `SELECT i.number, c.name customer, i.title, i.status, i.issue_date, i.due_date, i.subtotal, i.discount, i.tax, i.total, i.amount_paid, i.balance, i.paid_at FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.id`,
  payments: `SELECT p.received_on, i.number invoice, c.name customer, p.amount, p.method, p.reference, p.notes FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=p.customer_id ORDER BY p.received_on`,
  time: `SELECT t.work_date, u.name person, j.number job, t.category, t.hours, t.billable, t.bill_rate, t.cost_rate, t.description, i.number invoice FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id LEFT JOIN invoices i ON i.id=t.invoice_id ORDER BY t.work_date`,
  expenses: `SELECT x.expense_date, u.name person, j.number job, x.category, x.vendor, x.description, x.amount, x.miles, x.billable, i.number invoice FROM expenses x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN jobs j ON j.id=x.job_id LEFT JOIN invoices i ON i.id=x.invoice_id ORDER BY x.expense_date`
};
const leadHits = new Map();
async function specialRoutes(req, res, p, url) {
  const I = require('./integrations');
  // file upload: raw body, metadata in the query string
  if (p === '/api/attachments' && req.method === 'POST') {
    const ctx = requireAuth(req, { csrf: true });
    if (!AU.R.STAFF.includes(ctx.user.role) || !ctx.scopes.includes('write')) throw new HttpError(403, 'You cannot upload files.');
    const q = Object.fromEntries(url.searchParams);
    const buf = await readBody(req, 16 * 1024 * 1024);
    const a = require('./services/activity').saveUpload({ entityType: q.entity_type, entityId: Number(q.entity_id), filename: q.filename || 'upload', mime: req.headers['content-type'], kind: q.kind, caption: q.caption, buf, ctx });
    if (q.entity_type === 'expense' && q.entity_id) D.run('UPDATE expenses SET receipt_id=:a WHERE id=:id', { a: a.id, id: Number(q.entity_id) });
    return send(res, 200, a);
  }
  let m = p.match(/^\/api\/attachments\/(\d+)\/file$/);
  if (m && req.method === 'GET') {
    requireAuth(req);
    const { a, file } = require('./services/activity').attachmentFile(Number(m[1]));
    const inline = /^image\/(jpeg|png|webp|gif)$|^application\/pdf$/.test(a.mime);
    res.writeHead(200, { ...SEC, 'Content-Type': a.mime, 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${a.filename.replace(/"/g, '')}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" });
    return fs.createReadStream(file).pipe(res);
  }
  if (p === '/api/backup' && req.method === 'GET') {
    const ctx = requireAuth(req);
    if (!ctx.scopes.includes('admin')) throw new HttpError(403, 'Admins only.');
    const tmp = path.join(D.DATA_DIR, `backup-${Date.now()}.db`);
    D.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
    return send(res, 200, buf, 'application/octet-stream', { 'Content-Disposition': `attachment; filename="nurzworks-hq-backup-${today()}.db"` });
  }
  m = p.match(/^\/api\/export\/(\w+)\.csv$/);
  if (m && req.method === 'GET') {
    const ctx = requireAuth(req);
    if (!AU.R.BOOKS.includes(ctx.user.role)) throw new HttpError(403, 'Not allowed.');
    if (!EXPORTS[m[1]]) throw new HttpError(404, 'Unknown export.');
    return send(res, 200, '﻿' + toCsv(all(EXPORTS[m[1]])), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${m[1]}-${today()}.csv"` });
  }
  if (p === '/api/openapi.json' && req.method === 'GET') return send(res, 200, require('./openapi').spec());
  if (p === '/llms.txt' && req.method === 'GET') return send(res, 200, require('./openapi').llmsTxt(), 'text/plain; charset=utf-8');

  // Google OAuth (admin, browser session)
  if (p === '/oauth/google/start' && req.method === 'GET') {
    const ctx = authFrom(req);
    if (!ctx || !ctx.scopes.includes('admin')) return redirect(res, '/#/integrations?google=signin');
    try { return redirect(res, I.G.authUrl()); } catch (e) { return redirect(res, `/#/integrations?google_error=${encodeURIComponent(e.message)}`); }
  }
  if (p === '/oauth/google/callback' && req.method === 'GET') {
    const ctx = authFrom(req);
    if (!ctx || !ctx.scopes.includes('admin')) return redirect(res, '/#/integrations?google_error=' + encodeURIComponent('Sign in as an admin, then connect again.'));
    const q = Object.fromEntries(url.searchParams);
    if (q.error) return redirect(res, '/#/integrations?google_error=' + encodeURIComponent(q.error));
    if (!I.G.checkState(q.state)) return redirect(res, '/#/integrations?google_error=' + encodeURIComponent('The sign-in link expired. Try again.'));
    try {
      const r = await I.G.exchange(q.code);
      if (!setting('gcal_owner_user_id') && ctx.user.id) setSetting('gcal_owner_user_id', ctx.user.id);
      I.gcal.pull().catch(() => {}); I.gmail.poll().catch(() => {});
      return redirect(res, '/#/integrations?google=connected&email=' + encodeURIComponent(r.email));
    } catch (e) { return redirect(res, '/#/integrations?google_error=' + encodeURIComponent(e.message)); }
  }
  // Slack slash command (signed by Slack)
  if (p === '/integrations/slack/commands' && req.method === 'POST') {
    const raw = (await readBody(req, 64 * 1024)).toString('utf8');
    if (!I.slack.verify(raw, req.headers)) return send(res, 401, { error: 'Invalid Slack signature' });
    const params = Object.fromEntries(new URLSearchParams(raw));
    try { return send(res, 200, await I.slack.command(params)); }
    catch (e) { return send(res, 200, { response_type: 'ephemeral', text: `:warning: ${e.message}` }); }
  }
  if (p === '/integrations/stripe/webhook' && req.method === 'POST') {
    const raw = (await readBody(req, 1024 * 1024)).toString('utf8');
    return send(res, 200, I.stripe.handleWebhook(raw, req.headers['stripe-signature']));
  }
  m = p.match(/^\/public\/invoices\/([\w-]+)\/pay$/);
  if (m && req.method === 'POST') return send(res, 200, await I.stripe.checkoutForInvoice(m[1]));
  // Incoming lead webhook (website forms, Zapier, Make)
  m = p.match(/^\/hooks\/leads\/([\w-]+)$/);
  if (m && req.method === 'POST') {
    const expected = I.WH.leadHookToken();
    if (m[1].length !== expected.length || !crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(expected))) throw new HttpError(404, 'Not found');
    const ip = AU.clientIp(req); const t = Date.now();
    const hits = (leadHits.get(ip) || []).filter(x => t - x < 3600e3); if (hits.length > 60) throw new HttpError(429, 'Too many requests'); hits.push(t); leadHits.set(ip, hits);
    const raw = (await readBody(req, 256 * 1024)).toString('utf8');
    let b = {}; try { b = /json/.test(req.headers['content-type'] || '') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); } catch (_) { throw new HttpError(400, 'Body must be JSON or form data.'); }
    const lead = I.WH.leadFromPayload(b);
    const R2 = require('./services/requests');
    const { systemCtx } = require('./ops');
    const id = R2.createRequest({ ...lead, name: lead.name || lead.email || lead.phone || 'Website lead', source: 'webhook' }, systemCtx('Lead webhook', 'webhook'));
    return send(res, 200, { ok: true, number: get('SELECT number FROM requests WHERE id=:id', { id }).number });
  }
  return false;
}
function redirect(res, to) { res.writeHead(302, { ...SEC, Location: to, 'Cache-Control': 'no-store' }); res.end(); }

// ---------------- MCP transport ----------------
async function mcpRoute(req, res, p) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST for MCP messages (no server-sent event stream is offered).' }, undefined, { Allow: 'POST' });
  if (req.headers.origin && !sameOrigin(req)) return send(res, 403, { error: 'Origin not allowed' });
  const keyFromPath = p.startsWith('/mcp/') ? decodeURIComponent(p.slice(5)) : '';
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const r = AU.resolveApiKey(keyFromPath || bearer);
  if (!r) return send(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized: create an API key for this AI staff member under Team & AI staff.' } }, undefined, { 'WWW-Authenticate': 'Bearer realm="NurzWorks HQ"' });
  const ctx = userCtx(r.user, 'mcp', r.key, AU.scopesFor(r.user, r.key));
  const body = await jsonBody(req, 4 * 1024 * 1024);
  const out = await require('./mcp').handle(body, ctx);
  if (out === null) { res.writeHead(202, { ...SEC }); return res.end(); }
  return send(res, 200, out);
}

// ---------------- static files (with gzip + etag) ----------------
const cache = new Map();
function staticFile(req, res, p) {
  let rel = p === '/' ? 'index.html' : p.slice(1);
  if (p === '/request' || p === '/request/') rel = 'request.html';
  if (/^\/p\/[eic]\/[\w-]+$/.test(p)) rel = 'portal.html';
  let file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) throw new HttpError(404, 'Not found');
    file = path.join(PUBLIC_DIR, 'index.html');
  }
  const stat = fs.statSync(file);
  let c = cache.get(file);
  if (!c || c.mtime !== stat.mtimeMs) {
    const buf = fs.readFileSync(file);
    c = { mtime: stat.mtimeMs, buf, gz: /\.(html|js|css|svg|json|webmanifest|txt)$/.test(file) ? zlib.gzipSync(buf) : null, etag: '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"' };
    cache.set(file, c);
  }
  const headers = { ...SEC, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ETag: c.etag, 'Cache-Control': file.endsWith('.png') ? 'public, max-age=604800' : 'no-cache' };
  if (file.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
  if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, headers); return res.end(); }
  const gz = c.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? c.gz : c.buf;
  res.writeHead(200, { ...headers, 'Content-Length': body.length, ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

// ---------------- main handler ----------------
async function handle(req, res) {
  let url, p;
  try { url = new URL(req.url, 'http://local'); p = decodeURIComponent(url.pathname); } catch (_) { return send(res, 400, { error: 'Bad URL' }); }
  try {
    rememberBaseUrl(originOf(req));
    if (p === '/mcp' || p.startsWith('/mcp/')) return await mcpRoute(req, res, p);
    if (await sessionRoutes(req, res, p) !== false) return;
    if (await specialRoutes(req, res, p, url) !== false) return;
    if (p.startsWith('/api/') || p.startsWith('/public/')) {
      const hit = match(req.method, p);
      if (!hit) throw new HttpError(404, 'Unknown API route.');
      if (hit.methodNotAllowed) throw new HttpError(405, 'Method not allowed.');
      const o = hit.op;
      let ctx;
      if (o.public) ctx = { user: null, key: null, scopes: [], via: 'portal', actor: 'Customer portal', ip: AU.clientIp(req) };
      else ctx = requireAuth(req, { csrf: req.method !== 'GET' });
      if (!o.public && req.method !== 'GET' && !/json/.test(req.headers['content-type'] || '') && req.headers['content-length'] && req.headers['content-length'] !== '0') throw new HttpError(415, 'Send JSON (Content-Type: application/json).');
      const body = req.method === 'GET' ? {} : await jsonBody(req);
      const input = { ...Object.fromEntries(url.searchParams), ...body, ...hit.params };
      const out = await execute(o, input, ctx);
      if (!o.public && req.method !== 'GET') scheduleKpis();
      return send(res, 200, out === undefined ? { ok: true } : out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    return staticFile(req, res, p);
  } catch (e) {
    const code = e.status || 500;
    if (code >= 500) console.error(`[${req.method} ${p}]`, e);
    return send(res, code, { error: code >= 500 ? `Server error: ${e.message}` : e.message, ...(e.extra || {}) });
  }
}
let kpiTimer = null;
function scheduleKpis() {
  clearTimeout(kpiTimer);
  kpiTimer = setTimeout(() => { try { require('./services/reports').generateKpiSnapshots(); setSetting('last_kpi_run', now()); } catch (e) { console.error('[kpi]', e.message); } }, 3000);
  kpiTimer.unref && kpiTimer.unref();
}

function createServer() { return http.createServer((req, res) => { handle(req, res); }); }

module.exports = { createServer, handle, authFrom };
