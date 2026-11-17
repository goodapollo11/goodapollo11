'use strict';
// Time tracking (timers, timesheets, billable hours) and expenses / mileage.
const { all, get, run, insert, update, tx, now } = require('../db');
const { bad, notFound, forbidden, str, num, round2, pick, isDate, parseWhen, localDate } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const { tz, today, n } = require('../config');
const A = require('./activity');
const { emit } = require('../events');

const CATEGORIES = ['labor', 'travel', 'consulting', 'admin', 'training', 'other'];
const EXP_CATEGORIES = ['materials', 'fuel', 'mileage', 'tools', 'equipment', 'meals', 'lodging', 'subcontractor', 'software', 'office', 'other'];

function resolveUser(userId, ctx) {
  let uid = userId === 'me' || userId == null || userId === '' ? null : Number(userId);
  if (!uid) {
    if (!ctx.user || !ctx.user.id) bad('user_id is required.');
    if (ctx.user.kind === 'ai') bad('user_id is required when AI staff log time - whose time is it? Use list_team to find the person.');
    uid = ctx.user.id;
  }
  if (ctx.user && ctx.user.role === 'field' && uid !== ctx.user.id) forbidden('Field technicians can only log their own time.');
  const u = get('SELECT * FROM users WHERE id=:id', { id: uid }) || notFound('Team member');
  return u;
}
function rates(u) {
  return { bill_rate: u.bill_rate || n('default_bill_rate', 0), cost_rate: u.cost_rate || n('default_cost_rate', 0) };
}
function jobRow(jobId) { return jobId ? (get('SELECT * FROM jobs WHERE id=:id', { id: jobId }) || notFound('Job')) : null; }

function runningFor(userId) {
  return get(`SELECT t.*, j.number job_number, j.title job_title, c.name customer_name FROM time_entries t LEFT JOIN jobs j ON j.id=t.job_id LEFT JOIN customers c ON c.id=j.customer_id
    WHERE t.user_id=:u AND t.started_at IS NOT NULL AND t.ended_at IS NULL ORDER BY t.started_at DESC LIMIT 1`, { u: userId });
}
function stopEntry(e, { lat, lng, description } = {}, ctx) {
  const end = new Date();
  const hours = Math.max(0.01, round2((end - new Date(e.started_at)) / 36e5));
  update('time_entries', e.id, { ended_at: end.toISOString(), hours, end_lat: lat ?? null, end_lng: lng ?? null, ...(description ? { description } : {}), updated_at: now() });
  if (e.job_id) A.log('job', e.job_id, `Clocked out: ${hours.toFixed(2)} h${e.description ? ` (${e.description})` : ''}.`, { ctx });
  emit('time.logged', { id: e.id, user_id: e.user_id, job_id: e.job_id, hours }, ctx);
  return get('SELECT * FROM time_entries WHERE id=:id', { id: e.id });
}
function startTimer({ user, jobId = null, visitId = null, description = '', category = 'labor', lat = null, lng = null, billable }, ctx) {
  return tx(() => {
    const cur = runningFor(user.id);
    if (cur) stopEntry(cur, { lat, lng }, ctx);
    const job = jobRow(jobId);
    const t = now();
    const id = insert('time_entries', {
      user_id: user.id, job_id: jobId, visit_id: visitId, work_date: today(), started_at: t, ended_at: null, hours: 0,
      category, description: str(description), billable: billable !== undefined ? (billable ? 1 : 0) : (job && job.billing === 'hourly' ? 1 : 0),
      ...rates(user), start_lat: lat, start_lng: lng, created_at: t, updated_at: t
    });
    if (job) A.log('job', job.id, `${user.name} clocked in.`, { ctx });
    return get('SELECT * FROM time_entries WHERE id=:id', { id });
  });
}
function stopTimersForVisit(visitId, coords, ctx) {
  for (const e of all('SELECT * FROM time_entries WHERE visit_id=:v AND started_at IS NOT NULL AND ended_at IS NULL', { v: visitId })) stopEntry(e, coords, ctx);
}

const TIME_SELECT = `SELECT t.*, u.name user_name, j.number job_number, j.title job_title, c.name customer_name, i.number invoice_number
  FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id LEFT JOIN customers c ON c.id=j.customer_id LEFT JOIN invoices i ON i.id=t.invoice_id`;

op({
  name: 'list_time_entries', method: 'GET', path: '/api/time', tags: ['Time & expenses'], roles: R.ALL,
  title: 'List time entries', description: 'Timesheet entries. Filter by person (user_id or "me"), job, date range, billable or unbilled. Running timers have ended_at = null.',
  input: S.obj({ user_id: { type: ['string', 'integer'], description: 'Team member id, or "me"' }, job_id: S.idOpt, from: S.date, to: S.date, billable: S.bool(), unbilled: S.bool('Only billable hours not yet on an invoice'), category: S.enum(CATEGORIES), limit: S.limit }),
  handler: (i, ctx) => {
    const w = []; const p = { l: i.limit || 300 };
    let uid = i.user_id === 'me' ? ctx.user.id : i.user_id ? Number(i.user_id) : null;
    if (ctx.user.role === 'field') uid = ctx.user.id;
    if (uid) { w.push('t.user_id=:u'); p.u = uid; }
    if (i.job_id) { w.push('t.job_id=:j'); p.j = i.job_id; }
    if (i.from) { w.push('t.work_date >= :f'); p.f = i.from; }
    if (i.to) { w.push('t.work_date <= :to'); p.to = i.to; }
    if (i.billable !== undefined && i.billable !== null) { w.push('t.billable=:b'); p.b = i.billable ? 1 : 0; }
    if (i.unbilled) w.push('t.billable=1 AND t.invoice_id IS NULL AND t.ended_at IS NOT NULL');
    if (i.category) { w.push('t.category=:c'); p.c = i.category; }
    return all(`${TIME_SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY t.work_date DESC, t.started_at DESC, t.id DESC LIMIT :l`, p);
  }
});

const TIME_FIELDS = {
  job_id: S.idOpt, visit_id: S.idOpt, work_date: S.date, hours: S.num('Hours worked (or give started_at + ended_at)', { minimum: 0, maximum: 24 }),
  started_at: { type: ['string', 'null'], format: 'date-time' }, ended_at: { type: ['string', 'null'], format: 'date-time' },
  category: S.enum(CATEGORIES), description: S.str('What was done', 2000), billable: S.bool('Bill this time to the customer'),
  bill_rate: S.num('Hourly rate charged (default: person\'s bill rate)', { minimum: 0 }), cost_rate: S.num('Hourly cost (default: person\'s cost rate)', { minimum: 0 })
};
op({
  name: 'log_time', method: 'POST', path: '/api/time', tags: ['Time & expenses'], roles: R.STAFF,
  title: 'Log time', description: 'Record hours worked by a team member, optionally against a job. AI staff must pass user_id. Billable defaults to true for hourly jobs.',
  input: S.obj({ user_id: { type: ['string', 'integer'], description: 'Team member id, or "me"' }, ...TIME_FIELDS }),
  handler: (i, ctx) => {
    const u = resolveUser(i.user_id, ctx);
    const job = jobRow(i.job_id);
    let hours = i.hours, start = null, end = null;
    if (i.started_at && i.ended_at) {
      start = parseWhen(i.started_at, tz()); end = parseWhen(i.ended_at, tz());
      if (!start || !end || end <= start) bad('ended_at must be after started_at.');
      hours = round2((end - start) / 36e5);
    }
    if (!hours || hours <= 0) bad('hours must be greater than zero (or give started_at and ended_at).');
    if (hours > 24) bad('hours cannot exceed 24 for one entry.');
    const t = now();
    const id = insert('time_entries', {
      user_id: u.id, job_id: job ? job.id : null, visit_id: i.visit_id || null,
      work_date: i.work_date || (start ? localDate(start, tz()) : today()), started_at: start ? start.toISOString() : null, ended_at: end ? end.toISOString() : null,
      hours: round2(hours), category: i.category || (job && job.type === 'consulting' ? 'consulting' : 'labor'), description: str(i.description),
      billable: i.billable !== undefined && i.billable !== null ? (i.billable ? 1 : 0) : (job && job.billing === 'hourly' ? 1 : 0),
      bill_rate: i.bill_rate ?? rates(u).bill_rate, cost_rate: i.cost_rate ?? rates(u).cost_rate, created_at: t, updated_at: t
    });
    if (job) A.log('job', job.id, `Logged ${round2(hours)} h for ${u.name}${i.description ? `: ${i.description}` : ''}.`, { ctx });
    emit('time.logged', { id, user_id: u.id, job_id: job && job.id, hours }, ctx);
    return get(`${TIME_SELECT} WHERE t.id=:id`, { id });
  }
});
op({
  name: 'start_timer', method: 'POST', path: '/api/time/start', tags: ['Time & expenses'], roles: R.STAFF,
  title: 'Clock in / start timer', description: 'Start a running timer for a team member (stops any timer they already have running).',
  input: S.obj({ user_id: { type: ['string', 'integer'] }, job_id: S.idOpt, visit_id: S.idOpt, description: S.str(), category: S.enum(CATEGORIES), billable: S.bool(), lat: { type: ['number', 'null'] }, lng: { type: ['number', 'null'] } }),
  handler: (i, ctx) => {
    const u = resolveUser(i.user_id, ctx);
    return startTimer({ user: u, jobId: i.job_id || null, visitId: i.visit_id || null, description: i.description, category: i.category || 'labor', lat: i.lat, lng: i.lng, billable: i.billable ?? undefined }, ctx);
  }
});
op({
  name: 'stop_timer', method: 'POST', path: '/api/time/stop', tags: ['Time & expenses'], roles: R.STAFF,
  title: 'Clock out / stop timer', description: 'Stop a team member\'s running timer and record the hours.',
  input: S.obj({ user_id: { type: ['string', 'integer'] }, id: S.idOpt, description: S.str(), lat: { type: ['number', 'null'] }, lng: { type: ['number', 'null'] } }),
  handler: (i, ctx) => {
    let e;
    if (i.id) { e = get('SELECT * FROM time_entries WHERE id=:id AND ended_at IS NULL AND started_at IS NOT NULL', { id: i.id }) || bad('That timer is not running.'); if (ctx.user.role === 'field' && e.user_id !== ctx.user.id) forbidden(); }
    else { const u = resolveUser(i.user_id, ctx); e = runningFor(u.id) || bad(`${u.name} has no running timer.`); }
    return stopEntry(e, i, ctx);
  }
});
op({
  name: 'get_running_timers', method: 'GET', path: '/api/time/running', tags: ['Time & expenses'], roles: R.ALL,
  title: 'Who is on the clock', description: 'Running timers: who is clocked in right now and on which job. Pass user_id="me" for just your own.',
  input: S.obj({ user_id: { type: ['string', 'integer'] } }),
  handler: (i, ctx) => {
    const uid = i.user_id === 'me' ? ctx.user.id : i.user_id ? Number(i.user_id) : null;
    return all(`${TIME_SELECT} WHERE t.started_at IS NOT NULL AND t.ended_at IS NULL ${uid ? 'AND t.user_id=:u' : ''} ORDER BY t.started_at`, { u: uid });
  }
});
op({
  name: 'update_time_entry', method: 'PUT', path: '/api/time/:id', tags: ['Time & expenses'], roles: R.STAFF,
  title: 'Edit time entry', input: S.obj({ id: S.id, user_id: { type: ['string', 'integer'] }, ...TIME_FIELDS }, ['id']),
  handler: (i, ctx) => {
    const e = get('SELECT * FROM time_entries WHERE id=:id', { id: i.id }) || notFound('Time entry');
    if (ctx.user.role === 'field' && e.user_id !== ctx.user.id) forbidden('Field technicians can only edit their own time.');
    if (e.invoice_id) bad('This time is already on an invoice. Void or edit the invoice first.');
    const o = pick(i, ['job_id', 'visit_id', 'work_date', 'hours', 'category', 'description', 'bill_rate', 'cost_rate']);
    if (i.billable !== undefined && i.billable !== null) o.billable = i.billable ? 1 : 0;
    if (i.user_id && ['owner', 'admin', 'office'].includes(ctx.user.role)) o.user_id = resolveUser(i.user_id, ctx).id;
    if (i.started_at && i.ended_at) {
      const s = parseWhen(i.started_at, tz()), en = parseWhen(i.ended_at, tz());
      if (!s || !en || en <= s) bad('ended_at must be after started_at.');
      Object.assign(o, { started_at: s.toISOString(), ended_at: en.toISOString(), hours: round2((en - s) / 36e5) });
    }
    if (o.hours !== undefined && (o.hours <= 0 || o.hours > 24)) bad('hours must be between 0 and 24.');
    update('time_entries', e.id, { ...o, updated_at: now() });
    return get(`${TIME_SELECT} WHERE t.id=:id`, { id: e.id });
  }
});
op({
  name: 'delete_time_entry', method: 'DELETE', path: '/api/time/:id', tags: ['Time & expenses'], roles: R.STAFF, mcp: false,
  title: 'Delete time entry', input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const e = get('SELECT * FROM time_entries WHERE id=:id', { id: i.id }) || notFound('Time entry');
    if (ctx.user.role === 'field' && e.user_id !== ctx.user.id) forbidden();
    if (e.invoice_id) bad('This time is on an invoice. Void the invoice first.');
    run('DELETE FROM time_entries WHERE id=:id', { id: e.id });
    return { ok: true };
  }
});

// ---------------- expenses & mileage ----------------
const EXP_SELECT = `SELECT x.*, u.name user_name, j.number job_number, j.title job_title, c.name customer_name, i.number invoice_number
  FROM expenses x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN jobs j ON j.id=x.job_id LEFT JOIN customers c ON c.id=j.customer_id LEFT JOIN invoices i ON i.id=x.invoice_id`;
const EXP_FIELDS = {
  expense_date: S.date, category: S.enum(EXP_CATEGORIES), vendor: S.str('', 200), description: S.str('', 2000),
  amount: S.num('Amount spent. For mileage, leave blank to use miles x mileage rate.', { minimum: 0 }), miles: S.num('Miles driven (mileage)', { minimum: 0 }),
  job_id: S.idOpt, billable: S.bool('Re-bill to the customer on the job invoice'), markup_pct: S.num('Markup % when re-billed', { minimum: 0, maximum: 500 }), receipt_id: S.idOpt
};
op({
  name: 'list_expenses', method: 'GET', path: '/api/expenses', tags: ['Time & expenses'], roles: R.ALL,
  title: 'List expenses', description: 'Expenses and mileage. Filter by job, person, category or date range.',
  input: S.obj({ job_id: S.idOpt, user_id: { type: ['string', 'integer'] }, category: S.enum(EXP_CATEGORIES), from: S.date, to: S.date, unbilled: S.bool(), limit: S.limit }),
  handler: (i, ctx) => {
    const w = []; const p = { l: i.limit || 300 };
    let uid = i.user_id === 'me' ? ctx.user.id : i.user_id ? Number(i.user_id) : null;
    if (ctx.user.role === 'field') uid = ctx.user.id;
    if (uid) { w.push('x.user_id=:u'); p.u = uid; }
    if (i.job_id) { w.push('x.job_id=:j'); p.j = i.job_id; }
    if (i.category) { w.push('x.category=:c'); p.c = i.category; }
    if (i.from) { w.push('x.expense_date >= :f'); p.f = i.from; }
    if (i.to) { w.push('x.expense_date <= :to'); p.to = i.to; }
    if (i.unbilled) w.push('x.billable=1 AND x.invoice_id IS NULL');
    return all(`${EXP_SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY x.expense_date DESC, x.id DESC LIMIT :l`, p);
  }
});
function expenseValues(i, cur = {}) {
  const o = pick(i, ['expense_date', 'category', 'vendor', 'description', 'amount', 'miles', 'job_id', 'markup_pct', 'receipt_id']);
  if (i.billable !== undefined && i.billable !== null) o.billable = i.billable ? 1 : 0;
  const cat = o.category || cur.category || 'materials';
  const miles = o.miles ?? cur.miles ?? 0;
  if (cat === 'mileage' && (o.amount === undefined || o.amount === null) && miles > 0) o.amount = round2(miles * n('mileage_rate', 0.7));
  if (o.amount !== undefined && o.amount !== null) o.amount = round2(o.amount);
  return o;
}
op({
  name: 'log_expense', method: 'POST', path: '/api/expenses', tags: ['Time & expenses'], roles: R.STAFF,
  title: 'Log expense or mileage', description: 'Record a purchase, fuel, tools, subcontractor cost or mileage. Link to a job to include it in job costing; mark billable to re-bill it.',
  input: S.obj({ user_id: { type: ['string', 'integer'] }, ...EXP_FIELDS }),
  handler: (i, ctx) => {
    const u = ctx.user.kind === 'ai' && !i.user_id ? null : resolveUser(i.user_id, ctx);
    if (i.job_id) jobRow(i.job_id);
    const o = expenseValues(i);
    if (!(o.amount > 0)) bad('amount must be greater than zero (or give miles for mileage).');
    const t = now();
    const id = insert('expenses', { category: 'materials', ...o, user_id: u ? u.id : null, expense_date: o.expense_date || today(), created_at: t, updated_at: t });
    if (o.job_id) A.log('job', o.job_id, `Expense logged: ${o.category || 'materials'} $${o.amount.toFixed(2)}${o.vendor ? ` at ${o.vendor}` : ''}.`, { ctx });
    emit('expense.logged', { id, job_id: o.job_id || null, amount: o.amount }, ctx);
    return get(`${EXP_SELECT} WHERE x.id=:id`, { id });
  }
});
op({
  name: 'update_expense', method: 'PUT', path: '/api/expenses/:id', tags: ['Time & expenses'], roles: R.STAFF,
  title: 'Edit expense', input: S.obj({ id: S.id, ...EXP_FIELDS }, ['id']),
  handler: (i, ctx) => {
    const x = get('SELECT * FROM expenses WHERE id=:id', { id: i.id }) || notFound('Expense');
    if (ctx.user.role === 'field' && x.user_id !== ctx.user.id) forbidden();
    if (x.invoice_id) bad('This expense is on an invoice. Void the invoice first.');
    update('expenses', x.id, { ...expenseValues(i, x), updated_at: now() });
    return get(`${EXP_SELECT} WHERE x.id=:id`, { id: x.id });
  }
});
op({
  name: 'delete_expense', method: 'DELETE', path: '/api/expenses/:id', tags: ['Time & expenses'], roles: R.STAFF, mcp: false,
  title: 'Delete expense', input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const x = get('SELECT * FROM expenses WHERE id=:id', { id: i.id }) || notFound('Expense');
    if (ctx.user.role === 'field' && x.user_id !== ctx.user.id) forbidden();
    if (x.invoice_id) bad('This expense is on an invoice. Void the invoice first.');
    run('DELETE FROM expenses WHERE id=:id', { id: x.id });
    return { ok: true };
  }
});

module.exports = { startTimer, stopEntry, runningFor, stopTimersForVisit, resolveUser, rates, CATEGORIES, EXP_CATEGORIES, TIME_SELECT, EXP_SELECT };
