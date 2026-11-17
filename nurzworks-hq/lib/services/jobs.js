'use strict';
// Jobs (the work for a customer) and visits (scheduled appointments in the field).
const { all, get, run, insert, update, tx, now, nextNumber } = require('../db');
const { bad, notFound, forbidden, str, round2, pick, parseWhen, localDate, zonedToUtc, addDays, addressLine, fmtLocal, zonedParts } = require('../util');
const { op, S, PRIORITY } = require('../ops');
const { R } = require('../auth');
const { tz, today, n } = require('../config');
const { setting } = require('../db');
const A = require('./activity');
const L = require('./pricebook');
const T = require('./time');
const C = require('./customers');
const { emit } = require('../events');

const TYPES = ['service', 'repair', 'installation', 'maintenance', 'inspection', 'consulting', 'project', 'emergency', 'other'];
const STATUS = ['unscheduled', 'scheduled', 'in_progress', 'on_hold', 'completed', 'invoiced', 'cancelled'];
const STATUS_LABEL = { unscheduled: 'Unscheduled', scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed', invoiced: 'Invoiced', cancelled: 'Cancelled' };
const OPEN = "('unscheduled','scheduled','in_progress','on_hold')";
const BILLING = ['fixed', 'hourly', 'no_charge'];
const VISIT_STATUS = ['scheduled', 'en_route', 'on_site', 'completed', 'cancelled'];
const VISIT_LABEL = { scheduled: 'Scheduled', en_route: 'On the way', on_site: 'On site', completed: 'Completed', cancelled: 'Cancelled' };

function checklistIn(v) {
  if (v === undefined || v === null) return undefined;
  const arr = Array.isArray(v) ? v : String(v).split('\n');
  return JSON.stringify(arr.map(x => (typeof x === 'string' ? { text: x.trim(), done: false } : { text: str(x.text), done: !!x.done })).filter(x => x.text).slice(0, 100));
}
function userIds(ids) {
  const out = [...new Set((ids || []).map(Number).filter(Boolean))];
  for (const id of out) if (!get('SELECT id FROM users WHERE id=:id AND active=1', { id })) bad(`Team member ${id} not found or inactive.`);
  return out;
}
function inList(ids, prefix = 'u') { const p = {}; ids.forEach((v, i) => { p[prefix + i] = v; }); return { sql: ids.map((_, i) => ':' + prefix + i).join(',') || 'NULL', p }; }

// ---------------- reads ----------------
const JOB_SELECT = `SELECT j.*, c.name customer_name, c.phone customer_phone, c.email customer_email, c.number customer_number,
  l.name location_name, l.street, l.city, l.state, l.zip, l.access_notes, l.lat, l.lng, u.name assignee,
  (SELECT COALESCE(SUM(round(qty*unit_price,2)),0) FROM line_items li WHERE li.parent_type='job' AND li.parent_id=j.id) items_total,
  (SELECT MIN(start_at) FROM visits v WHERE v.job_id=j.id AND v.status IN ('scheduled','en_route','on_site')) next_visit,
  (SELECT COUNT(*) FROM visits v WHERE v.job_id=j.id AND v.status != 'cancelled') visit_count
  FROM jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN locations l ON l.id=j.location_id LEFT JOIN users u ON u.id=j.assigned_to`;

function visitAssignees(visitId) {
  return all('SELECT u.id, u.name, u.color, u.kind FROM visit_assignees a JOIN users u ON u.id=a.user_id WHERE a.visit_id=:v ORDER BY u.name', { v: visitId });
}
const VISIT_SELECT = `SELECT v.*, j.number job_number, j.title job_title, j.type job_type, j.priority, j.status job_status, j.customer_id, j.description job_description,
  c.name customer_name, c.phone customer_phone, c.email customer_email, l.name location_name, l.street, l.city, l.state, l.zip, l.access_notes, l.lat, l.lng,
  (SELECT group_concat(a.user_id) FROM visit_assignees a WHERE a.visit_id=v.id) assignee_ids
  FROM visits v JOIN jobs j ON j.id=v.job_id JOIN customers c ON c.id=j.customer_id LEFT JOIN locations l ON l.id=j.location_id`;
function decorateVisit(v) {
  if (!v) return v;
  v.assignees = visitAssignees(v.id);
  v.address = addressLine(v);
  delete v.assignee_ids;
  v.local = { start: fmtLocal(v.start_at, tz(), { weekday: 'short' }), end: fmtLocal(v.end_at, tz(), { month: undefined, day: undefined }) };
  return v;
}
function getVisit(id) { return decorateVisit(get(`${VISIT_SELECT} WHERE v.id=:id`, { id })) || notFound('Visit'); }

function financials(job, items, time, expenses, invoices) {
  const revenueItems = round2(items.reduce((s, l) => s + l.total, 0));
  const materials = round2(items.reduce((s, l) => s + round2(l.qty * l.unit_cost), 0));
  const laborHours = round2(time.reduce((s, t) => s + (t.hours || 0), 0));
  const laborCost = round2(time.reduce((s, t) => s + (t.hours || 0) * (t.cost_rate || 0), 0));
  const expenseCost = round2(expenses.reduce((s, x) => s + x.amount, 0));
  const unbilledTime = time.filter(t => t.billable && !t.invoice_id && t.ended_at !== null);
  const unbilledHours = round2(unbilledTime.reduce((s, t) => s + t.hours, 0));
  const unbilledTimeAmt = round2(unbilledTime.reduce((s, t) => s + t.hours * t.bill_rate, 0));
  const unbilledExp = round2(expenses.filter(x => x.billable && !x.invoice_id).reduce((s, x) => s + x.amount * (1 + (x.markup_pct || 0) / 100), 0));
  const invoiced = round2(invoices.filter(i => i.status !== 'void').reduce((s, i) => s + i.subtotal - i.discount, 0));
  const billableTime = round2(time.filter(t => t.billable).reduce((s, t) => s + t.hours * t.bill_rate, 0));
  const revenue = invoiced || round2(revenueItems + (job.billing === 'hourly' ? billableTime : 0) + unbilledExp);
  const cost = round2(materials + laborCost + expenseCost);
  return {
    revenue, revenue_basis: invoiced ? 'invoiced' : 'estimated', items_total: revenueItems, materials_cost: materials, labor_hours: laborHours, labor_cost: laborCost,
    expense_cost: expenseCost, total_cost: cost, profit: round2(revenue - cost), margin_pct: revenue > 0 ? Math.round(1000 * (revenue - cost) / revenue) / 10 : null,
    unbilled_hours: unbilledHours, unbilled_time_amount: unbilledTimeAmt, unbilled_expenses: unbilledExp,
    uninvoiced_items: round2(items.filter(l => !l.invoice_id).reduce((s, l) => s + l.total, 0)),
    budget_hours_used_pct: job.budget_hours ? Math.round(100 * laborHours / job.budget_hours) : null
  };
}

function getJob(id) {
  const j = get(`${JOB_SELECT} WHERE j.id=:id`, { id }) || notFound('Job');
  j.checklist = JSON.parse(j.checklist || '[]');
  j.address = addressLine(j);
  j.visits = all(`${VISIT_SELECT} WHERE v.job_id=:id ORDER BY v.start_at`, { id }).map(decorateVisit);
  j.items = L.getLines('job', id);
  j.time = all(`${T.TIME_SELECT} WHERE t.job_id=:id ORDER BY t.work_date DESC, t.id DESC`, { id });
  j.expenses = all(`${T.EXP_SELECT} WHERE x.job_id=:id ORDER BY x.expense_date DESC`, { id });
  j.invoices = all('SELECT id, number, status, subtotal, discount, total, balance, issue_date, due_date FROM invoices WHERE job_id=:id ORDER BY id', { id });
  j.attachments = A.attachmentsFor('job', id);
  j.activity = A.listFor('job', id, 100);
  j.estimate = j.estimate_id ? get('SELECT id, number, title, status, total FROM estimates WHERE id=:id', { id: j.estimate_id }) : null;
  j.plan = j.plan_id ? get('SELECT id, number, name FROM plans WHERE id=:id', { id: j.plan_id }) : null;
  j.request = j.request_id ? get('SELECT id, number, name FROM requests WHERE id=:id', { id: j.request_id }) : null;
  j.financials = financials(j, j.items, j.time, j.expenses, j.invoices);
  j.status_label = STATUS_LABEL[j.status];
  return j;
}

op({
  name: 'list_jobs', method: 'GET', path: '/api/jobs', tags: ['Jobs'], roles: R.ALL,
  title: 'List / search jobs', description: 'Jobs (work orders). status: a job status, or "open" (not completed/invoiced/cancelled), "to_invoice" (completed, not invoiced), "unscheduled". assigned_to matches the job owner or anyone on its visits; use "me" for yourself.',
  input: S.obj({
    q: S.str('Search number, title, customer, address'), status: S.enum([...STATUS, 'open', 'to_invoice', 'all']), customer_id: S.idOpt,
    assigned_to: { type: ['string', 'integer'], description: 'Team member id, "me" or "none"' }, type: S.enum(TYPES), priority: S.enum(PRIORITY),
    from: S.date, to: S.date, sort: S.enum(['number', 'created', 'next_visit', 'priority', 'customer']), limit: S.limit, offset: S.offset
  }),
  handler: (i, ctx) => {
    const w = []; const p = { l: i.limit || 200, o: i.offset || 0 };
    const st = i.status || 'open';
    if (st === 'open') w.push(`j.status IN ${OPEN}`);
    else if (st === 'to_invoice') w.push("j.status='completed' AND j.billing != 'no_charge'");
    else if (st !== 'all') { w.push('j.status=:s'); p.s = st; }
    if (i.q) { w.push('(j.number LIKE :q OR j.title LIKE :q OR j.description LIKE :q OR c.name LIKE :q OR l.street LIKE :q OR l.city LIKE :q)'); p.q = `%${i.q}%`; }
    if (i.customer_id) { w.push('j.customer_id=:c'); p.c = i.customer_id; }
    let a = i.assigned_to === 'me' ? ctx.user.id : i.assigned_to;
    if (ctx.user.role === 'field' && !a) a = ctx.user.id;
    if (a === 'none') w.push('j.assigned_to IS NULL AND NOT EXISTS (SELECT 1 FROM visits v JOIN visit_assignees x ON x.visit_id=v.id WHERE v.job_id=j.id)');
    else if (a) { w.push('(j.assigned_to=:a OR EXISTS (SELECT 1 FROM visits v JOIN visit_assignees x ON x.visit_id=v.id WHERE v.job_id=j.id AND x.user_id=:a))'); p.a = Number(a); }
    if (i.type) { w.push('j.type=:t'); p.t = i.type; }
    if (i.priority) { w.push('j.priority=:pr'); p.pr = i.priority; }
    if (i.from) { w.push('j.created_at >= :f'); p.f = i.from; }
    if (i.to) { w.push('j.created_at < :to'); p.to = addDays(i.to, 1); }
    const order = { number: 'j.id DESC', created: 'j.created_at DESC', next_visit: "COALESCE(next_visit,'9999') ASC", customer: 'c.name COLLATE NOCASE',
      priority: "CASE j.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, j.id DESC" }[i.sort] || 'j.id DESC';
    return all(`${JOB_SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${order} LIMIT :l OFFSET :o`, p)
      .map(r => { r.address = addressLine(r); delete r.checklist; return r; });
  }
});

op({
  name: 'get_job', method: 'GET', path: '/api/jobs/:id', tags: ['Jobs'], roles: R.ALL,
  title: 'Get job', description: 'Full job: customer, address and access notes, visits with crew, line items, checklist, time, expenses, photos, invoices, activity and job costing (revenue, cost, profit, unbilled work).',
  input: S.obj({ id: S.id }, ['id']),
  handler: i => getJob(i.id)
});

const SCHEDULE = S.obj({
  start: S.dateTime, end: { type: 'string', format: 'date-time' }, duration_minutes: S.int('Visit length if no end (default from settings)', { minimum: 5, maximum: 1440 }),
  assignees: { type: 'array', items: { type: 'integer' }, description: 'Team member ids (default: job owner)' }, notes: S.str('Instructions for the crew', 4000)
}, ['start'], 'Schedule the first visit right away');
const JOB_FIELDS = {
  customer_id: S.id, location_id: S.idOpt, title: S.str('Short summary of the work', 200), description: S.str('Scope / problem details', 10000),
  type: S.enum(TYPES), priority: S.enum(PRIORITY), billing: S.enum(BILLING, 'fixed = priced line items, hourly = bill time & materials, no_charge = warranty/internal'),
  assigned_to: S.idOpt, due_date: S.date, checklist: { type: ['array', 'string'], items: { type: ['string', 'object'] }, description: 'Steps: list of strings (or newline-separated text)' },
  customer_po: S.str('Customer PO / reference', 100), budget_hours: S.num('Hour budget (consulting / projects)', { minimum: 0 }), budget_amount: S.num('Dollar budget / not-to-exceed', { minimum: 0 })
};

op({
  name: 'create_job', method: 'POST', path: '/api/jobs', tags: ['Jobs'],
  title: 'Create job', description: 'Create a job for a customer. Location defaults to the customer\'s primary service address. Add line items (price book items or custom) and optionally schedule the first visit in the same call.',
  input: S.obj({ ...JOB_FIELDS, items: L.LINES, schedule: SCHEDULE, estimate_id: S.idOpt, request_id: S.idOpt, plan_id: S.idOpt }, ['customer_id', 'title']),
  handler: (i, ctx) => createJob(i, ctx)
});
function createJob(i, ctx, { isDemo = 0 } = {}) {
  const cust = get('SELECT * FROM customers WHERE id=:id', { id: i.customer_id }) || notFound('Customer');
  let loc = i.location_id ? get('SELECT * FROM locations WHERE id=:id', { id: i.location_id }) : C.primaryLocation(cust.id);
  if (i.location_id && (!loc || loc.customer_id !== cust.id)) bad('That location does not belong to this customer.');
  if (i.assigned_to) userIds([i.assigned_to]);
  const t = now();
  return tx(() => {
    const id = insert('jobs', {
      number: nextNumber('JOB', 'jobs'), customer_id: cust.id, location_id: loc ? loc.id : null, title: str(i.title), description: str(i.description),
      type: i.type || 'service', status: 'unscheduled', priority: i.priority || 'normal', billing: i.billing || (i.type === 'consulting' ? 'hourly' : 'fixed'),
      assigned_to: i.assigned_to || null, due_date: i.due_date || null, checklist: checklistIn(i.checklist) || '[]', customer_po: str(i.customer_po),
      budget_hours: i.budget_hours || 0, budget_amount: i.budget_amount || 0, estimate_id: i.estimate_id || null, request_id: i.request_id || null, plan_id: i.plan_id || null,
      created_by: ctx.actor, is_demo: isDemo, created_at: t, updated_at: t
    });
    if (i.items && i.items.length) L.addLines('job', id, i.items);
    if (cust.status === 'lead') { update('customers', cust.id, { status: 'active', updated_at: t }); A.log('customer', cust.id, 'Became an active customer (first job).', { ctx, kind: 'status' }); }
    A.log('job', id, `Job created${i.estimate_id ? ' from an approved estimate' : i.plan_id ? ' by a service plan' : i.request_id ? ' from a service request' : ''}.`, { ctx, isDemo });
    emit('job.created', { id }, ctx);
    if (i.schedule) createVisit(get('SELECT * FROM jobs WHERE id=:id', { id }), i.schedule, ctx, { isDemo });
    return getJob(id);
  });
}

op({
  name: 'update_job', method: 'PUT', path: '/api/jobs/:id', tags: ['Jobs'], roles: R.STAFF,
  title: 'Update job', description: 'Change job details. Only fields you send change. Use set_job_status to change status and schedule_visit to book time.',
  input: S.obj({ id: S.id, ...JOB_FIELDS, customer_id: S.idOpt, completion_notes: S.str('', 10000) }, ['id']),
  handler: (i, ctx) => {
    const cur = get('SELECT * FROM jobs WHERE id=:id', { id: i.id }) || notFound('Job');
    const o = pick(i, ['location_id', 'title', 'description', 'type', 'priority', 'billing', 'assigned_to', 'due_date', 'customer_po', 'budget_hours', 'budget_amount', 'completion_notes']);
    if (ctx.user.role === 'field') for (const k of Object.keys(o)) if (!['completion_notes', 'description'].includes(k)) delete o[k];
    if (i.checklist !== undefined) o.checklist = checklistIn(i.checklist);
    if (o.title === '') bad('title is required.');
    if (o.assigned_to) userIds([o.assigned_to]);
    if (o.location_id) { const l = get('SELECT customer_id FROM locations WHERE id=:id', { id: o.location_id }); if (!l || l.customer_id !== cur.customer_id) bad('That location does not belong to this customer.'); }
    const notes = [];
    if (o.assigned_to !== undefined && (o.assigned_to || null) !== cur.assigned_to) notes.push(`Job owner set to ${o.assigned_to ? get('SELECT name FROM users WHERE id=:id', { id: o.assigned_to }).name : 'nobody'}.`);
    if (o.priority && o.priority !== cur.priority) notes.push(`Priority changed from ${cur.priority} to ${o.priority}.`);
    if (o.due_date !== undefined && (o.due_date || null) !== cur.due_date) notes.push(`Due date set to ${o.due_date || 'none'}.`);
    const other = Object.keys(o).filter(k => !['assigned_to', 'priority', 'due_date', 'checklist'].includes(k) && String(o[k] ?? '') !== String(cur[k] ?? ''));
    if (other.length) notes.push(`Updated ${other.map(k => k.replace(/_/g, ' ')).join(', ')}.`);
    tx(() => {
      update('jobs', cur.id, { ...o, updated_at: now() });
      for (const m of notes) A.log('job', cur.id, m, { ctx });
      if (notes.length) emit('job.updated', { id: cur.id }, ctx);
      // keep calendar events in sync when visible details change
      if (o.title !== undefined || o.location_id !== undefined || o.description !== undefined)
        for (const v of all("SELECT id FROM visits WHERE job_id=:j AND status NOT IN ('cancelled')", { j: cur.id })) emit('visit.updated', { id: v.id, job_id: cur.id }, ctx);
    });
    return getJob(cur.id);
  }
});

op({
  name: 'set_checklist_item', method: 'POST', path: '/api/jobs/:id/checklist', tags: ['Jobs'], roles: R.STAFF,
  title: 'Check off a checklist step', description: 'Mark one checklist step done/undone by index (0-based), or add a step with add_text.',
  input: S.obj({ id: S.id, index: S.int('', { minimum: 0 }), done: S.bool(), add_text: S.str('', 500) }, ['id']),
  handler: (i, ctx) => {
    const j = get('SELECT * FROM jobs WHERE id=:id', { id: i.id }) || notFound('Job');
    const list = JSON.parse(j.checklist || '[]');
    if (i.add_text) list.push({ text: i.add_text, done: false });
    else {
      if (i.index === undefined || !list[i.index]) bad('No checklist step at that index.');
      list[i.index].done = !!i.done;
      if (i.done) A.log('job', j.id, `Checked off: ${list[i.index].text}`, { ctx });
    }
    update('jobs', j.id, { checklist: JSON.stringify(list), updated_at: now() });
    return { checklist: list };
  }
});

op({
  name: 'set_job_status', method: 'POST', path: '/api/jobs/:id/status', tags: ['Jobs'], roles: R.STAFF,
  title: 'Change job status', description: 'Move a job through its lifecycle: unscheduled, scheduled, in_progress, on_hold (give reason), completed (give completion notes), cancelled (give reason). Completing closes any visits still open.',
  input: S.obj({ id: S.id, status: S.enum(STATUS.filter(s => s !== 'invoiced')), reason: S.str('Hold / cancel reason', 1000), notes: S.str('Completion notes', 10000) }, ['id', 'status']),
  handler: (i, ctx) => setJobStatus(i.id, i.status, i, ctx)
});
function setJobStatus(id, status, { reason = '', notes = '' } = {}, ctx) {
  const cur = get('SELECT * FROM jobs WHERE id=:id', { id }) || notFound('Job');
  if (ctx.user.role === 'field' && !['in_progress', 'completed', 'on_hold'].includes(status)) forbidden('Field technicians can start, hold or complete jobs.');
  if (status === cur.status) return getJob(id);
  if (cur.status === 'invoiced' && status !== 'completed' && status !== 'cancelled') bad('This job is already invoiced. Void the invoice to reopen it.');
  if (status === 'on_hold' && !str(reason)) bad('Give a reason for putting the job on hold.');
  const t = now();
  tx(() => {
    const o = { status, updated_at: t };
    if (status === 'on_hold') o.hold_reason = str(reason);
    if (status === 'completed') { o.completed_at = t; if (notes) o.completion_notes = str(notes); }
    if (['unscheduled', 'scheduled', 'in_progress', 'on_hold'].includes(status)) o.completed_at = null;
    update('jobs', id, o);
    A.log('job', id, `Status changed from ${STATUS_LABEL[cur.status]} to ${STATUS_LABEL[status]}.${reason ? ` Reason: ${reason}` : ''}${status === 'completed' && notes ? ` Notes: ${notes}` : ''}`, { ctx, kind: 'status' });
    if (status === 'completed' || status === 'cancelled') {
      for (const v of all("SELECT * FROM visits WHERE job_id=:j AND status IN ('scheduled','en_route','on_site')", { j: id })) {
        const past = v.start_at <= t || v.status !== 'scheduled';
        const vs = status === 'completed' && past ? 'completed' : 'cancelled';
        update('visits', v.id, { status: vs, completed_at: vs === 'completed' ? t : null, updated_at: t });
        T.stopTimersForVisit(v.id, {}, ctx);
        emit(vs === 'cancelled' ? 'visit.cancelled' : 'visit.status_changed', { id: v.id, job_id: id, status: vs }, ctx);
      }
    }
    emit('job.status_changed', { id, from: cur.status, to: status }, ctx);
    if (status === 'completed') emit('job.completed', { id }, ctx);
  });
  return getJob(id);
}

op({
  name: 'add_job_items', method: 'POST', path: '/api/jobs/:id/items', tags: ['Jobs'], roles: R.STAFF,
  title: 'Add line items to a job', description: 'Add billable services, materials or fees used on a job. They are pulled onto the invoice when you invoice the job.',
  input: S.obj({ id: S.id, items: L.LINES }, ['id', 'items']),
  handler: (i, ctx) => {
    const j = get('SELECT * FROM jobs WHERE id=:id', { id: i.id }) || notFound('Job');
    if (!i.items.length) bad('items is empty.');
    tx(() => { L.addLines('job', j.id, i.items); A.log('job', j.id, `Added ${i.items.length} line item(s): ${i.items.map(x => x.name || 'price book item').join(', ')}.`, { ctx }); update('jobs', j.id, { updated_at: now() }); });
    return { items: L.getLines('job', j.id) };
  }
});
op({
  name: 'update_job_item', method: 'PUT', path: '/api/job-items/:id', tags: ['Jobs'], roles: R.STAFF, mcp: false,
  title: 'Edit a job line item', input: S.obj({ id: S.id, ...L.LINE.properties }, ['id']),
  handler: i => {
    const li = get("SELECT * FROM line_items WHERE id=:id AND parent_type='job'", { id: i.id }) || notFound('Line item');
    if (li.invoice_id) bad('This item is already invoiced.');
    const n2 = L.normalizeLine({ ...li, pricebook_id: null, ...pick(i, ['kind', 'name', 'description', 'qty', 'unit', 'unit_price', 'unit_cost', 'taxable']) });
    update('line_items', li.id, pick(n2, ['kind', 'name', 'description', 'qty', 'unit', 'unit_price', 'unit_cost', 'taxable']));
    return { items: L.getLines('job', li.parent_id) };
  }
});
op({
  name: 'delete_job_item', method: 'DELETE', path: '/api/job-items/:id', tags: ['Jobs'], roles: R.STAFF, mcp: false,
  title: 'Remove a job line item', input: S.obj({ id: S.id }, ['id']),
  handler: i => {
    const li = get("SELECT * FROM line_items WHERE id=:id AND parent_type='job'", { id: i.id }) || notFound('Line item');
    if (li.invoice_id) bad('This item is already invoiced.');
    run('DELETE FROM line_items WHERE id=:id', { id: li.id });
    return { items: L.getLines('job', li.parent_id) };
  }
});

op({
  name: 'delete_job', method: 'DELETE', path: '/api/jobs/:id', tags: ['Jobs'], scope: 'admin', mcp: false,
  title: 'Delete job', input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const j = get('SELECT * FROM jobs WHERE id=:id', { id: i.id }) || notFound('Job');
    if (get("SELECT id FROM invoices WHERE job_id=:id AND status != 'void'", { id: j.id })) bad('This job has invoices. Void them first or cancel the job instead.');
    tx(() => {
      for (const v of all('SELECT id, gcal_event_id FROM visits WHERE job_id=:j', { j: j.id })) emit('visit.deleted', { id: v.id, gcal_event_id: v.gcal_event_id }, ctx);
      run("DELETE FROM line_items WHERE parent_type='job' AND parent_id=:id", { id: j.id });
      run("DELETE FROM activity WHERE entity_type='job' AND entity_id=:id", { id: j.id });
      run('DELETE FROM jobs WHERE id=:id', { id: j.id });
    });
    return { ok: true };
  }
});

// ---------------- visits ----------------
function timesFrom(input, job, { requireStart = true } = {}) {
  let s = input.start ? parseWhen(input.start, tz()) : null;
  if (requireStart && !s) bad('start must be a date-time like 2026-11-18T09:00 (business time zone) or ISO 8601.');
  let e = input.end ? parseWhen(input.end, tz()) : null;
  if (s && !e) e = new Date(s.getTime() + (input.duration_minutes || n('default_visit_minutes', 60)) * 60000);
  if (s && e && e <= s) bad('end must be after start.');
  if (s && e && e - s > 14 * 864e5) bad('A visit cannot be longer than 14 days. Schedule separate visits.');
  return { start: s, end: e };
}
function conflicts(startIso, endIso, ids, exceptVisitId = 0) {
  if (!ids.length) return [];
  const { sql, p } = inList(ids);
  const rows = all(`SELECT v.id visit_id, v.start_at, v.end_at, j.number job_number, j.title, u.id user_id, u.name user_name
    FROM visits v JOIN visit_assignees a ON a.visit_id=v.id JOIN users u ON u.id=a.user_id JOIN jobs j ON j.id=v.job_id
    WHERE a.user_id IN (${sql}) AND v.id != :x AND v.status NOT IN ('cancelled','completed') AND v.start_at < :e AND v.end_at > :s`, { ...p, x: exceptVisitId, s: startIso, e: endIso })
    .map(r => ({ kind: 'visit', ...r, message: `${r.user_name} already has ${r.job_number} ${r.title} ${fmtLocal(r.start_at, tz())}-${fmtLocal(r.end_at, tz(), { month: undefined, day: undefined })}` }));
  const owner = Number(setting('gcal_owner_user_id') || 0);
  if (owner && ids.includes(owner)) {
    for (const ev of all(`SELECT * FROM calendar_events WHERE visit_id IS NULL AND status != 'cancelled' AND transparency != 'transparent' AND start_at < :e AND end_at > :s`, { s: startIso, e: endIso }))
      rows.push({ kind: 'calendar', event_id: ev.id, start_at: ev.start_at, end_at: ev.end_at, title: ev.summary, user_id: owner, message: `Google Calendar: "${ev.summary || 'Busy'}" ${ev.all_day ? '(all day)' : fmtLocal(ev.start_at, tz())}` });
  }
  return rows;
}
function createVisit(job, input, ctx, { isDemo = 0 } = {}) {
  const { start, end } = timesFrom(input, job);
  const ids = userIds(input.assignees && input.assignees.length ? input.assignees : job.assigned_to ? [job.assigned_to] : []);
  if (['completed', 'invoiced', 'cancelled'].includes(job.status)) bad(`This job is ${job.status}. Reopen it before scheduling.`);
  const t = now();
  const vid = insert('visits', { job_id: job.id, start_at: start.toISOString(), end_at: end.toISOString(), status: 'scheduled', notes: str(input.notes), is_demo: isDemo, created_at: t, updated_at: t });
  for (const u of ids) insert('visit_assignees', { visit_id: vid, user_id: u });
  if (job.status === 'unscheduled') update('jobs', job.id, { status: 'scheduled', updated_at: t });
  const who = ids.map(u => get('SELECT name FROM users WHERE id=:id', { id: u }).name).join(', ');
  A.log('job', job.id, `Visit scheduled ${fmtLocal(start.toISOString(), tz(), { weekday: 'short' })}${who ? ` with ${who}` : ' (no one assigned)'}.`, { ctx, isDemo });
  emit('visit.scheduled', { id: vid, job_id: job.id }, ctx);
  return vid;
}

op({
  name: 'schedule_visit', method: 'POST', path: '/api/jobs/:job_id/visits', tags: ['Schedule'],
  title: 'Schedule a visit', description: 'Book a visit (appointment) for a job. Times without an offset are read in the business time zone. Returns the visit plus any scheduling conflicts (double-booking or Google Calendar busy time) as warnings - check them. Use find_availability first to pick a free slot.',
  input: S.obj({ job_id: S.id, ...SCHEDULE.properties }, ['job_id', 'start']),
  handler: (i, ctx) => {
    const job = get('SELECT * FROM jobs WHERE id=:id', { id: i.job_id }) || notFound('Job');
    const vid = tx(() => createVisit(job, i, ctx));
    const v = getVisit(vid);
    return { ...v, conflicts: conflicts(v.start_at, v.end_at, v.assignees.map(a => a.id), v.id) };
  }
});

op({
  name: 'list_visits', method: 'GET', path: '/api/visits', tags: ['Schedule'], roles: R.ALL,
  title: 'Schedule: list visits', description: 'Visits between two dates (inclusive, business time zone), with job, customer, address, access notes and crew. Filter by team member ("me" for yourself) or status.',
  input: S.obj({ from: S.date, to: S.date, user_id: { type: ['string', 'integer'], description: 'Team member id, "me", or "none" for unassigned' }, status: S.enum([...VISIT_STATUS, 'open']), job_id: S.idOpt, include_cancelled: S.bool() }),
  handler: (i, ctx) => {
    const from = i.from || today(); const to = i.to || from;
    const p = { s: zonedToUtc(from, '00:00', tz()).toISOString(), e: zonedToUtc(addDays(to, 1), '00:00', tz()).toISOString() };
    const w = ['v.start_at < :e', 'v.end_at > :s'];
    if (i.job_id) { w.length = 0; w.push('v.job_id=:j'); p.j = i.job_id; }
    let uid = i.user_id === 'me' ? ctx.user.id : i.user_id;
    if (ctx.user.role === 'field' && !uid) uid = ctx.user.id;
    if (uid === 'none') w.push('NOT EXISTS (SELECT 1 FROM visit_assignees a WHERE a.visit_id=v.id)');
    else if (uid) { w.push('EXISTS (SELECT 1 FROM visit_assignees a WHERE a.visit_id=v.id AND a.user_id=:u)'); p.u = Number(uid); }
    if (i.status === 'open') w.push("v.status IN ('scheduled','en_route','on_site')");
    else if (i.status) { w.push('v.status=:st'); p.st = i.status; }
    else if (!i.include_cancelled) w.push("v.status != 'cancelled'");
    return all(`${VISIT_SELECT} WHERE ${w.join(' AND ')} ORDER BY v.start_at`, p).map(decorateVisit);
  }
});
op({
  name: 'get_visit', method: 'GET', path: '/api/visits/:id', tags: ['Schedule'], roles: R.ALL,
  title: 'Get visit', input: S.obj({ id: S.id }, ['id']),
  handler: i => { const v = getVisit(i.id); v.attachments = A.attachmentsFor('visit', v.id); v.checklist = JSON.parse(get('SELECT checklist FROM jobs WHERE id=:id', { id: v.job_id }).checklist || '[]'); return v; }
});

op({
  name: 'update_visit', method: 'PUT', path: '/api/visits/:id', tags: ['Schedule'],
  title: 'Reschedule / reassign visit', description: 'Move a visit to a new time and/or change the crew. Returns conflicts as warnings.',
  input: S.obj({ id: S.id, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' }, duration_minutes: S.int('', { minimum: 5, maximum: 1440 }), assignees: { type: 'array', items: { type: 'integer' } }, notes: S.str('', 4000) }, ['id']),
  handler: (i, ctx) => {
    const v = get('SELECT * FROM visits WHERE id=:id', { id: i.id }) || notFound('Visit');
    if (['completed', 'cancelled'].includes(v.status)) bad(`This visit is ${v.status}.`);
    const o = { updated_at: now() };
    let msg = [];
    if (i.start || i.end || i.duration_minutes) {
      const start = i.start ? parseWhen(i.start, tz()) : new Date(v.start_at);
      if (!start) bad('start must be a valid date-time.');
      let end = i.end ? parseWhen(i.end, tz()) : null;
      if (!end) end = new Date(start.getTime() + (i.duration_minutes ? i.duration_minutes * 60000 : (new Date(v.end_at) - new Date(v.start_at))));
      if (end <= start) bad('end must be after start.');
      o.start_at = start.toISOString(); o.end_at = end.toISOString();
      if (o.start_at !== v.start_at || o.end_at !== v.end_at) msg.push(`Visit moved to ${fmtLocal(o.start_at, tz(), { weekday: 'short' })}.`);
    }
    if (i.notes !== undefined) o.notes = str(i.notes);
    tx(() => {
      update('visits', v.id, o);
      if (i.assignees) {
        const ids = userIds(i.assignees);
        run('DELETE FROM visit_assignees WHERE visit_id=:v', { v: v.id });
        for (const u of ids) insert('visit_assignees', { visit_id: v.id, user_id: u });
        msg.push(`Crew set to ${ids.map(u => get('SELECT name FROM users WHERE id=:id', { id: u }).name).join(', ') || 'nobody'}.`);
      }
      for (const m of msg) A.log('job', v.job_id, m, { ctx });
      emit('visit.updated', { id: v.id, job_id: v.job_id }, ctx);
    });
    const out = getVisit(v.id);
    return { ...out, conflicts: conflicts(out.start_at, out.end_at, out.assignees.map(a => a.id), out.id) };
  }
});

op({
  name: 'set_visit_status', method: 'POST', path: '/api/visits/:id/status', tags: ['Schedule'], roles: R.STAFF,
  title: 'Field status update', description: 'Field workflow for a visit: en_route ("on my way"), on_site (arrived; starts the caller\'s timer), completed (stops timers; set complete_job to also close the job), cancelled, or back to scheduled. lat/lng record where it happened.',
  input: S.obj({ id: S.id, status: S.enum(VISIT_STATUS), notes: S.str('Completion or status notes', 10000), complete_job: S.bool('When completing: also mark the job completed'), lat: { type: ['number', 'null'] }, lng: { type: ['number', 'null'] }, track_time: S.bool('Start/stop the caller\'s timer (default true for people)') }, ['id', 'status']),
  handler: (i, ctx) => setVisitStatus(i, ctx)
});
function setVisitStatus(i, ctx) {
  const v = get('SELECT * FROM visits WHERE id=:id', { id: i.id }) || notFound('Visit');
  const job = get('SELECT * FROM jobs WHERE id=:id', { id: v.job_id });
  if (ctx.user.role === 'field' && !get('SELECT 1 x FROM visit_assignees WHERE visit_id=:v AND user_id=:u', { v: v.id, u: ctx.user.id }))
    forbidden('You are not assigned to this visit.');
  if (v.status === i.status && i.status !== 'completed') return getVisit(v.id);
  const t = now(); const o = { status: i.status, updated_at: t };
  const tracking = i.track_time !== false && ctx.user && ctx.user.kind === 'human' && ctx.user.id;
  tx(() => {
    if (i.status === 'en_route') o.en_route_at = t;
    if (i.status === 'on_site') { o.arrived_at = t; o.arrive_lat = i.lat ?? null; o.arrive_lng = i.lng ?? null; }
    if (i.status === 'completed') { o.completed_at = t; o.complete_lat = i.lat ?? null; o.complete_lng = i.lng ?? null; if (i.notes) o.completion_notes = str(i.notes); }
    if (i.status === 'scheduled') Object.assign(o, { en_route_at: null, arrived_at: null, completed_at: null });
    update('visits', v.id, o);
    const label = { en_route: 'is on the way', on_site: 'arrived on site', completed: 'completed the visit', cancelled: 'cancelled the visit', scheduled: 'reset the visit to scheduled' }[i.status];
    A.log('job', v.job_id, `${ctx.actor} ${label}${i.lat != null ? ` (GPS ${Number(i.lat).toFixed(5)}, ${Number(i.lng).toFixed(5)})` : ''}.${i.notes ? ' ' + i.notes : ''}`, { ctx, kind: 'status' });
    if (i.status === 'on_site' && tracking) T.startTimer({ user: ctx.user, jobId: v.job_id, visitId: v.id, description: 'On site', category: job.type === 'consulting' ? 'consulting' : 'labor', lat: i.lat, lng: i.lng }, ctx);
    if (i.status === 'en_route' && tracking && n('track_travel', 0)) T.startTimer({ user: ctx.user, jobId: v.job_id, visitId: v.id, description: 'Travel', category: 'travel', lat: i.lat, lng: i.lng, billable: false }, ctx);
    if (['completed', 'cancelled'].includes(i.status)) T.stopTimersForVisit(v.id, { lat: i.lat, lng: i.lng }, ctx);
    if (['en_route', 'on_site'].includes(i.status) && ['unscheduled', 'scheduled'].includes(job.status)) {
      update('jobs', job.id, { status: 'in_progress', updated_at: t });
      emit('job.status_changed', { id: job.id, from: job.status, to: 'in_progress' }, ctx);
    }
    emit(i.status === 'cancelled' ? 'visit.cancelled' : 'visit.status_changed', { id: v.id, job_id: v.job_id, status: i.status }, ctx);
    if (i.status === 'completed' && i.complete_job && !['completed', 'invoiced', 'cancelled'].includes(job.status)) setJobStatus(job.id, 'completed', { notes: i.notes }, ctx);
  });
  return getVisit(v.id);
}

op({
  name: 'delete_visit', method: 'DELETE', path: '/api/visits/:id', tags: ['Schedule'],
  title: 'Delete visit', description: 'Remove a visit from the schedule (and from Google Calendar). Prefer set_visit_status cancelled to keep history.',
  input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const v = get('SELECT * FROM visits WHERE id=:id', { id: i.id }) || notFound('Visit');
    tx(() => {
      emit('visit.deleted', { id: v.id, job_id: v.job_id, gcal_event_id: v.gcal_event_id }, ctx);
      run('DELETE FROM visits WHERE id=:id', { id: v.id });
      A.log('job', v.job_id, `Removed the visit on ${fmtLocal(v.start_at, tz(), { weekday: 'short' })}.`, { ctx });
      const left = get("SELECT COUNT(*) n FROM visits WHERE job_id=:j AND status != 'cancelled'", { j: v.job_id }).n;
      if (!left) run("UPDATE jobs SET status='unscheduled', updated_at=:t WHERE id=:j AND status='scheduled'", { j: v.job_id, t: now() });
    });
    return { ok: true };
  }
});

// ---------------- availability ----------------
op({
  name: 'find_availability', method: 'GET', path: '/api/availability', tags: ['Schedule'], roles: R.ALL,
  title: 'Find open time slots', description: 'Find free slots of a given length within working hours, per team member, avoiding booked visits and Google Calendar busy time. Use before schedule_visit.',
  input: S.obj({ date_from: S.date, date_to: S.date, duration_minutes: S.int('Slot length (default visit length)', { minimum: 15, maximum: 600 }),
    user_ids: { type: 'array', items: { type: 'integer' }, description: 'Limit to these team members (default: everyone who does field work)' }, include_weekends: S.bool(), limit: S.int('', { minimum: 1, maximum: 100 }) }),
  handler: i => findAvailability(i)
});
function findAvailability(i) {
  const zone = tz();
  const from = i.date_from || today();
  const to = i.date_to || addDays(from, 6);
  const dur = (i.duration_minutes || n('default_visit_minutes', 60)) * 60000;
  const ws = setting('workday_start') || '08:00', we = setting('workday_end') || '17:00';
  const users = i.user_ids && i.user_ids.length
    ? i.user_ids.map(id => get('SELECT id, name FROM users WHERE id=:id AND active=1', { id })).filter(Boolean)
    : all("SELECT id, name FROM users WHERE active=1 AND kind='human' AND role IN ('owner','admin','field','office') ORDER BY CASE role WHEN 'field' THEN 0 ELSE 1 END, name");
  const owner = Number(setting('gcal_owner_user_id') || 0);
  const slots = []; const limit = i.limit || 30; const nowMs = Date.now();
  for (let d = from, guard = 0; d <= to && guard < 31; d = addDays(d, 1), guard++) {
    const wd = zonedParts(zonedToUtc(d, '12:00', zone), zone).weekday;
    if (!i.include_weekends && (wd === 'Sat' || wd === 'Sun')) continue;
    const dayStart = zonedToUtc(d, ws, zone).getTime(), dayEnd = zonedToUtc(d, we, zone).getTime();
    for (const u of users) {
      const busy = all(`SELECT v.start_at s, v.end_at e FROM visits v JOIN visit_assignees a ON a.visit_id=v.id WHERE a.user_id=:u AND v.status != 'cancelled' AND v.start_at < :e AND v.end_at > :s`,
        { u: u.id, s: new Date(dayStart).toISOString(), e: new Date(dayEnd).toISOString() });
      if (u.id === owner) busy.push(...all("SELECT start_at s, end_at e FROM calendar_events WHERE visit_id IS NULL AND status != 'cancelled' AND transparency != 'transparent' AND start_at < :e AND end_at > :s",
        { s: new Date(dayStart).toISOString(), e: new Date(dayEnd).toISOString() }));
      const iv = busy.map(b => [new Date(b.s).getTime(), new Date(b.e).getTime()]).sort((a, b) => a[0] - b[0]);
      let cursor = Math.max(dayStart, Math.ceil(nowMs / 9e5) * 9e5); // not in the past; round to 15 min
      if (cursor < dayStart) cursor = dayStart;
      for (const [bs, be] of [...iv, [dayEnd, dayEnd]]) {
        if (bs - cursor >= dur && cursor < dayEnd) {
          const end = Math.min(bs, dayEnd);
          slots.push({ user_id: u.id, user_name: u.name, date: d, start: new Date(cursor).toISOString(), end: new Date(end).toISOString(),
            free_minutes: Math.round((end - cursor) / 60000), label: `${fmtLocal(new Date(cursor).toISOString(), zone, { weekday: 'short' })} - ${fmtLocal(new Date(end).toISOString(), zone, { month: undefined, day: undefined })}` });
        }
        cursor = Math.max(cursor, be);
        if (slots.length >= limit * 3) break;
      }
    }
  }
  slots.sort((a, b) => a.start.localeCompare(b.start));
  return { duration_minutes: dur / 60000, workday: `${ws}-${we}`, time_zone: zone, slots: slots.slice(0, limit) };
}

module.exports = { getJob, getVisit, createJob, createVisit, setJobStatus, setVisitStatus, conflicts, findAvailability, decorateVisit, VISIT_SELECT, JOB_SELECT, TYPES, STATUS, STATUS_LABEL, VISIT_STATUS, VISIT_LABEL, BILLING, OPEN, checklistIn };
