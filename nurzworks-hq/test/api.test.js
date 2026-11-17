'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, Client, owner, futureWeekday } = require('./helpers');

let H, c;
test.before(async () => { H = await boot(); });
test.after(async () => { await H.close(); });

test('first-run setup needs the console setup code, then signs the owner in', async () => {
  const anon = new Client(H.base);
  assert.equal((await anon.get('/api/session')).needs_setup, true);
  const bad = await anon.req('POST', '/api/setup', { setup_code: 'WRONG-CODE', name: 'X', email: 'x@example.com', password: 'longenough1' });
  assert.equal(bad.status, 403);
  c = await owner(H.base);
  const s = await c.get('/api/session');
  assert.equal(s.user.role, 'owner');
  assert.equal((await c.req('POST', '/api/setup', { setup_code: 'x' })).status, 409, 'setup only works once');
  assert.equal((await new Client(H.base).get('/api/session')).signed_in, false);
});

test('login, logout and wrong passwords', async () => {
  const x = new Client(H.base);
  assert.equal((await x.req('POST', '/api/login', { email: 'owner@example.com', password: 'nope' })).status, 401);
  await x.ok('POST', '/api/login', { email: 'OWNER@example.com', password: 'correct horse battery' });
  assert.equal((await x.get('/api/meta')).me.name, 'Test Owner');
  await x.post('/api/logout');
  assert.equal((await x.req('GET', '/api/meta')).status, 401);
});

test('state-changing requests need the app header (CSRF) or a bearer key', async () => {
  const r = await fetch(H.base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c.cookie }, body: JSON.stringify({ title: 'x' }) });
  assert.equal(r.status, 403);
  const r2 = await fetch(H.base + '/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: c.cookie, 'X-NW-Request': '1', Origin: 'https://evil.example' }, body: JSON.stringify({ title: 'x' }) });
  assert.equal(r2.status, 403, 'cross-origin request is blocked');
});

test('security headers and static app', async () => {
  const r = await fetch(H.base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const raw = await new Promise(resolve => require('http').get({ host: '127.0.0.1', port: new URL(H.base).port, path: '/../lib/db.js' }, res => { let b = ''; res.on('data', d => { b += d; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }));
  assert.ok(!raw.body.includes('DatabaseSync'), 'no path traversal out of public/');
});

let customer, job, visit, est, inv;
test('customers: create with address, duplicate warning, phone search', async () => {
  customer = await c.post('/api/customers', { name: 'Lakeshore Plastics', kind: 'commercial', email: 'Maint@Lakeshore.example', phone: '(262) 555-0141', tags: 'Manufacturing, PM-contract',
    address: { street: '4100 52nd St', city: 'Kenosha', state: 'WI', zip: '53144', access_notes: 'Door 3' }, contacts: [{ name: 'Tom Becker', role: 'Maintenance Manager', email: 'tom@lakeshore.example' }] });
  assert.equal(customer.email, 'maint@lakeshore.example');
  assert.equal(customer.tags, 'manufacturing, pm-contract');
  assert.equal(customer.locations.length, 1);
  assert.equal(customer.locations[0].access_notes, 'Door 3');
  const dup = await c.post('/api/customers', { name: 'Lakeshore (dup)', phone: '262.555.0141' });
  assert.equal(dup.possible_duplicates[0].id, customer.id);
  const found = await c.get('/api/customers?q=2625550141');
  assert.ok(found.some(x => x.id === customer.id));
  const byContact = await c.get('/api/customers?q=tom%40lakeshore');
  assert.ok(byContact.some(x => x.id === customer.id));
});

test('jobs & visits: schedule, conflicts, field workflow with GPS and automatic timer', async () => {
  const day = futureWeekday(7);
  job = await c.post('/api/jobs', { customer_id: customer.id, title: 'PLC fault on line 2', billing: 'hourly', items: [{ name: 'Trip charge', qty: 1, unit_price: 95, unit_cost: 0 }],
    checklist: ['Back up program', 'Check I/O'], schedule: { start: `${day}T09:00`, duration_minutes: 120 } });
  assert.equal(job.status, 'scheduled');
  assert.equal(job.location_id, customer.locations[0].id, 'defaults to the primary location');
  assert.equal(job.visits.length, 1);
  assert.equal(job.checklist.length, 2);
  visit = job.visits[0];
  const me = (await c.get('/api/meta')).me;
  // double-book the owner -> conflict warning
  const job2 = await c.post('/api/jobs', { customer_id: customer.id, title: 'Second job' });
  const v2 = await c.post(`/api/jobs/${job2.id}/visits`, { start: `${day}T10:00`, duration_minutes: 60, assignees: [me.id] });
  const v1 = await c.put(`/api/visits/${visit.id}`, { assignees: [me.id] });
  assert.ok(v1.conflicts.length >= 1, 'overlap is reported');
  await c.del(`/api/visits/${v2.id}`);
  assert.equal((await c.get(`/api/jobs/${job2.id}`)).status, 'unscheduled', 'removing the only visit unschedules the job');
  // availability avoids the booked visit
  const av = await c.get(`/api/availability?date_from=${day}&date_to=${day}&duration_minutes=60&user_ids=${me.id}`);
  for (const s of av.slots) assert.ok(s.end <= visit.start_at || s.start >= visit.end_at, 'slot does not overlap the visit');
  // field workflow
  await c.post(`/api/visits/${visit.id}/status`, { status: 'en_route' });
  await c.post(`/api/visits/${visit.id}/status`, { status: 'on_site', lat: 42.5847, lng: -87.8789 });
  let jj = await c.get(`/api/jobs/${job.id}`);
  assert.equal(jj.status, 'in_progress');
  assert.equal(jj.visits[0].arrive_lat, 42.5847);
  const running = await c.get('/api/time/running?user_id=me');
  assert.equal(running.length, 1, 'arriving starts a timer');
  await c.post(`/api/jobs/${job.id}/checklist`, { index: 0, done: true });
  await c.post(`/api/visits/${visit.id}/status`, { status: 'completed', notes: 'Replaced I/O card', complete_job: true });
  jj = await c.get(`/api/jobs/${job.id}`);
  assert.equal(jj.status, 'completed');
  assert.equal(jj.checklist[0].done, true);
  assert.equal((await c.get('/api/time/running?user_id=me')).length, 0, 'completing stops the timer');
  assert.ok(jj.time[0].ended_at);
});

test('invoicing a job pulls items, billable time and expenses; payments update status', async () => {
  await c.post('/api/time', { job_id: job.id, hours: 2.5, description: 'Troubleshooting', billable: true, bill_rate: 100, cost_rate: 35 });
  await c.post('/api/expenses', { job_id: job.id, category: 'materials', vendor: 'Grainger', amount: 40, billable: true, markup_pct: 25 });
  inv = await c.post('/api/invoices', { job_id: job.id, tax_rate: 0 });
  const names = inv.items.map(l => l.name);
  assert.ok(names.includes('Trip charge'));
  assert.ok(names.some(n => n.startsWith('Labor - Test Owner')));
  assert.ok(names.some(n => n.startsWith('Materials - Grainger')));
  const mat = inv.items.find(l => l.name.startsWith('Materials'));
  assert.equal(mat.unit_price, 50, '25% markup on $40');
  assert.equal((await c.get(`/api/jobs/${job.id}`)).status, 'invoiced');
  await assert.rejects(c.post('/api/invoices', { job_id: job.id }), /Nothing left to invoice/);
  const total = inv.total;
  await c.post(`/api/invoices/${inv.id}/send`, { method: 'mark_sent' });
  let after = await c.post(`/api/invoices/${inv.id}/payments`, { amount: 100, method: 'check', reference: '1001' });
  assert.equal(after.status, 'partial');
  assert.equal(after.balance, Math.round((total - 100) * 100) / 100);
  await assert.rejects(c.post(`/api/invoices/${inv.id}/payments`, { amount: total }), /more than the balance/);
  after = await c.post(`/api/invoices/${inv.id}/payments`, { method: 'ach' });
  assert.equal(after.status, 'paid');
  assert.equal(after.balance, 0);
  // the customer link works without signing in and never exposes internal notes
  const pub = await (await fetch(`${H.base}/public/invoices/${inv.public_token}`)).json();
  assert.equal(pub.number, inv.number);
  assert.equal(pub.internal_notes, undefined);
  assert.equal(pub.items[0].unit_cost, undefined, 'costs are private');
});

test('voiding releases job work so it can be re-invoiced', async () => {
  const j = await c.post('/api/jobs', { customer_id: customer.id, title: 'Fixed price job', items: [{ name: 'Panel', qty: 1, unit_price: 500, taxable: true }] });
  await c.post(`/api/jobs/${j.id}/status`, { status: 'completed', notes: 'done' });
  const i1 = await c.post('/api/invoices', { job_id: j.id, tax_rate: 5 });
  assert.equal(i1.tax, 25);
  await c.post(`/api/invoices/${i1.id}/send`, { method: 'mark_sent' });
  await c.post(`/api/invoices/${i1.id}/void`, { reason: 'wrong customer' });
  assert.equal((await c.get(`/api/jobs/${j.id}`)).status, 'completed');
  const i2 = await c.post('/api/invoices', { job_id: j.id });
  assert.equal(i2.items.length, 1);
});

test('estimates: totals with discount and tax, customer approves online, job created automatically', async () => {
  est = await c.post('/api/estimates', { customer_id: customer.id, title: 'Panel upgrade', tax_rate: 5.5, discount: 100,
    items: [{ name: 'Panel', qty: 1, unit_price: 1200, unit_cost: 800, taxable: true }, { name: 'Labor', qty: 4, unit_price: 95, taxable: false }] });
  assert.equal(est.subtotal, 1580);
  // taxable share 1200/1580 of the $100 discount -> tax on 1124.05
  assert.equal(est.tax, 61.82);
  assert.equal(est.total, 1541.82);
  await c.post(`/api/estimates/${est.id}/send`, { method: 'mark_sent' });
  const pub = await (await fetch(`${H.base}/public/estimates/${est.public_token}`)).json();
  assert.equal(pub.status, 'sent');
  const bad = await fetch(`${H.base}/public/estimates/${est.public_token}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400, 'a typed name is required');
  const ok = await (await fetch(`${H.base}/public/estimates/${est.public_token}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tom Becker' }) })).json();
  assert.equal(ok.status, 'converted');
  const e2 = await c.get(`/api/estimates/${est.id}`);
  assert.equal(e2.approved_name, 'Tom Becker');
  const nj = await c.get(`/api/jobs/${e2.job_id}`);
  assert.equal(nj.items.filter(l => l.kind !== 'discount').length, 2);
  assert.ok(nj.items.some(l => l.kind === 'discount' && l.unit_price === -100), 'estimate discount carries over');
});

test('requests: public form with honeypot, conversion matches existing customers', async () => {
  const anon = { 'Content-Type': 'application/json' };
  const bot = await (await fetch(`${H.base}/public/requests`, { method: 'POST', headers: anon, body: JSON.stringify({ name: 'Bot', email: 'b@example.com', website: 'spam.example' }) })).json();
  assert.equal(bot.number, 'REQ-OK');
  const r = await (await fetch(`${H.base}/public/requests`, { method: 'POST', headers: anon, body: JSON.stringify({ name: 'Tom Becker', email: 'maint@lakeshore.example', service: 'Conveyor stops', details: 'Line 3 conveyor stops randomly', address: '4100 52nd St, Kenosha, WI 53144' }) })).json();
  assert.match(r.number, /^REQ-/);
  const list = await c.get('/api/requests');
  const req = list.find(x => x.number === r.number);
  const conv = await c.post(`/api/requests/${req.id}/convert`, { to: 'job' });
  assert.equal(conv.customer_id, customer.id, 'matched by email instead of creating a duplicate');
  assert.equal(conv.customer_created, false);
  const nr = await c.post('/api/requests', { name: 'Brand New', phone: '414-555-0000', address: '1 Main St, Racine, WI 53403', details: 'Need a quote' });
  const conv2 = await c.post(`/api/requests/${nr.id}/convert`, { to: 'estimate' });
  assert.equal(conv2.customer_created, true);
  const cust = await c.get(`/api/customers/${conv2.customer_id}`);
  assert.equal(cust.status, 'lead');
  assert.equal(cust.locations[0].city, 'Racine');
});

test('roles: field techs and viewers are limited', async () => {
  await c.post('/api/team', { name: 'Field Tech', kind: 'human', role: 'field', email: 'tech@example.com', password: 'fieldtech123' });
  await c.post('/api/team', { name: 'Book Keeper', kind: 'human', role: 'viewer', email: 'books@example.com', password: 'viewer12345' });
  const f = new Client(H.base); await f.ok('POST', '/api/login', { email: 'tech@example.com', password: 'fieldtech123' });
  assert.equal((await f.req('GET', '/api/invoices')).status, 403, 'field techs cannot see invoices');
  assert.equal((await f.req('POST', '/api/customers', { name: 'x' })).status, 403);
  assert.equal((await f.req('POST', `/api/visits/${visit.id}/status`, { status: 'scheduled' })).status, 403, 'not their visit');
  assert.equal((await f.req('POST', '/api/time', { hours: 1, user_id: 1 })).status, 403, 'cannot log time for others');
  await f.ok('POST', '/api/time', { hours: 1, description: 'Shop time' });
  const v = new Client(H.base); await v.ok('POST', '/api/login', { email: 'books@example.com', password: 'viewer12345' });
  assert.ok(Array.isArray(await v.get('/api/invoices')));
  assert.equal((await v.req('POST', '/api/tasks', { title: 'x' })).status, 403, 'viewers are read-only');
});

test('tasks, notes, plans, reports, search, exports, backup', async () => {
  const t = await c.post('/api/tasks', { title: 'Call Tom', assigned_to: 'me', related_type: 'customer', related_id: customer.id, due_date: '2026-01-01' });
  assert.equal(t.customer_id, customer.id);
  assert.ok((await c.get('/api/tasks?assigned_to=me&due=overdue')).some(x => x.id === t.id));
  await c.put(`/api/tasks/${t.id}`, { status: 'done', result: 'Left voicemail' });
  await c.post('/api/notes', { entity_type: 'customer', entity_id: customer.id, body: 'Prefers mornings', kind: 'call' });
  const cust = await c.get(`/api/customers/${customer.id}`);
  assert.ok(cust.activity.some(a => a.body === 'Prefers mornings'));
  assert.ok(cust.activity.some(a => /Task done: Call Tom/.test(a.body)));
  // service plan generates a job inside its lead window, once
  const due = futureWeekday(5);
  const plan = await c.post('/api/plans', { customer_id: customer.id, name: 'Quarterly PM', interval_value: 3, interval_unit: 'month', next_due: due, lead_days: 14, price: 240, checklist: 'Back up PLC\nThermal scan' });
  assert.equal(plan.jobs.length, 1);
  assert.ok(plan.next_due > due, 'next due date advanced');
  const pj = await c.get(`/api/jobs/${plan.jobs[0].id}`);
  assert.equal(pj.visits.length, 1, 'visit auto-booked');
  assert.equal(pj.checklist.length, 2);
  assert.equal(pj.items[0].unit_price, 240);
  assert.equal(require('../lib/services/plans').generate({}).length, 0, 'no duplicate jobs');
  for (const k of ['summary', 'revenue', 'profitability', 'team', 'customers', 'pipeline', 'kpis']) assert.ok(await c.get(`/api/reports/${k}`));
  const b = await c.get('/api/briefing');
  assert.ok(Array.isArray(b.suggested_actions));
  assert.ok((await c.get('/api/search?q=Lakeshore')).some(x => x.kind === 'customer'));
  const csv = await fetch(`${H.base}/api/export/invoices.csv`, { headers: { Cookie: c.cookie } });
  assert.match(await csv.text(), /number,customer/);
  const bk = await fetch(`${H.base}/api/backup`, { headers: { Cookie: c.cookie } });
  assert.equal(bk.status, 200);
  assert.equal(Buffer.from(await bk.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
});

test('blank form fields fall back to sensible defaults instead of failing', async () => {
  const item = await c.post('/api/pricebook', { name: 'Trip charge', price: '95', cost: '', unit: '', category: '' });
  assert.equal(item.cost, 0);
  assert.equal(item.price, 95);
  const j = await c.put(`/api/jobs/${job.id}`, { budget_hours: '', budget_amount: '', due_date: '' });
  assert.equal(j.budget_hours, 0);
  assert.equal(j.due_date, null, 'a cleared date is null, not an empty string');
  const x = await c.post('/api/expenses', { category: 'fuel', amount: '42.10', miles: '', markup_pct: '' });
  assert.equal(x.miles, 0);
  const m = await c.post('/api/expenses', { category: 'mileage', miles: '10' });
  assert.equal(m.amount, 7, 'miles x default mileage rate');
  const u = await c.post('/api/team', { name: 'Helper', kind: 'human', role: 'field', cost_rate: '', bill_rate: '' });
  assert.equal(u.cost_rate, 0);
  assert.equal((await c.req('POST', '/api/tasks', { title: 'x', due_date: '2026-02-30' })).status, 400, 'impossible dates are rejected');
});

test('photo upload and authenticated download', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const a = await c.ok('POST', `/api/attachments?entity_type=job&entity_id=${job.id}&filename=before.png&kind=photo`, png, { 'Content-Type': 'image/png' });
  assert.equal(a.mime, 'image/png');
  const dl = await fetch(`${H.base}/api/attachments/${a.id}/file`, { headers: { Cookie: c.cookie } });
  assert.equal(dl.status, 200);
  assert.equal((await fetch(`${H.base}/api/attachments/${a.id}/file`)).status, 401, 'not public');
  const bad = await c.req('POST', `/api/attachments?entity_type=job&entity_id=${job.id}&filename=x.html`, Buffer.from('<script>'), { 'Content-Type': 'text/html' });
  assert.equal(bad.status, 400, 'html uploads rejected');
});

test('sample data loads and removes cleanly without touching real records', async () => {
  const before = (await c.get('/api/customers')).length;
  const r = await c.post('/api/demo/load');
  assert.ok(r.customers >= 10 && r.jobs > 40 && r.invoices > 20);
  assert.equal((await c.req('POST', '/api/demo/load')).status, 409);
  await c.post('/api/demo/remove');
  assert.equal((await c.get('/api/customers')).length, before);
  assert.ok((await c.get(`/api/customers/${customer.id}`)).id);
});
