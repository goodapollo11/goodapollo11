'use strict';
// Estimates / quotes: build from the price book, send a link, customer approves online, convert to a job.
const { all, get, run, insert, update, tx, now, nextNumber } = require('../db');
const { bad, notFound, str, token, pick, addDays, addressLine, round2 } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const { tz, today, n, flag, baseUrl, company } = require('../config');
const { setting } = require('../db');
const A = require('./activity');
const L = require('./pricebook');
const C = require('./customers');
const J = require('./jobs');
const { emit } = require('../events');
const mailer = require('../integrations/mailer');
const tpl = require('../templates');

const STATUS = ['draft', 'sent', 'approved', 'declined', 'expired', 'converted'];
const LABEL = { draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined', expired: 'Expired', converted: 'Converted to job' };
const publicUrl = e => `${baseUrl()}/p/e/${e.public_token}`;

function recalc(id) {
  const e = get('SELECT e.*, c.tax_exempt FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.id=:id', { id });
  const t = L.totals(L.getLines('estimate', id), { discount: e.discount, tax_rate: e.tax_rate, tax_exempt: !!e.tax_exempt });
  update('estimates', id, { subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, cost: t.cost });
}
const SELECT = `SELECT e.*, c.name customer_name, c.email customer_email, c.phone customer_phone, c.number customer_number,
  l.street, l.city, l.state, l.zip, j.number job_number FROM estimates e JOIN customers c ON c.id=e.customer_id LEFT JOIN locations l ON l.id=e.location_id LEFT JOIN jobs j ON j.id=e.job_id`;
function getEstimate(id) {
  const e = get(`${SELECT} WHERE e.id=:id`, { id }) || notFound('Estimate');
  e.items = L.getLines('estimate', id);
  e.address = addressLine(e);
  e.public_url = publicUrl(e);
  e.activity = A.listFor('estimate', id, 60);
  e.status_label = LABEL[e.status];
  e.margin = e.total ? round2(e.subtotal - e.discount - e.cost) : 0;
  return e;
}

const FIELDS = {
  location_id: S.idOpt, title: S.str('What the estimate is for', 200), message: S.str('Note to the customer shown at the top', 4000), terms: S.str('Terms shown at the bottom', 4000),
  internal_notes: S.str('Private notes (never shown to the customer)', 4000), discount: S.num('Dollar discount', { minimum: 0 }), tax_rate: S.num('Tax rate % (default from settings)', { minimum: 0, maximum: 30 }),
  issue_date: S.date, expiry_date: S.date
};

op({
  name: 'list_estimates', method: 'GET', path: '/api/estimates', tags: ['Estimates'], roles: R.BOOKS,
  title: 'List estimates', description: 'Estimates / quotes. status "open" = draft or sent (awaiting a decision).',
  input: S.obj({ q: S.str(), status: S.enum([...STATUS, 'open', 'all']), customer_id: S.idOpt, from: S.date, to: S.date, limit: S.limit }),
  handler: i => {
    const w = []; const p = { l: i.limit || 200 };
    if (i.status === 'open') w.push("e.status IN ('draft','sent')");
    else if (i.status && i.status !== 'all') { w.push('e.status=:s'); p.s = i.status; }
    if (i.q) { w.push('(e.number LIKE :q OR e.title LIKE :q OR c.name LIKE :q)'); p.q = `%${i.q}%`; }
    if (i.customer_id) { w.push('e.customer_id=:c'); p.c = i.customer_id; }
    if (i.from) { w.push('e.issue_date >= :f'); p.f = i.from; }
    if (i.to) { w.push('e.issue_date <= :to'); p.to = i.to; }
    return all(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY e.id DESC LIMIT :l`, p);
  }
});
op({
  name: 'get_estimate', method: 'GET', path: '/api/estimates/:id', tags: ['Estimates'], roles: R.BOOKS,
  title: 'Get estimate', description: 'Estimate with line items, totals, margin, customer link (public_url) and history.',
  input: S.obj({ id: S.id }, ['id']), handler: i => getEstimate(i.id)
});

function createEstimate(i, ctx, { isDemo = 0 } = {}) {
  const cust = get('SELECT * FROM customers WHERE id=:id', { id: i.customer_id }) || notFound('Customer');
  const loc = i.location_id ? get('SELECT * FROM locations WHERE id=:id AND customer_id=:c', { id: i.location_id, c: cust.id }) : C.primaryLocation(cust.id);
  if (i.location_id && !loc) bad('That location does not belong to this customer.');
  const t = now(); const issue = i.issue_date || today();
  return tx(() => {
    const id = insert('estimates', {
      number: nextNumber('EST', 'estimates'), customer_id: cust.id, location_id: loc ? loc.id : null, title: str(i.title) || 'Estimate', status: 'draft',
      issue_date: issue, expiry_date: i.expiry_date || addDays(issue, n('estimate_valid_days', 30)),
      message: i.message ?? (setting('estimate_message') || ''), terms: i.terms ?? (setting('estimate_terms') || ''), internal_notes: str(i.internal_notes),
      discount: i.discount || 0, tax_rate: i.tax_rate ?? (cust.tax_exempt ? 0 : n('tax_rate', 0)), request_id: i.request_id || null,
      public_token: token(18), created_by: ctx.actor, is_demo: isDemo, created_at: t, updated_at: t
    });
    if (i.items && i.items.length) L.addLines('estimate', id, i.items);
    recalc(id);
    A.log('estimate', id, 'Estimate created.', { ctx, isDemo });
    emit('estimate.created', { id }, ctx);
    return id;
  });
}
op({
  name: 'create_estimate', method: 'POST', path: '/api/estimates', tags: ['Estimates'],
  title: 'Create estimate', description: 'Create a draft estimate (quote) for a customer with line items from the price book (pricebook_id) or custom lines. Then send_estimate to email it with an online approval link.',
  input: S.obj({ customer_id: S.id, ...FIELDS, items: L.LINES, request_id: S.idOpt }, ['customer_id', 'title']),
  handler: (i, ctx) => getEstimate(createEstimate(i, ctx))
});
op({
  name: 'update_estimate', method: 'PUT', path: '/api/estimates/:id', tags: ['Estimates'],
  title: 'Update estimate', description: 'Edit an estimate. Sending items replaces all line items. Approved or converted estimates are locked (set status back to draft first).',
  input: S.obj({ id: S.id, ...FIELDS, items: L.LINES }, ['id']),
  handler: (i, ctx) => {
    const e = get('SELECT * FROM estimates WHERE id=:id', { id: i.id }) || notFound('Estimate');
    if (['approved', 'converted'].includes(e.status)) bad(`This estimate is ${e.status} and locked. Set it back to draft to change it.`);
    const o = pick(i, Object.keys(FIELDS));
    if (o.title === '') bad('title is required.');
    tx(() => {
      update('estimates', e.id, { ...o, updated_at: now() });
      if (i.items) L.setLines('estimate', e.id, i.items);
      recalc(e.id);
      A.log('estimate', e.id, 'Estimate updated.', { ctx });
    });
    return getEstimate(e.id);
  }
});

op({
  name: 'send_estimate', method: 'POST', path: '/api/estimates/:id/send', tags: ['Estimates'], scope: 'email.send',
  title: 'Send estimate', description: 'Email the estimate with its online view/approve link from the business Gmail account. method "mark_sent" just marks it sent (when you shared the link another way). Without Gmail connected, use mark_sent and share public_url.',
  input: S.obj({ id: S.id, method: S.enum(['email', 'mark_sent']), to: S.str('Recipient email (default: customer email)', 300), cc: S.str('', 300), subject: S.str('', 300), message: S.str('Email message (default: estimate message)', 6000) }, ['id']),
  handler: async (i, ctx) => {
    const e = getEstimate(i.id);
    if (['converted'].includes(e.status)) bad('This estimate was already converted to a job.');
    const method = i.method || 'email';
    let sent = null;
    if (method === 'email') {
      const to = str(i.to) || e.customer_email || get("SELECT email FROM contacts WHERE customer_id=:c AND email != '' ORDER BY is_primary DESC LIMIT 1", { c: e.customer_id })?.email;
      if (!to) bad('The customer has no email address. Add one, pass "to", or use method "mark_sent" and share the link.');
      const m = tpl.estimateEmail(e, { message: i.message, subject: i.subject });
      sent = await mailer.send({ to, cc: i.cc, subject: m.subject, text: m.text, html: m.html, ctx, customerId: e.customer_id, entity: ['estimate', e.id] });
    }
    tx(() => {
      const o = { sent_at: now(), updated_at: now() };
      if (['draft', 'expired', 'declined'].includes(e.status)) o.status = 'sent';
      if (e.expiry_date && e.expiry_date < today()) o.expiry_date = addDays(today(), n('estimate_valid_days', 30));
      update('estimates', e.id, o);
      A.log('estimate', e.id, sent ? `Emailed to ${sent.to}.` : 'Marked as sent.', { ctx, kind: sent ? 'email' : 'system' });
      emit('estimate.sent', { id: e.id, emailed: !!sent }, ctx);
    });
    return { ...getEstimate(e.id), emailed: !!sent };
  }
});

op({
  name: 'set_estimate_status', method: 'POST', path: '/api/estimates/:id/status', tags: ['Estimates'],
  title: 'Record estimate decision', description: 'Record a decision you got by phone or in person: approved (optionally auto-creates the job), declined (with reason), or back to draft.',
  input: S.obj({ id: S.id, status: S.enum(['approved', 'declined', 'draft', 'sent']), approved_by: S.str('Who approved', 200), reason: S.str('Decline reason', 2000) }, ['id', 'status']),
  handler: (i, ctx) => decide(i.id, i.status, { name: i.approved_by || `${ctx.actor} (recorded)`, reason: i.reason }, ctx)
});
function decide(id, status, { name = '', reason = '' }, ctx) {
  const e = get('SELECT * FROM estimates WHERE id=:id', { id }) || notFound('Estimate');
  if (e.status === 'converted' && status !== 'converted') bad('This estimate was already converted to a job.');
  let jobId = null;
  tx(() => {
    const t = now();
    if (status === 'approved') {
      update('estimates', id, { status, approved_at: t, approved_name: str(name), declined_at: null, updated_at: t });
      A.log('estimate', id, `Approved by ${name}.`, { ctx, kind: 'status' });
      emit('estimate.approved', { id, by: name }, ctx);
      if (flag('auto_job_on_approval')) jobId = convert(id, {}, ctx).id;
    } else if (status === 'declined') {
      update('estimates', id, { status, declined_at: t, decline_reason: str(reason), updated_at: t });
      A.log('estimate', id, `Declined${reason ? `: ${reason}` : ''}.`, { ctx, kind: 'status' });
      emit('estimate.declined', { id, reason }, ctx);
    } else {
      update('estimates', id, { status, approved_at: null, approved_name: '', declined_at: null, updated_at: t });
      A.log('estimate', id, `Status set to ${LABEL[status]}.`, { ctx, kind: 'status' });
    }
  });
  const out = getEstimate(id);
  if (jobId) out.created_job_id = jobId;
  return out;
}

function convert(id, { schedule } = {}, ctx) {
  const e = get('SELECT * FROM estimates WHERE id=:id', { id }) || notFound('Estimate');
  if (e.job_id && get('SELECT id FROM jobs WHERE id=:id', { id: e.job_id })) return { id: e.job_id, existing: true };
  return tx(() => {
    const items = L.getLines('estimate', id).map(l => pick(l, ['pricebook_id', 'kind', 'name', 'description', 'qty', 'unit', 'unit_price', 'unit_cost', 'taxable']));
    const job = J.createJob({ customer_id: e.customer_id, location_id: e.location_id, title: e.title, description: [e.message && `Estimate note: ${e.message}`, e.internal_notes].filter(Boolean).join('\n\n'),
      items, estimate_id: e.id, request_id: e.request_id, billing: 'fixed', schedule }, ctx);
    if (e.discount > 0) L.addLines('job', job.id, [{ kind: 'discount', name: `Discount (from ${e.number})`, qty: 1, unit_price: -e.discount }]);
    update('estimates', id, { status: 'converted', job_id: job.id, approved_at: e.approved_at || now(), updated_at: now() });
    if (e.request_id) run("UPDATE requests SET status='converted', job_id=:j, updated_at=:t WHERE id=:r", { j: job.id, r: e.request_id, t: now() });
    A.log('estimate', id, `Converted to job ${job.number}.`, { ctx, kind: 'status' });
    emit('estimate.converted', { id, job_id: job.id }, ctx);
    return { id: job.id, number: job.number };
  });
}
op({
  name: 'convert_estimate_to_job', method: 'POST', path: '/api/estimates/:id/convert', tags: ['Estimates'],
  title: 'Convert estimate to job', description: 'Turn an approved (or any) estimate into a job with the same line items. Optionally schedule the first visit.',
  input: S.obj({ id: S.id, schedule: S.obj({ start: S.dateTime, end: { type: 'string', format: 'date-time' }, duration_minutes: S.int('', { minimum: 5 }), assignees: { type: 'array', items: { type: 'integer' } }, notes: S.str() }, ['start'], 'Optionally schedule the first visit') }, ['id']),
  handler: (i, ctx) => {
    const r = convert(i.id, { schedule: i.schedule }, ctx);
    return { job: J.getJob(r.id), estimate: getEstimate(i.id) };
  }
});
op({
  name: 'delete_estimate', method: 'DELETE', path: '/api/estimates/:id', tags: ['Estimates'], mcp: false,
  title: 'Delete estimate', input: S.obj({ id: S.id }, ['id']),
  handler: i => {
    tx(() => { run("DELETE FROM line_items WHERE parent_type='estimate' AND parent_id=:id", { id: i.id }); run("DELETE FROM activity WHERE entity_type='estimate' AND entity_id=:id", { id: i.id }); run('DELETE FROM estimates WHERE id=:id', { id: i.id }); });
    return { ok: true };
  }
});

// ---------------- customer-facing (public link) ----------------
function publicView(e) {
  const co = company();
  return {
    kind: 'estimate', number: e.number, title: e.title, status: e.status, status_label: LABEL[e.status], issue_date: e.issue_date, expiry_date: e.expiry_date,
    expired: !!(e.expiry_date && e.expiry_date < today() && ['draft', 'sent'].includes(e.status)), message: e.message, terms: e.terms,
    customer: { name: e.customer_name }, address: e.address, approved_at: e.approved_at, approved_name: e.approved_name, declined_at: e.declined_at,
    items: e.items.map(l => pick(l, ['name', 'description', 'qty', 'unit', 'unit_price', 'total', 'kind'])),
    subtotal: e.subtotal, discount: e.discount, tax: e.tax, tax_rate: e.tax_rate, total: e.total, company: co, currency: setting('currency') || 'USD'
  };
}
const byToken = t => get('SELECT id FROM estimates WHERE public_token=:t', { t }) || notFound('Estimate');
op({
  name: 'public_get_estimate', method: 'GET', path: '/public/estimates/:token', public: true, mcp: false, tags: ['Customer portal'],
  title: 'Customer view of an estimate', input: S.obj({ token: S.str() }, ['token']),
  handler: (i, ctx) => {
    const e = getEstimate(byToken(i.token).id);
    if (!e.viewed_at && e.status !== 'draft') {
      update('estimates', e.id, { viewed_at: now() });
      A.log('estimate', e.id, 'Customer opened the estimate.', { ctx });
      emit('estimate.viewed', { id: e.id }, ctx);
    }
    return publicView(e);
  }
});
op({
  name: 'public_approve_estimate', method: 'POST', path: '/public/estimates/:token/approve', public: true, mcp: false, tags: ['Customer portal'],
  title: 'Customer approves estimate', input: S.obj({ token: S.str(), name: S.str('Typed signature', 200), note: S.str('', 2000) }, ['token', 'name']),
  handler: (i, ctx) => {
    const e = getEstimate(byToken(i.token).id);
    if (!['sent', 'draft'].includes(e.status)) bad(`This estimate is already ${LABEL[e.status].toLowerCase()}.`);
    if (e.expiry_date && e.expiry_date < today()) bad('This estimate has expired. Please contact us for an updated quote.');
    const c2 = { ...ctx, actor: `Customer: ${i.name}` };
    if (i.note) A.log('estimate', e.id, `Customer note: ${i.note}`, { ctx: c2, kind: 'note' });
    decide(e.id, 'approved', { name: i.name }, c2);
    return publicView(getEstimate(e.id));
  }
});
op({
  name: 'public_decline_estimate', method: 'POST', path: '/public/estimates/:token/decline', public: true, mcp: false, tags: ['Customer portal'],
  title: 'Customer declines estimate', input: S.obj({ token: S.str(), reason: S.str('', 2000) }, ['token']),
  handler: (i, ctx) => {
    const e = getEstimate(byToken(i.token).id);
    if (!['sent', 'draft'].includes(e.status)) bad(`This estimate is already ${LABEL[e.status].toLowerCase()}.`);
    decide(e.id, 'declined', { reason: i.reason }, { ...ctx, actor: `Customer: ${e.customer_name}` });
    return publicView(getEstimate(e.id));
  }
});

module.exports = { getEstimate, createEstimate, recalc, convert, decide, publicUrl, STATUS, LABEL };
