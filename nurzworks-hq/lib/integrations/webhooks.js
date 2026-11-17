'use strict';
// Outgoing webhooks (Zapier, Make, n8n, your own scripts) signed with HMAC-SHA256,
// plus an incoming lead webhook for website forms.
const crypto = require('crypto');
const { all, get, run, insert, update, now, setting, setSetting } = require('../db');
const { bad, notFound, str, token } = require('../util');
const { op, S } = require('../ops');
const { EVENTS } = require('../events');
const { baseUrl } = require('../config');

function validUrl(u) {
  let x; try { x = new URL(u); } catch (_) { bad('url must be a valid URL.'); }
  if (x.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(x.hostname)) bad('Webhook URLs must use https.');
  return x.toString();
}
const sign = (secret, body) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
async function deliver(p) {
  const h = get('SELECT * FROM webhooks WHERE id=:id', { id: p.webhook_id });
  if (!h || !h.active) return;
  const body = JSON.stringify({ id: p.delivery_id, event: p.event, created_at: p.created_at, data: p.data });
  let status = '';
  try {
    const res = await fetch(h.url, { method: 'POST', signal: AbortSignal.timeout(10000), headers: {
      'Content-Type': 'application/json', 'User-Agent': 'NurzWorks-HQ-Webhooks/1.0', 'X-NurzWorks-Event': p.event, 'X-NurzWorks-Delivery': p.delivery_id, 'X-NurzWorks-Signature': sign(h.secret, body) }, body });
    status = String(res.status);
    if (!res.ok) { const e = new Error(`HTTP ${res.status}`); if (res.status === 410) e.permanent = true; throw e; }
  } catch (e) { status = status || e.message; throw e; }
  finally { update('webhooks', h.id, { last_status: status, last_at: now() }); }
}
function payloadFor(event, data) {
  // include a fresh snapshot of the main record for convenience
  const map = { customer: 'customers', request: 'requests', estimate: 'estimates', job: 'jobs', visit: 'visits', invoice: 'invoices', task: 'tasks' };
  const kind = event.split('.')[0];
  const id = data && (data.id || data.invoice_id);
  const tbl = kind === 'payment' ? 'invoices' : map[kind];
  let record = null;
  if (tbl && id) { record = get(`SELECT * FROM ${tbl} WHERE id=:id`, { id }); if (record) { delete record.public_token; delete record.portal_token; } }
  return { ...data, record };
}
function enqueueFor(event, data, enqueue) {
  const hooks = all('SELECT id, events FROM webhooks WHERE active=1');
  for (const h of hooks) {
    const list = h.events === '*' ? null : h.events.split(',');
    if (list && !list.includes(event)) continue;
    enqueue('webhook', { webhook_id: h.id, event, data: payloadFor(event, data), delivery_id: crypto.randomUUID(), created_at: now() });
  }
}

const ADMIN = { scope: 'admin', mcp: false, tags: ['Webhooks'] };
op({ ...ADMIN, name: 'list_webhooks', method: 'GET', path: '/api/webhooks', title: 'List webhooks', input: S.obj({}),
  handler: () => ({ webhooks: all('SELECT id, url, events, description, active, last_status, last_at, created_at FROM webhooks ORDER BY id'), events: EVENTS }) });
op({ ...ADMIN, name: 'create_webhook', method: 'POST', path: '/api/webhooks', title: 'Add webhook',
  input: S.obj({ url: S.str('', 1000), events: { type: 'array', items: S.str() }, description: S.str('', 300) }, ['url']),
  handler: i => {
    const ev = (i.events || []).filter(e => EVENTS.includes(e));
    const secret = 'whsec_' + token(24);
    const id = insert('webhooks', { url: validUrl(i.url), events: ev.length ? ev.join(',') : '*', secret, description: str(i.description), active: 1, created_at: now() });
    return { ...get('SELECT id, url, events, description, active FROM webhooks WHERE id=:id', { id }), secret, note: 'Verify deliveries: HMAC-SHA256 of the raw body with this secret equals the X-NurzWorks-Signature header (sha256=...).' };
  } });
op({ ...ADMIN, name: 'update_webhook', method: 'PUT', path: '/api/webhooks/:id', title: 'Update webhook',
  input: S.obj({ id: S.id, url: S.str('', 1000), events: { type: 'array', items: S.str() }, description: S.str('', 300), active: S.bool() }, ['id']),
  handler: i => {
    const h = get('SELECT * FROM webhooks WHERE id=:id', { id: i.id }) || notFound('Webhook');
    const o = {};
    if (i.url) o.url = validUrl(i.url);
    if (i.events) { const ev = i.events.filter(e => EVENTS.includes(e)); o.events = ev.length ? ev.join(',') : '*'; }
    if (i.description !== undefined) o.description = str(i.description);
    if (i.active !== undefined) o.active = i.active ? 1 : 0;
    update('webhooks', h.id, o);
    return get('SELECT id, url, events, description, active, last_status, last_at FROM webhooks WHERE id=:id', { id: h.id });
  } });
op({ ...ADMIN, name: 'delete_webhook', method: 'DELETE', path: '/api/webhooks/:id', title: 'Delete webhook', input: S.obj({ id: S.id }, ['id']),
  handler: i => { run('DELETE FROM webhooks WHERE id=:id', { id: i.id }); return { ok: true }; } });
op({ ...ADMIN, name: 'test_webhook', method: 'POST', path: '/api/webhooks/:id/test', title: 'Send a test delivery', input: S.obj({ id: S.id }, ['id']),
  handler: async i => {
    const h = get('SELECT * FROM webhooks WHERE id=:id', { id: i.id }) || notFound('Webhook');
    await deliver({ webhook_id: h.id, event: 'ping', data: { message: 'Hello from NurzWorks HQ' }, delivery_id: crypto.randomUUID(), created_at: now() });
    return { ok: true, status: get('SELECT last_status FROM webhooks WHERE id=:id', { id: h.id }).last_status };
  } });

// ---------------- incoming lead webhook ----------------
function leadHookToken() { let t = setting('lead_hook_token'); if (!t) { t = token(18); setSetting('lead_hook_token', t); } return t; }
const leadHookUrl = () => `${baseUrl()}/hooks/leads/${leadHookToken()}`;
op({ ...ADMIN, name: 'rotate_lead_hook', method: 'POST', path: '/api/integrations/lead-hook/rotate', title: 'New lead webhook URL', input: S.obj({}),
  handler: () => { setSetting('lead_hook_token', token(18)); return { url: leadHookUrl() }; } });
// Accepts common form field names from website builders and Zapier.
function leadFromPayload(b) {
  const f = k => { for (const key of k) { const v = b[key] ?? b[key.toLowerCase()] ?? (b.fields && b.fields[key]); if (v) return String(v); } return ''; };
  const first = f(['first_name', 'firstName', 'First Name']), last = f(['last_name', 'lastName', 'Last Name']);
  return {
    name: f(['name', 'full_name', 'Name', 'your-name']) || [first, last].filter(Boolean).join(' '), email: f(['email', 'Email', 'your-email', 'email_address']), phone: f(['phone', 'Phone', 'tel', 'phone_number']),
    company: f(['company', 'Company', 'business']), address: f(['address', 'Address', 'service_address']), service: f(['service', 'Service', 'subject', 'Subject']),
    details: f(['details', 'message', 'Message', 'description', 'comments', 'your-message']), preferred_date: /^\d{4}-\d{2}-\d{2}$/.test(f(['preferred_date', 'date'])) ? f(['preferred_date', 'date']) : undefined
  };
}

module.exports = { deliver, enqueueFor, leadHookToken, leadHookUrl, leadFromPayload, sign };
