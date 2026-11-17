'use strict';
// Google (OAuth, Gmail, Calendar), Slack, webhooks, lead hook and Stripe - against local mock servers.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { boot, owner, futureWeekday } = require('./helpers');

const b64u = s => Buffer.from(s).toString('base64url');
const seen = []; // every request the mocks received
let calEvents = [];
function mockHandler(req, res) {
  let raw = '';
  req.on('data', d => { raw += d; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://mock');
    const rec = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, raw, body: (() => { try { return JSON.parse(raw); } catch (_) { return Object.fromEntries(new URLSearchParams(raw)); } })() };
    seen.push(rec);
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    const p = url.pathname;
    if (p === '/token') {
      if (rec.body.grant_type === 'authorization_code') return rec.body.code === 'good-code' ? send(200, { access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, scope: 'gmail calendar', id_token: `x.${b64u(JSON.stringify({ email: 'office@nurzworks.example' }))}.y` }) : send(400, { error: 'invalid_grant' });
      if (rec.body.grant_type === 'refresh_token') return send(200, { access_token: 'at2', expires_in: 3600 });
    }
    if (p === '/revoke') return send(200, {});
    if (p === '/gmail/v1/users/me/threads' && req.method === 'GET') return send(200, { threads: [{ id: 't1', historyId: '100', snippet: 'Our line is down' }], resultSizeEstimate: 1 });
    if (p === '/gmail/v1/users/me/threads/t1' && req.method === 'GET') {
      const headers = [{ name: 'From', value: 'Linda Moore <ops@rootriver.example>' }, { name: 'To', value: 'office@nurzworks.example' }, { name: 'Subject', value: '=?UTF-8?B?' + Buffer.from('Line down – help').toString('base64') + '?=' }, { name: 'Message-ID', value: '<abc@mail.example>' }];
      return send(200, { id: 't1', historyId: '100', messages: [{ id: 'm1', threadId: 't1', labelIds: ['INBOX', 'UNREAD'], internalDate: String(Date.now() - 3600e3), snippet: 'Our line is down',
        payload: { mimeType: 'multipart/alternative', headers, parts: [{ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64u('Our line is down since 6am.\n> earlier quote') } }, { mimeType: 'text/html', body: { data: b64u('<p>Our line is down</p>') } }] } }] });
    }
    if (p === '/gmail/v1/users/me/messages/send') return send(200, { id: 'm2', threadId: rec.body.threadId || 't2' });
    if (p === '/gmail/v1/users/me/drafts') return send(200, { id: 'd1', message: { id: 'm3', threadId: 't1' } });
    if (p === '/gmail/v1/users/me/threads/t1/modify') return send(200, { id: 't1', messages: [{ id: 'm1', labelIds: ['INBOX'] }] });
    if (p === '/calendar/v3/users/me/calendarList') return send(200, { items: [{ id: 'office@nurzworks.example', summary: 'Office', primary: true, accessRole: 'owner', timeZone: 'America/Chicago' }] });
    if (p === '/calendar/v3/calendars/primary/events' && req.method === 'POST') return send(200, { id: 'ev1', htmlLink: 'https://calendar.example/ev1' });
    if (p === '/calendar/v3/calendars/primary/events/ev1' && req.method === 'PATCH') return send(200, { id: 'ev1' });
    if (p === '/calendar/v3/calendars/primary/events/ev1' && req.method === 'DELETE') return send(204);
    if (p === '/calendar/v3/calendars/primary/events' && req.method === 'GET') return send(200, { items: calEvents });
    if (p === '/slack/chat.postMessage') return send(200, { ok: true, ts: '1.0' });
    if (p === '/hooks/slack' || p === '/wh') { res.writeHead(200); return res.end('ok'); }
    if (p === '/stripe/v1/checkout/sessions') return send(200, { id: 'cs_1', url: 'https://checkout.example/cs_1' });
    send(404, { error: { message: `mock: no route ${req.method} ${p}` } });
  });
}
const last = (method, pathPart) => [...seen].reverse().find(r => r.method === method && r.path.includes(pathPart));

let H, c, M, mock;
test.before(async () => {
  M = http.createServer(mockHandler); await new Promise(r => M.listen(0, '127.0.0.1', r));
  mock = `http://127.0.0.1:${M.address().port}`;
  H = await boot({ NW_GOOGLE_OAUTH_BASE: mock, NW_GOOGLE_TOKEN_URL: mock + '/token', NW_GOOGLE_REVOKE_URL: mock + '/revoke', NW_GOOGLE_API_BASE: mock, NW_SLACK_API_BASE: mock + '/slack', NW_STRIPE_API_BASE: mock + '/stripe' });
  c = await owner(H.base);
});
test.after(async () => { await H.close(); await new Promise(r => M.close(r)); });
const runOutbox = () => require('../lib/integrations/outbox').processOutbox();

let cust;
test('Google OAuth connect (state checked, tokens encrypted at rest)', async () => {
  await c.put('/api/integrations/google', { client_id: 'abc.apps.googleusercontent.com', client_secret: 'shh-secret' });
  const start = await c.req('GET', '/oauth/google/start');
  assert.equal(start.status, 302);
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  assert.match(auth.searchParams.get('scope'), /gmail\.modify/);
  const bad = await c.req('GET', '/oauth/google/callback?code=good-code&state=forged');
  assert.match(bad.headers.get('location'), /google_error/);
  const start2 = await c.req('GET', '/oauth/google/start');
  const state = new URL(start2.headers.get('location')).searchParams.get('state');
  const cb = await c.req('GET', `/oauth/google/callback?code=good-code&state=${state}`);
  assert.match(cb.headers.get('location'), /google=connected/);
  const s = await c.get('/api/integrations');
  assert.equal(s.google.connected, true);
  assert.equal(s.google.email, 'office@nurzworks.example');
  const stored = require('../lib/db').setting('google_tokens');
  assert.match(stored, /^enc:v1:/);
  assert.ok(!stored.includes('rt1'), 'refresh token is not stored in plain text');
});

test('Gmail: inbox threads link to customers, read thread, reply in thread, drafts, labels', async () => {
  cust = await c.post('/api/customers', { name: 'Root River Water Utility', email: 'ops@rootriver.example' });
  const list = await c.get('/api/email/threads');
  assert.equal(list.threads[0].thread_id, 't1');
  assert.equal(list.threads[0].customer_id, cust.id, 'matched by sender address');
  assert.equal(list.threads[0].subject, 'Line down – help', 'RFC 2047 subjects decoded');
  const t = await c.get('/api/email/threads/t1');
  assert.match(t.messages[0].text, /down since 6am/);
  assert.ok(t.messages[0].html.includes('<p>'));
  const sent = await c.post('/api/email/send', { thread_id: 't1', body: 'On it – we will be there at 2pm.', customer_id: cust.id });
  assert.equal(sent.to, 'ops@rootriver.example', 'reply goes to the sender');
  const mime = Buffer.from(last('POST', '/messages/send').body.raw, 'base64url').toString();
  assert.match(mime, /In-Reply-To: <abc@mail\.example>/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  const plain = mime.split('Content-Transfer-Encoding: base64')[1].split('--nw_')[0].replace(/\s+/g, '');
  assert.match(Buffer.from(plain, 'base64').toString(), /On it – we will be there/);
  assert.equal(last('POST', '/messages/send').body.threadId, 't1');
  const d = await c.post('/api/email/drafts', { to: 'ops@rootriver.example', subject: 'Visit confirmation', body: 'See you Tuesday' });
  assert.equal(d.draft_id, 'd1');
  await c.post('/api/email/threads/t1/modify', { read: true });
  assert.deepEqual(last('POST', '/threads/t1/modify').body.removeLabelIds, ['UNREAD']);
  const cu = await c.get(`/api/customers/${cust.id}`);
  assert.ok(cu.activity.some(a => a.kind === 'email' && /On it|Re:/.test(a.body)), 'email logged on the customer');
  await assert.rejects(c.post('/api/email/send', { to: 'not-an-email', subject: 'x', body: 'y' }), /not a valid email/);
});

test('estimates are emailed from Gmail with the approval link', async () => {
  const e = await c.post('/api/estimates', { customer_id: cust.id, title: 'Flow meter replacement', items: [{ name: 'Flow meter', qty: 1, unit_price: 1450 }] });
  const r = await c.post(`/api/estimates/${e.id}/send`, { method: 'email' });
  assert.equal(r.emailed, true);
  assert.equal(r.status, 'sent');
  const mime = Buffer.from(last('POST', '/messages/send').body.raw, 'base64url').toString();
  const parts = mime.split('Content-Transfer-Encoding: base64').slice(1).map(x => Buffer.from(x.split('--nw_')[0].replace(/\s+/g, ''), 'base64').toString());
  assert.ok(parts.some(p => p.includes(`/p/e/${e.public_token}`)), 'contains the customer approval link');
  assert.match(mime, /To: ops@rootriver\.example/);
});

test('Google Calendar: visits are pushed, rescheduled and removed; busy time blocks availability', async () => {
  await c.put('/api/integrations/calendar', { enabled: true, calendar_id: 'primary' });
  const day = futureWeekday(8);
  const job = await c.post('/api/jobs', { customer_id: cust.id, title: 'Lift station check', schedule: { start: `${day}T09:00`, duration_minutes: 60 } });
  await runOutbox();
  const created = last('POST', '/calendar/v3/calendars/primary/events');
  assert.ok(created, 'event created');
  assert.match(created.body.summary, new RegExp(job.number));
  assert.equal(created.body.start.dateTime, job.visits[0].start_at);
  assert.equal(created.body.start.timeZone, 'America/Chicago');
  assert.equal(created.body.extendedProperties.private.nw_visit_id, String(job.visits[0].id));
  assert.equal(created.query.sendUpdates, 'none');
  await c.put(`/api/visits/${job.visits[0].id}`, { start: `${day}T13:00` });
  await runOutbox();
  assert.equal(last('PATCH', '/events/ev1').body.start.dateTime, require('../lib/util').zonedToUtc(day, '13:00', 'America/Chicago').toISOString());
  await c.post(`/api/visits/${job.visits[0].id}/status`, { status: 'cancelled' });
  await runOutbox();
  assert.ok(last('DELETE', '/events/ev1'), 'cancelled visit removed from Google Calendar');
  // pull a personal appointment and check it blocks the calendar owner's availability
  const { zonedToUtc } = require('../lib/util');
  calEvents = [{ id: 'busy1', summary: 'Dentist', status: 'confirmed', start: { dateTime: zonedToUtc(day, '10:00', 'America/Chicago').toISOString() }, end: { dateTime: zonedToUtc(day, '12:00', 'America/Chicago').toISOString() } }];
  await require('../lib/integrations/gcal').pull();
  const ev = await c.get(`/api/calendar/events?from=${day}&to=${day}`);
  assert.equal(ev.events[0].summary, 'Dentist');
  const me = (await c.get('/api/meta')).me;
  const av = await c.get(`/api/availability?date_from=${day}&date_to=${day}&duration_minutes=60&user_ids=${me.id}`);
  const busyS = zonedToUtc(day, '10:00', 'America/Chicago').toISOString(), busyE = zonedToUtc(day, '12:00', 'America/Chicago').toISOString();
  assert.ok(av.slots.length && av.slots.every(s => s.end <= busyS || s.start >= busyE), 'no slot overlaps the dentist appointment');
  const j2 = await c.post('/api/jobs', { customer_id: cust.id, title: 'Overlap test', schedule: { start: `${day}T10:30`, duration_minutes: 30, assignees: [me.id] } });
  const v2 = await c.put(`/api/visits/${j2.visits[0].id}`, { notes: 'x' });
  assert.ok(v2.conflicts.some(x => x.kind === 'calendar'), 'Google busy time shows as a conflict');
});

test('expired access tokens are refreshed automatically', async () => {
  const A = require('../lib/auth');
  const t = JSON.parse(A.getSecret('google_tokens')); t.expires_at = 0; A.setSecret('google_tokens', JSON.stringify(t));
  await c.get('/api/email/threads');
  assert.equal(last('POST', '/token').body.grant_type, 'refresh_token');
  assert.equal(last('GET', '/gmail/v1/users/me/threads').headers.authorization, 'Bearer at2');
});

test('Slack: notifications through the outbox and a signed /nurz command', async () => {
  await c.put('/api/integrations/slack', { webhook_url: mock + '/hooks/slack', signing_secret: 'slack-signing', events: { 'job.completed': true, 'request.created': true } });
  const j = await c.post('/api/jobs', { customer_id: cust.id, title: 'Panel retrofit' });
  await c.post(`/api/jobs/${j.id}/status`, { status: 'completed', notes: 'All good' });
  await runOutbox();
  const msg = last('POST', '/hooks/slack');
  assert.match(msg.body.text, new RegExp(`${j.number}.*completed`));
  const body = new URLSearchParams({ text: `job ${j.number}`, user_name: 'pat', user_id: 'U1' }).toString();
  const ts = Math.floor(Date.now() / 1000);
  const sig = 'v0=' + crypto.createHmac('sha256', 'slack-signing').update(`v0:${ts}:${body}`).digest('hex');
  const ok = await fetch(H.base + '/integrations/slack/commands', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Slack-Request-Timestamp': String(ts), 'X-Slack-Signature': sig }, body });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).text, new RegExp(j.number));
  const lead = new URLSearchParams({ text: 'lead Jane Smith | jane@example.com | furnace short cycling', user_name: 'pat' }).toString();
  const sig2 = 'v0=' + crypto.createHmac('sha256', 'slack-signing').update(`v0:${ts}:${lead}`).digest('hex');
  const lr = await (await fetch(H.base + '/integrations/slack/commands', { method: 'POST', headers: { 'X-Slack-Request-Timestamp': String(ts), 'X-Slack-Signature': sig2 }, body: lead })).json();
  assert.match(lr.text, /REQ-/);
  const forged = await fetch(H.base + '/integrations/slack/commands', { method: 'POST', headers: { 'X-Slack-Request-Timestamp': String(ts), 'X-Slack-Signature': 'v0=deadbeef' }, body });
  assert.equal(forged.status, 401);
});

test('outgoing webhooks are signed; failures retry', async () => {
  const h = await c.post('/api/webhooks', { url: mock + '/wh', events: ['invoice.paid'] });
  const inv = await c.post('/api/invoices', { customer_id: cust.id, items: [{ name: 'Service', qty: 1, unit_price: 200 }] });
  await c.post(`/api/invoices/${inv.id}/send`, { method: 'mark_sent' });
  await c.post(`/api/invoices/${inv.id}/payments`, { method: 'card' });
  await runOutbox();
  const d = last('POST', '/wh');
  assert.equal(d.headers['x-nurzworks-event'], 'invoice.paid');
  assert.equal(d.headers['x-nurzworks-signature'], 'sha256=' + crypto.createHmac('sha256', h.secret).update(d.raw).digest('hex'));
  assert.equal(d.body.data.record.number, inv.number);
  assert.equal(d.body.data.record.public_token, undefined);
  await c.put(`/api/webhooks/${h.id}`, { url: mock + '/missing' });
  const OB = require('../lib/integrations/outbox');
  OB.enqueue('webhook', { webhook_id: h.id, event: 'invoice.paid', data: {}, delivery_id: 'x', created_at: new Date().toISOString() });
  const r = await OB.processOutbox();
  assert.equal(r.failed, 1);
  const pending = require('../lib/db').get("SELECT * FROM outbox WHERE status='pending' AND channel='webhook'");
  assert.ok(pending && pending.attempts === 1 && pending.next_at > new Date().toISOString(), 'scheduled for retry with backoff');
});

test('inbound lead webhook accepts website form posts', async () => {
  const url = (await c.get('/api/integrations')).lead_hook_url;
  const r = await fetch(url.replace(/^https?:\/\/[^/]+/, H.base), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'your-name': 'Web Lead', 'your-email': 'web@example.com', 'your-message': 'Need a PLC backup' }).toString() });
  const d = await r.json();
  assert.match(d.number, /^REQ-/);
  const req = (await c.get('/api/requests')).find(x => x.number === d.number);
  assert.equal(req.source, 'webhook');
  assert.equal(req.details, 'Need a PLC backup');
  assert.equal((await fetch(H.base + '/hooks/leads/wrong-token', { method: 'POST', body: '{}' })).status, 404);
});

test('Stripe: pay-online link and webhook marks the invoice paid', async () => {
  await c.put('/api/integrations/stripe', { secret_key: 'sk_test_123', webhook_secret: 'whsec_test' });
  const inv = await c.post('/api/invoices', { customer_id: cust.id, items: [{ name: 'Service', qty: 1, unit_price: 320 }] });
  await c.post(`/api/invoices/${inv.id}/send`, { method: 'mark_sent' });
  const pub = await (await fetch(`${H.base}/public/invoices/${inv.public_token}`)).json();
  assert.equal(pub.pay_online, true);
  const pay = await (await fetch(`${H.base}/public/invoices/${inv.public_token}/pay`, { method: 'POST' })).json();
  assert.equal(pay.url, 'https://checkout.example/cs_1');
  assert.match(last('POST', '/stripe/v1/checkout/sessions').raw, /unit_amount%5D=32000/);
  const evt = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', amount_total: 32000, payment_intent: 'pi_1', metadata: { invoice_id: String(inv.id) } } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${evt}`).digest('hex')}`;
  const forged = await fetch(H.base + '/integrations/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${t},v1=00` }, body: evt });
  assert.equal(forged.status, 400);
  const ok = await fetch(H.base + '/integrations/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig }, body: evt });
  assert.equal(ok.status, 200);
  await fetch(H.base + '/integrations/stripe/webhook', { method: 'POST', headers: { 'Stripe-Signature': sig }, body: evt }); // duplicate delivery is ignored
  const after = await c.get(`/api/invoices/${inv.id}`);
  assert.equal(after.status, 'paid');
  assert.equal(after.payments.length, 1);
});

test('disconnecting Google revokes the token', async () => {
  await c.post('/api/integrations/google/disconnect');
  assert.ok(last('POST', '/revoke'));
  assert.equal((await c.get('/api/integrations')).google.connected, false);
  assert.equal((await c.req('GET', '/api/email/threads')).status, 409);
});
