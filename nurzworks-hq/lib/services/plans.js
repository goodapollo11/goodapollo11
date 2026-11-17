'use strict';
// Service plans: recurring maintenance agreements that generate jobs (and visits) automatically ahead of the due date.
// Same idea as the CMMS preventive-maintenance engine, pointed at customers instead of assets.
const { all, get, run, insert, update, tx, now, nextNumber } = require('../db');
const { bad, notFound, str, pick, addDays, addInterval, round2 } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const { today } = require('../config');
const A = require('./activity');
const C = require('./customers');
const J = require('./jobs');
const { emit } = require('../events');

const UNITS = ['day', 'week', 'month', 'year'];
const STATUS = ['active', 'paused', 'ended'];
const FIELDS = {
  location_id: S.idOpt, name: S.str('Plan name, e.g. "Quarterly HVAC maintenance"', 200), description: S.str('Scope of each visit', 10000), job_type: S.enum(J.TYPES),
  interval_value: S.int('Repeat every N...', { minimum: 1, maximum: 60 }), interval_unit: S.enum(UNITS), next_due: S.date, lead_days: S.int('Create the job this many days before it is due', { minimum: 0, maximum: 120 }),
  visit_time: { type: 'string', format: 'time', description: 'Default visit start time, e.g. 09:00' }, duration_minutes: S.int('', { minimum: 15, maximum: 1440 }), assigned_to: S.idOpt,
  auto_schedule: S.bool('Also book the visit on the due date at visit_time'), price: S.num('Price per visit (added as a line item)', { minimum: 0 }),
  checklist: S.str('Checklist, one step per line', 10000), status: S.enum(STATUS), end_date: S.date
};
const SELECT = `SELECT p.*, c.name customer_name, u.name assignee, l.street, l.city,
  (SELECT COUNT(*) FROM jobs j WHERE j.plan_id=p.id) jobs_generated,
  (SELECT COUNT(*) FROM jobs j WHERE j.plan_id=p.id AND j.status IN ('completed','invoiced')) jobs_done
  FROM plans p JOIN customers c ON c.id=p.customer_id LEFT JOIN users u ON u.id=p.assigned_to LEFT JOIN locations l ON l.id=p.location_id`;
const PER_YEAR = { day: 365, week: 52, month: 12, year: 1 };
function getPlan(id) {
  const p = get(`${SELECT} WHERE p.id=:id`, { id }) || notFound('Service plan');
  p.jobs = all('SELECT id, number, title, status, due_date, completed_at FROM jobs WHERE plan_id=:id ORDER BY id DESC LIMIT 50', { id });
  p.annual_value = round2(p.price * PER_YEAR[p.interval_unit] / p.interval_value);
  p.activity = A.listFor('plan', id, 30);
  return p;
}

op({
  name: 'list_service_plans', method: 'GET', path: '/api/plans', tags: ['Service plans'],
  title: 'List service plans', description: 'Recurring service agreements, next due dates and annual value.',
  input: S.obj({ status: S.enum([...STATUS, 'all']), customer_id: S.idOpt }),
  handler: i => {
    const w = []; const p = {};
    if (i.status && i.status !== 'all') { w.push('p.status=:s'); p.s = i.status; }
    if (i.customer_id) { w.push('p.customer_id=:c'); p.c = i.customer_id; }
    return all(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END, p.next_due`, p)
      .map(r => ({ ...r, annual_value: round2(r.price * PER_YEAR[r.interval_unit] / r.interval_value) }));
  }
});
op({ name: 'get_service_plan', method: 'GET', path: '/api/plans/:id', tags: ['Service plans'], title: 'Get service plan', input: S.obj({ id: S.id }, ['id']), handler: i => getPlan(i.id) });

function createPlan(i, ctx, { isDemo = 0 } = {}) {
  const cust = get('SELECT * FROM customers WHERE id=:id', { id: i.customer_id }) || notFound('Customer');
  const loc = i.location_id ? get('SELECT * FROM locations WHERE id=:id AND customer_id=:c', { id: i.location_id, c: cust.id }) : C.primaryLocation(cust.id);
  if (i.location_id && !loc) bad('That location does not belong to this customer.');
  const t = now();
  const id = insert('plans', {
    number: nextNumber('PLAN', 'plans'), customer_id: cust.id, location_id: loc ? loc.id : null, name: str(i.name), description: str(i.description), job_type: i.job_type || 'maintenance',
    interval_value: i.interval_value || 1, interval_unit: i.interval_unit || 'month', next_due: i.next_due || today(), lead_days: i.lead_days ?? 14,
    visit_time: i.visit_time || '09:00', duration_minutes: i.duration_minutes || 60, assigned_to: i.assigned_to || null, auto_schedule: i.auto_schedule === false ? 0 : 1,
    price: i.price || 0, checklist: str(i.checklist), status: i.status || 'active', end_date: i.end_date || null, created_by: ctx.actor, is_demo: isDemo, created_at: t, updated_at: t
  });
  A.log('plan', id, 'Service plan created.', { ctx, isDemo });
  A.log('customer', cust.id, `Service plan "${i.name}" started (every ${i.interval_value || 1} ${i.interval_unit || 'month'}${(i.interval_value || 1) > 1 ? 's' : ''}).`, { ctx, isDemo });
  return id;
}
op({
  name: 'create_service_plan', method: 'POST', path: '/api/plans', tags: ['Service plans'],
  title: 'Create service plan', description: 'Set up recurring service for a customer (e.g. every 3 months). Jobs are generated automatically lead_days before each due date and, with auto_schedule, a visit is booked at visit_time.',
  input: S.obj({ customer_id: S.id, ...FIELDS }, ['customer_id', 'name', 'next_due']),
  handler: (i, ctx) => { const id = createPlan(i, ctx); generate({ planId: id }, ctx); return getPlan(id); }
});
op({
  name: 'update_service_plan', method: 'PUT', path: '/api/plans/:id', tags: ['Service plans'],
  title: 'Update service plan', description: 'Change a plan. status paused stops job generation; ended closes it.',
  input: S.obj({ id: S.id, ...FIELDS }, ['id']),
  handler: (i, ctx) => {
    const p = get('SELECT * FROM plans WHERE id=:id', { id: i.id }) || notFound('Service plan');
    const o = pick(i, Object.keys(FIELDS));
    if (o.auto_schedule !== undefined) o.auto_schedule = o.auto_schedule ? 1 : 0;
    if (o.name === '') bad('name is required.');
    update('plans', p.id, { ...o, updated_at: now() });
    if (o.status && o.status !== p.status) A.log('plan', p.id, `Plan ${o.status}.`, { ctx, kind: 'status' });
    else A.log('plan', p.id, 'Plan updated.', { ctx });
    return getPlan(p.id);
  }
});
op({
  name: 'delete_service_plan', method: 'DELETE', path: '/api/plans/:id', tags: ['Service plans'], mcp: false,
  title: 'Delete service plan', input: S.obj({ id: S.id }, ['id']),
  handler: i => { tx(() => { run('UPDATE jobs SET plan_id=NULL WHERE plan_id=:id', { id: i.id }); run("DELETE FROM activity WHERE entity_type='plan' AND entity_id=:id", { id: i.id }); run('DELETE FROM plans WHERE id=:id', { id: i.id }); }); return { ok: true }; }
});
op({
  name: 'generate_plan_job', method: 'POST', path: '/api/plans/:id/generate', tags: ['Service plans'],
  title: 'Generate next plan job now', description: 'Create the next job for this plan immediately instead of waiting for the lead window.',
  input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => ({ created: generate({ planId: i.id, force: true }, ctx), plan: getPlan(i.id) })
});

// Creates a job for each active plan whose next due date is inside its lead window. Never duplicates a cycle.
function generate({ planId = null, force = false } = {}, ctx) {
  const t = today(); const created = [];
  const plans = all(`SELECT * FROM plans WHERE status='active' ${planId ? 'AND id=:id' : ''}`, { id: planId });
  for (const p of plans) {
    let guard = 0;
    while (guard++ < 24) {
      if (p.end_date && p.next_due > p.end_date) { update('plans', p.id, { status: 'ended', updated_at: now() }); break; }
      if (!force && addDays(p.next_due, -p.lead_days) > t) break;
      tx(() => {
        if (!get('SELECT id FROM jobs WHERE plan_id=:p AND due_date=:d', { p: p.id, d: p.next_due })) {
          const schedule = p.auto_schedule && p.next_due >= t ? { start: `${p.next_due}T${p.visit_time}`, duration_minutes: p.duration_minutes, assignees: p.assigned_to ? [p.assigned_to] : [] } : undefined;
          const job = J.createJob({
            customer_id: p.customer_id, location_id: p.location_id, title: p.name, description: p.description, type: p.job_type, assigned_to: p.assigned_to, due_date: p.next_due,
            checklist: p.checklist, plan_id: p.id, items: p.price > 0 ? [{ kind: 'service', name: p.name, description: `Service plan ${p.number} visit`, qty: 1, unit_price: p.price }] : [], schedule
          }, ctx || require('../ops').systemCtx('Service plan scheduler'), { isDemo: p.is_demo });
          created.push(job.id);
        }
        const next = addInterval(p.next_due, p.interval_value, p.interval_unit);
        update('plans', p.id, { next_due: next, last_generated: now(), updated_at: now() });
        p.next_due = next;
      });
      if (force) break;
    }
  }
  return created;
}

module.exports = { generate, getPlan, createPlan, UNITS };
