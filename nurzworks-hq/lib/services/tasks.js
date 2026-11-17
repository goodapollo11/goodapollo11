'use strict';
// Tasks / to-dos for people and AI staff. AI office staff use this as their work queue:
// list_tasks(assigned_to="me") -> do the work -> update_task(status="done", result="what I did").
const { all, get, run, insert, update, now } = require('../db');
const { bad, notFound, str, pick, addDays } = require('../util');
const { op, S, PRIORITY } = require('../ops');
const { R } = require('../auth');
const { today } = require('../config');
const A = require('./activity');
const { emit } = require('../events');

const STATUS = ['open', 'in_progress', 'waiting', 'done', 'cancelled'];
const RELATED = ['customer', 'job', 'visit', 'estimate', 'invoice', 'request', 'plan'];
const SELECT = `SELECT t.*, u.name assignee, u.kind assignee_kind, c.name customer_name,
  CASE t.related_type WHEN 'job' THEN (SELECT number || ' ' || title FROM jobs WHERE id=t.related_id) WHEN 'estimate' THEN (SELECT number || ' ' || title FROM estimates WHERE id=t.related_id)
    WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id=t.related_id) WHEN 'request' THEN (SELECT number || ' ' || name FROM requests WHERE id=t.related_id)
    WHEN 'customer' THEN (SELECT name FROM customers WHERE id=t.related_id) WHEN 'plan' THEN (SELECT number || ' ' || name FROM plans WHERE id=t.related_id) ELSE NULL END related_label
  FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN customers c ON c.id=t.customer_id`;
const getTask = id => get(`${SELECT} WHERE t.id=:id`, { id }) || notFound('Task');

function resolveAssignee(v, ctx) {
  if (v === 'me') return ctx.user && ctx.user.id ? ctx.user.id : null;
  if (v === null || v === '' || v === undefined || v === 'none') return null;
  const id = Number(v);
  if (!get('SELECT id FROM users WHERE id=:id AND active=1', { id })) bad(`Team member ${v} not found.`);
  return id;
}
function createTask(i, ctx, { isDemo = 0 } = {}) {
  if (i.related_type && i.related_id && !A.entityExists(i.related_type, i.related_id)) notFound(i.related_type);
  const t = now();
  const id = insert('tasks', {
    title: str(i.title), details: str(i.details), status: 'open', priority: i.priority || 'normal', due_date: i.due_date || null,
    assigned_to: resolveAssignee(i.assigned_to, ctx), related_type: i.related_type || '', related_id: i.related_id || null,
    customer_id: i.customer_id || (i.related_type ? A.customerIdFor(i.related_type, i.related_id) : null),
    created_by: ctx.actor, created_by_id: ctx.user ? ctx.user.id : null, is_demo: isDemo, created_at: t, updated_at: t
  });
  if (i.related_type && i.related_id) A.log(i.related_type, i.related_id, `Task added: ${i.title}`, { ctx, isDemo });
  emit('task.created', { id }, ctx);
  return id;
}

op({
  name: 'list_tasks', method: 'GET', path: '/api/tasks', tags: ['Tasks'], roles: R.ALL,
  title: 'List tasks', description: 'To-dos. AI staff: call with assigned_to="me" to get your work queue. status "open" = open, in progress or waiting. due: overdue, today, week.',
  input: S.obj({ assigned_to: { type: ['string', 'integer'], description: 'Team member id, "me", "none" or "ai" (any AI staff)' }, status: S.enum([...STATUS, 'all', 'open']),
    due: S.enum(['overdue', 'today', 'week']), related_type: S.enum(RELATED), related_id: S.idOpt, customer_id: S.idOpt, q: S.str(), limit: S.limit }),
  handler: (i, ctx) => {
    const w = []; const p = { l: i.limit || 200, t: today() };
    const st = i.status || 'open';
    if (st === 'open') w.push("t.status IN ('open','in_progress','waiting')");
    else if (st !== 'all') { w.push('t.status=:s'); p.s = st; }
    if (i.assigned_to === 'me') { w.push('t.assigned_to=:a'); p.a = ctx.user.id; }
    else if (i.assigned_to === 'none') w.push('t.assigned_to IS NULL');
    else if (i.assigned_to === 'ai') w.push("u.kind='ai'");
    else if (i.assigned_to) { w.push('t.assigned_to=:a'); p.a = Number(i.assigned_to); }
    if (i.due === 'overdue') w.push('t.due_date < :t');
    if (i.due === 'today') w.push('t.due_date <= :t');
    if (i.due === 'week') { w.push('t.due_date <= :wk'); p.wk = addDays(today(), 7); }
    if (i.related_type) { w.push('t.related_type=:rt'); p.rt = i.related_type; }
    if (i.related_id) { w.push('t.related_id=:ri'); p.ri = i.related_id; }
    if (i.customer_id) { w.push('t.customer_id=:c'); p.c = i.customer_id; }
    if (i.q) { w.push('(t.title LIKE :q OR t.details LIKE :q)'); p.q = `%${i.q}%`; }
    return all(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY CASE t.status WHEN 'done' THEN 1 WHEN 'cancelled' THEN 2 ELSE 0 END,
      COALESCE(t.due_date,'9999'), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id LIMIT :l`, p);
  }
});
op({
  name: 'get_task', method: 'GET', path: '/api/tasks/:id', tags: ['Tasks'], roles: R.ALL,
  title: 'Get task', input: S.obj({ id: S.id }, ['id']), handler: i => ({ ...getTask(i.id), activity: A.listFor('task', i.id, 30) })
});
op({
  name: 'create_task', method: 'POST', path: '/api/tasks', tags: ['Tasks'], roles: R.STAFF,
  title: 'Create task', description: 'Create a to-do for a person or AI staff member (assigned_to = team member id or "me"), optionally linked to a customer, job, estimate, invoice or request.',
  input: S.obj({ title: S.str('', 300), details: S.str('', 10000), priority: S.enum(PRIORITY), due_date: S.date, assigned_to: { type: ['string', 'integer', 'null'] },
    related_type: S.enum(RELATED), related_id: S.idOpt, customer_id: S.idOpt }, ['title']),
  handler: (i, ctx) => getTask(createTask(i, ctx))
});
op({
  name: 'update_task', method: 'PUT', path: '/api/tasks/:id', tags: ['Tasks'], roles: R.STAFF,
  title: 'Update / complete task', description: 'Change a task. Set status "done" and write what you did in result when finished, or "waiting" with a note when blocked.',
  input: S.obj({ id: S.id, title: S.str('', 300), details: S.str('', 10000), status: S.enum(STATUS), priority: S.enum(PRIORITY), due_date: S.date,
    assigned_to: { type: ['string', 'integer', 'null'] }, result: S.str('Outcome / what was done', 10000) }, ['id']),
  handler: (i, ctx) => {
    const t = get('SELECT * FROM tasks WHERE id=:id', { id: i.id }) || notFound('Task');
    const o = pick(i, ['title', 'details', 'status', 'priority', 'due_date', 'result']);
    if (i.assigned_to !== undefined) o.assigned_to = resolveAssignee(i.assigned_to, ctx);
    if (o.title === '') bad('title is required.');
    if (o.status === 'done' && t.status !== 'done') o.completed_at = now();
    if (o.status && o.status !== 'done') o.completed_at = null;
    update('tasks', t.id, { ...o, updated_at: now() });
    if (o.status && o.status !== t.status) {
      A.log('task', t.id, `Status: ${t.status} -> ${o.status}${o.result ? `. ${o.result}` : ''}`, { ctx, kind: 'status' });
      if (o.status === 'done') {
        if (t.related_type && t.related_id) A.log(t.related_type, t.related_id, `Task done: ${t.title}${o.result ? ` - ${o.result}` : ''}`, { ctx });
        emit('task.completed', { id: t.id }, ctx);
      }
    } else if (o.result) A.log('task', t.id, o.result, { ctx, kind: 'note' });
    return getTask(t.id);
  }
});
op({
  name: 'delete_task', method: 'DELETE', path: '/api/tasks/:id', tags: ['Tasks'], roles: R.STAFF, mcp: false,
  title: 'Delete task', input: S.obj({ id: S.id }, ['id']),
  handler: i => { run('DELETE FROM tasks WHERE id=:id', { id: i.id }); return { ok: true }; }
});

module.exports = { createTask, getTask, STATUS };
