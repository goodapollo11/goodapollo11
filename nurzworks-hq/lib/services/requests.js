'use strict';
// Service requests / leads: from the public request page, email, phone, Slack or AI intake -> customer + job or estimate.
const { all, get, run, insert, update, tx, now, nextNumber } = require('../db');
const { bad, notFound, str, normEmail, pick } = require('../util');
const { op, S, PRIORITY } = require('../ops');
const { R } = require('../auth');
const { today } = require('../config');
const A = require('./activity');
const C = require('./customers');
const J = require('./jobs');
const { emit } = require('../events');

const STATUS = ['new', 'contacted', 'quoted', 'scheduled', 'converted', 'declined'];
const SOURCES = ['portal', 'phone', 'email', 'website', 'referral', 'slack', 'ai', 'walk_in', 'manual', 'webhook'];
const FIELDS = {
  name: S.str('Contact name', 200), company: S.str('', 200), email: S.str('', 200), phone: S.str('', 50), address: S.str('Service address (one line)', 300),
  service: S.str('Service wanted', 200), details: S.str('Problem description / what they need', 10000), preferred_date: S.date, preferred_time: S.str('Morning, afternoon, a time...', 60),
  source: S.enum(SOURCES), priority: S.enum(PRIORITY), assigned_to: S.idOpt, notes: S.str('Internal notes', 4000), customer_id: S.idOpt
};
const SELECT = `SELECT r.*, c.name customer_name, u.name assignee, j.number job_number, e.number estimate_number FROM requests r
  LEFT JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.assigned_to LEFT JOIN jobs j ON j.id=r.job_id LEFT JOIN estimates e ON e.id=r.estimate_id`;
function getRequest(id) {
  const r = get(`${SELECT} WHERE r.id=:id`, { id }) || notFound('Request');
  r.activity = A.listFor('request', id, 50);
  r.matches = r.customer_id ? [] : matchCustomers(r);
  return r;
}
function matchCustomers(r) {
  const out = []; const seen = new Set();
  const m = C.findByContact(r.email, r.phone);
  if (m) { out.push({ id: m.id, number: m.number, name: m.name, email: m.email, phone: m.phone, why: 'same email/phone' }); seen.add(m.id); }
  if (r.name && r.name.length > 3) for (const c of all('SELECT id, number, name, email, phone FROM customers WHERE name LIKE :n LIMIT 3', { n: `%${r.name}%` })) if (!seen.has(c.id)) out.push({ ...c, why: 'similar name' });
  return out;
}
function createRequest(i, ctx, { isDemo = 0 } = {}) {
  if (!str(i.name)) bad('name is required.');
  if (!str(i.email) && !str(i.phone)) bad('Give an email or phone number so we can reach the customer.');
  const t = now();
  return tx(() => {
    const id = insert('requests', {
      number: nextNumber('REQ', 'requests'), ...pick(i, ['company', 'phone', 'address', 'service', 'details', 'preferred_date', 'preferred_time', 'notes', 'assigned_to', 'customer_id']),
      name: str(i.name), email: normEmail(i.email), source: i.source || 'manual', priority: i.priority || 'normal', status: 'new',
      created_by: ctx.actor, is_demo: isDemo, created_at: t, updated_at: t
    });
    A.log('request', id, `Request received via ${i.source || 'manual entry'}.`, { ctx, customerId: i.customer_id || null, isDemo });
    emit('request.created', { id }, ctx);
    return id;
  });
}

op({
  name: 'list_requests', method: 'GET', path: '/api/requests', tags: ['Requests'],
  title: 'List service requests / leads', description: 'Incoming requests and leads. status "open" = new or contacted (needs follow-up).',
  input: S.obj({ status: S.enum([...STATUS, 'open', 'all']), q: S.str(), source: S.enum(SOURCES), limit: S.limit }),
  handler: i => {
    const w = []; const p = { l: i.limit || 200 };
    const st = i.status || 'open';
    if (st === 'open') w.push("r.status IN ('new','contacted')");
    else if (st !== 'all') { w.push('r.status=:s'); p.s = st; }
    if (i.source) { w.push('r.source=:src'); p.src = i.source; }
    if (i.q) { w.push('(r.number LIKE :q OR r.name LIKE :q OR r.company LIKE :q OR r.email LIKE :q OR r.service LIKE :q OR r.details LIKE :q)'); p.q = `%${i.q}%`; }
    return all(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.id DESC LIMIT :l`, p);
  }
});
op({
  name: 'get_request', method: 'GET', path: '/api/requests/:id', tags: ['Requests'],
  title: 'Get request', description: 'A request with history and possible matching existing customers.',
  input: S.obj({ id: S.id }, ['id']), handler: i => getRequest(i.id)
});
op({
  name: 'create_request', method: 'POST', path: '/api/requests', tags: ['Requests'], roles: R.STAFF,
  title: 'Log a service request / lead', description: 'Record a new lead or service request (phone call, email, walk-in). Then convert_request to make it a customer + job or estimate.',
  input: S.obj(FIELDS, ['name']),
  handler: (i, ctx) => getRequest(createRequest(i, ctx))
});
op({
  name: 'update_request', method: 'PUT', path: '/api/requests/:id', tags: ['Requests'],
  title: 'Update request', description: 'Edit a request or move it along (status contacted / declined).',
  input: S.obj({ id: S.id, ...FIELDS, status: S.enum(STATUS) }, ['id']),
  handler: (i, ctx) => {
    const r = get('SELECT * FROM requests WHERE id=:id', { id: i.id }) || notFound('Request');
    const o = pick(i, [...Object.keys(FIELDS), 'status']);
    if (o.email !== undefined) o.email = normEmail(o.email);
    update('requests', r.id, { ...o, updated_at: now() });
    if (o.status && o.status !== r.status) A.log('request', r.id, `Status changed from ${r.status} to ${o.status}.`, { ctx, kind: 'status' });
    return getRequest(r.id);
  }
});
op({
  name: 'convert_request', method: 'POST', path: '/api/requests/:id/convert', tags: ['Requests'],
  title: 'Convert request', description: 'Turn a request into work: finds or creates the customer (matching email/phone), adds the service address, and creates a job or a draft estimate. Pass customer_id to attach to a specific existing customer.',
  input: S.obj({ id: S.id, to: S.enum(['job', 'estimate', 'customer'], 'What to create (default job)'), customer_id: S.idOpt, title: S.str('Job / estimate title', 200),
    schedule: S.obj({ start: S.dateTime, duration_minutes: S.int('', { minimum: 5 }), assignees: { type: 'array', items: { type: 'integer' } } }, ['start']) }, ['id']),
  handler: (i, ctx) => convertRequest(i, ctx)
});
function convertRequest(i, ctx) {
  const r = get('SELECT * FROM requests WHERE id=:id', { id: i.id }) || notFound('Request');
  if (r.status === 'converted' && (r.job_id || r.estimate_id)) bad('This request was already converted.');
  const to = i.to || 'job';
  return tx(() => {
    let cust = i.customer_id ? get('SELECT * FROM customers WHERE id=:id', { id: i.customer_id }) : r.customer_id ? get('SELECT * FROM customers WHERE id=:id', { id: r.customer_id }) : C.findByContact(r.email, r.phone);
    let created = false;
    if (i.customer_id && !cust) notFound('Customer');
    if (!cust) {
      const t = now();
      const id = insert('customers', {
        number: require('../db').nextNumber('C', 'customers'), name: r.company && !r.name ? r.company : r.name, company: r.company, kind: r.company ? 'commercial' : 'residential',
        email: r.email, phone: r.phone, status: to === 'job' ? 'active' : 'lead', source: r.source, portal_token: require('../util').token(18), created_by: ctx.actor, created_at: t, updated_at: t
      });
      A.log('customer', id, `Customer created from request ${r.number}.`, { ctx, customerId: id });
      emit('customer.created', { id }, ctx);
      cust = get('SELECT * FROM customers WHERE id=:id', { id }); created = true;
    }
    if (r.address && !get('SELECT id FROM locations WHERE customer_id=:c AND (street=:s OR (street || \', \' || city) = :s)', { c: cust.id, s: r.address })) {
      const parts = r.address.split(',').map(x => x.trim());
      const stZip = (parts[2] || '').split(/\s+/);
      C.addLocation(cust.id, { street: parts[0] || r.address, city: parts[1] || '', state: stZip[0] || '', zip: stZip[1] || '' }, ctx, { quiet: !created });
    }
    const title = str(i.title) || r.service || (r.details || '').split('\n')[0].slice(0, 80) || 'Service request';
    const desc = [r.details, r.preferred_date || r.preferred_time ? `Preferred: ${[r.preferred_date, r.preferred_time].filter(Boolean).join(' ')}` : ''].filter(Boolean).join('\n\n');
    const out = { customer_id: cust.id, customer_created: created };
    if (to === 'job') {
      const job = J.createJob({ customer_id: cust.id, title, description: desc, priority: r.priority, request_id: r.id, assigned_to: r.assigned_to, due_date: r.preferred_date, schedule: i.schedule }, ctx);
      update('requests', r.id, { status: 'converted', customer_id: cust.id, job_id: job.id, updated_at: now() });
      out.job_id = job.id; out.job_number = job.number;
    } else if (to === 'estimate') {
      const E = require('./estimates');
      const eid = E.createEstimate({ customer_id: cust.id, title, internal_notes: desc, request_id: r.id }, ctx);
      update('requests', r.id, { status: 'quoted', customer_id: cust.id, estimate_id: eid, updated_at: now() });
      out.estimate_id = eid; out.estimate_number = get('SELECT number FROM estimates WHERE id=:id', { id: eid }).number;
    } else {
      update('requests', r.id, { status: 'contacted', customer_id: cust.id, updated_at: now() });
    }
    A.log('request', r.id, `Converted: ${to === 'job' ? `job ${out.job_number}` : to === 'estimate' ? `estimate ${out.estimate_number}` : 'linked to customer'} for ${cust.name}.`, { ctx, kind: 'status', customerId: cust.id });
    run("UPDATE activity SET customer_id=:c WHERE entity_type='request' AND entity_id=:r", { c: cust.id, r: r.id });
    emit('request.converted', { id: r.id, ...out }, ctx);
    return { ...out, request: getRequest(r.id) };
  });
}
op({
  name: 'delete_request', method: 'DELETE', path: '/api/requests/:id', tags: ['Requests'], mcp: false,
  title: 'Delete request', input: S.obj({ id: S.id }, ['id']),
  handler: i => { tx(() => { run("DELETE FROM activity WHERE entity_type='request' AND entity_id=:id", { id: i.id }); run('DELETE FROM requests WHERE id=:id', { id: i.id }); }); return { ok: true }; }
});

// Public request form (no login). A honeypot field and per-IP limit keep bots out.
const recent = new Map();
op({
  name: 'public_submit_request', method: 'POST', path: '/public/requests', public: true, mcp: false, tags: ['Customer portal'],
  title: 'Public service request form', input: S.obj({ ...FIELDS, website: S.str('leave empty', 200) }, ['name']),
  handler: (i, ctx) => {
    if (str(i.website)) return { number: 'REQ-OK' }; // bot filled the hidden field
    const ip = ctx.ip || 'x'; const t = Date.now();
    const hits = (recent.get(ip) || []).filter(x => t - x < 3600e3);
    if (hits.length >= 8) bad('Too many requests from this connection. Please call us instead.');
    hits.push(t); recent.set(ip, hits);
    const safe = pick(i, ['name', 'company', 'email', 'phone', 'address', 'service', 'details', 'preferred_date', 'preferred_time']);
    if (safe.preferred_date && safe.preferred_date < today()) delete safe.preferred_date;
    const id = createRequest({ ...safe, source: i.source === 'website' ? 'website' : 'portal' }, { ...ctx, actor: `Web form: ${str(i.name)}` });
    return { number: get('SELECT number FROM requests WHERE id=:id', { id }).number };
  }
});

module.exports = { createRequest, getRequest, convertRequest, STATUS, SOURCES };
