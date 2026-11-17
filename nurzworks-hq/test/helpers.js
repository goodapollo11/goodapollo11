'use strict';
// Test helpers: boot an isolated HQ server (fresh temp database) and talk to it like the web app or an AI client.
const fs = require('fs');
const os = require('os');
const path = require('path');

async function boot(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwhq-test-'));
  Object.assign(process.env, { NW_DATA_DIR: dir, NW_QUIET: '1', NW_SECRET_KEY: 'test-secret', NW_TIMEZONE: 'America/Chicago' }, env);
  const app = require('../lib/app');
  const server = app.http.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { app, server, base, dir, close: async () => { await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); } };
}

class Client {
  constructor(base) { this.base = base; this.cookie = ''; this.bearer = ''; }
  async req(method, p, body, headers = {}) {
    const h = { 'X-NW-Request': '1', ...headers };
    if (body !== undefined && !(body instanceof Buffer)) h['Content-Type'] = 'application/json';
    if (this.cookie) h.Cookie = this.cookie;
    if (this.bearer) h.Authorization = `Bearer ${this.bearer}`;
    const res = await fetch(this.base + p, { method, headers: h, body: body instanceof Buffer ? body : body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = res.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  async ok(method, p, body, headers) {
    const r = await this.req(method, p, body, headers);
    if (r.status >= 400) throw new Error(`${method} ${p} -> ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  }
  get(p) { return this.ok('GET', p); } post(p, b = {}) { return this.ok('POST', p, b); } put(p, b = {}) { return this.ok('PUT', p, b); } del(p) { return this.ok('DELETE', p); }
}

async function owner(base) {
  const c = new Client(base);
  const code = require('../lib/auth').setupCode();
  await c.ok('POST', '/api/setup', { setup_code: code, company_name: 'NurzWorks', name: 'Test Owner', email: 'owner@example.com', password: 'correct horse battery', timezone: 'America/Chicago' });
  return c;
}
async function aiKey(c, { name = 'Ava', role = 'office', scopes = ['read', 'write'] } = {}) {
  const u = await c.post('/api/team', { name, kind: 'ai', role, title: 'AI Office Manager' });
  const k = await c.post('/api/keys', { user_id: u.id, name: 'test', scopes });
  return { user: u, key: k.key, mcp_secret_url: k.mcp_secret_url };
}
async function mcp(base, key, msg, { path: p = '/mcp' } = {}) {
  const res = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(msg) });
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
// a future weekday (business-local YYYY-MM-DD) so scheduling tests never depend on the time of day
function futureWeekday(daysAhead = 7) {
  const { addDays, localDate } = require('../lib/util');
  let d = addDays(localDate(new Date(), 'America/Chicago'), daysAhead);
  while ([0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())) d = addDays(d, 1);
  return d;
}

module.exports = { boot, Client, owner, aiKey, mcp, futureWeekday };
