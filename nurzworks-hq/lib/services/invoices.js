'use strict';
// Invoices, payments and accounts receivable.
const { all, get, run, insert, update, tx, now, nextNumber } = require('../db');
const { bad, notFound, str, token, pick, addDays, addressLine, round2, daysBetween } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const { today, n, baseUrl, company } = require('../config');
const { setting } = require('../db');
const A = require('./activity');
const L = require('./pricebook');
const { emit } = require('../events');
const mailer = require('../integrations/mailer');
const tpl = require('../templates');

const STATUS = ['draft', 'sent', 'viewed', 'partial', 'paid', 'void'];
const LABEL = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', partial: 'Partially paid', paid: 'Paid', void: 'Void' };
const METHODS = ['cash', 'check', 'card', 'ach', 'zelle', 'venmo', 'paypal', 'stripe', 'other'];
const OPEN = "('sent','viewed','partial')";
const publicUrl = i => `${baseUrl()}/p/i/${i.public_token}`;

function recalc(id) {
  const inv = get('SELECT i.*, c.tax_exempt FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=:id', { id });
  const t = L.totals(L.getLines('invoice', id), { discount: inv.discount, tax_rate: inv.tax_rate, tax_exempt: !!inv.tax_exempt });
  const paid = round2(get('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE invoice_id=:id', { id }).s);
  const balance = inv.status === 'void' ? 0 : round2(t.total - paid);
  let status = inv.status;
  if (!['draft', 'void'].includes(status)) {
    if (balance <= 0.004 && t.total > 0) status = 'paid';
    else if (paid > 0) status = 'partial';
    else if (status === 'paid' || status === 'partial') status = inv.viewed_at ? 'viewed' : 'sent';
  }
  const lastPay = get('SELECT MAX(received_on) d FROM payments WHERE invoice_id=:id', { id }).d;
  update('invoices', id, { subtotal: t.subtotal, discount: t.discount, tax: t.tax, total: t.total, cost: t.cost, amount_paid: paid, balance, status, paid_at: status === 'paid' ? (inv.paid_at || lastPay || today()) : null });
  return { before: inv.status, after: status };
}
const SELECT = `SELECT i.*, c.name customer_name, c.email customer_email, c.phone customer_phone, c.number customer_number, j.number job_number, j.title job_title,
  l.street, l.city, l.state, l.zip, c.billing_street, c.billing_city, c.billing_state, c.billing_zip,
  CASE WHEN i.status IN ${OPEN} AND i.due_date < :today THEN 1 ELSE 0 END is_overdue
  FROM invoices i JOIN customers c ON c.id=i.customer_id LEFT JOIN jobs j ON j.id=i.job_id LEFT JOIN locations l ON l.id=i.location_id`;
function getInvoice(id) {
  const i = get(`${SELECT} WHERE i.id=:id`, { id, today: today() }) || notFound('Invoice');
  i.items = L.getLines('invoice', id);
  i.payments = all('SELECT * FROM payments WHERE invoice_id=:id ORDER BY received_on, id', { id });
  i.address = addressLine(i);
  i.billing_address = addressLine({ street: i.billing_street, city: i.billing_city, state: i.billing_state, zip: i.billing_zip });
  i.public_url = publicUrl(i);
  i.activity = A.listFor('invoice', id, 60);
  i.status_label = LABEL[i.status];
  i.days_overdue = i.is_overdue ? daysBetween(i.due_date, today()) : 0;
  return i;
}

op({
  name: 'list_invoices', method: 'GET', path: '/api/invoices', tags: ['Invoices'], roles: R.BOOKS,
  title: 'List invoices', description: 'Invoices. status: draft, sent, viewed, partial, paid, void, "open"/"unpaid" (sent, viewed or partially paid), "overdue" (unpaid and past due).',
  input: S.obj({ q: S.str(), status: S.enum([...STATUS, 'open', 'unpaid', 'overdue', 'all']), customer_id: S.idOpt, job_id: S.idOpt, from: S.date, to: S.date, limit: S.limit }),
  handler: i => {
    const w = []; const p = { l: i.limit || 200, today: today() };
    if (i.status === 'open' || i.status === 'unpaid') w.push(`i.status IN ${OPEN}`);
    else if (i.status === 'overdue') w.push(`i.status IN ${OPEN} AND i.due_date < :today`);
    else if (i.status && i.status !== 'all') { w.push('i.status=:s'); p.s = i.status; }
    if (i.q) { w.push('(i.number LIKE :q OR i.title LIKE :q OR c.name LIKE :q OR j.number LIKE :q)'); p.q = `%${i.q}%`; }
    if (i.customer_id) { w.push('i.customer_id=:c'); p.c = i.customer_id; }
    if (i.job_id) { w.push('i.job_id=:j'); p.j = i.job_id; }
    if (i.from) { w.push('i.issue_date >= :f'); p.f = i.from; }
    if (i.to) { w.push('i.issue_date <= :to'); p.to = i.to; }
    return all(`${SELECT} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY i.id DESC LIMIT :l`, p);
  }
});
op({
  name: 'get_invoice', method: 'GET', path: '/api/invoices/:id', tags: ['Invoices'], roles: R.BOOKS,
  title: 'Get invoice', description: 'Invoice with line items, payments, balance, overdue days, customer payment link (public_url) and history.',
  input: S.obj({ id: S.id }, ['id']), handler: i => getInvoice(i.id)
});

const FIELDS = {
  location_id: S.idOpt, title: S.str('', 200), issue_date: S.date, due_date: S.date, terms_days: S.int('Days until due (default: customer or company terms)', { minimum: 0, maximum: 365 }),
  message: S.str('Note to the customer', 4000), terms: S.str('', 4000), internal_notes: S.str('', 4000), customer_po: S.str('', 100),
  discount: S.num('Dollar discount', { minimum: 0 }), tax_rate: S.num('Tax rate %', { minimum: 0, maximum: 30 })
};

function unbilledFor(job) {
  const lines = []; const marks = { items: [], time: [], expenses: [] };
  for (const li of all("SELECT * FROM line_items WHERE parent_type='job' AND parent_id=:j AND invoice_id IS NULL ORDER BY sort, id", { j: job.id })) {
    lines.push({ ...pick(li, ['pricebook_id', 'kind', 'name', 'description', 'qty', 'unit', 'unit_price', 'unit_cost', 'taxable']), source_type: 'job_item', source_id: li.id });
    marks.items.push(li.id);
  }
  const time = all("SELECT t.*, u.name user_name FROM time_entries t JOIN users u ON u.id=t.user_id WHERE t.job_id=:j AND t.billable=1 AND t.invoice_id IS NULL AND (t.ended_at IS NOT NULL OR t.started_at IS NULL) ORDER BY t.work_date", { j: job.id });
  const groups = new Map();
  for (const t of time) {
    const key = `${t.user_id}|${t.bill_rate}|${t.category}`;
    const g = groups.get(key) || { name: `${t.category === 'consulting' ? 'Consulting' : t.category === 'travel' ? 'Travel time' : 'Labor'} - ${t.user_name}`, hours: 0, rate: t.bill_rate, cost: t.cost_rate, dates: new Set(), notes: [] };
    g.hours += t.hours; g.dates.add(t.work_date); if (t.description) g.notes.push(t.description);
    groups.set(key, g); marks.time.push(t.id);
  }
  for (const g of groups.values()) {
    const d = [...g.dates].sort();
    lines.push({ kind: 'labor', name: g.name, description: `${d.length > 1 ? `${d[0]} to ${d[d.length - 1]}` : d[0]}${g.notes.length ? ': ' + [...new Set(g.notes)].slice(0, 6).join('; ') : ''}`,
      qty: round2(g.hours), unit: 'hr', unit_price: g.rate, unit_cost: g.cost, taxable: 0, source_type: 'time' });
  }
  for (const x of all('SELECT * FROM expenses WHERE job_id=:j AND billable=1 AND invoice_id IS NULL ORDER BY expense_date', { j: job.id })) {
    lines.push({ kind: 'material', name: x.category === 'mileage' ? `Mileage (${x.miles} mi)` : `${x.category[0].toUpperCase() + x.category.slice(1)}${x.vendor ? ' - ' + x.vendor : ''}`,
      description: x.description, qty: 1, unit: '', unit_price: round2(x.amount * (1 + (x.markup_pct || 0) / 100)), unit_cost: x.amount, taxable: 0, source_type: 'expense', source_id: x.id });
    marks.expenses.push(x.id);
  }
  return { lines, marks };
}

function createInvoice(i, ctx, { isDemo = 0 } = {}) {
  const job = i.job_id ? (get('SELECT * FROM jobs WHERE id=:id', { id: i.job_id }) || notFound('Job')) : null;
  const custId = job ? job.customer_id : i.customer_id;
  if (!custId) bad('Give customer_id or job_id.');
  if (job && i.customer_id && i.customer_id !== job.customer_id) bad('That job belongs to a different customer.');
  const cust = get('SELECT * FROM customers WHERE id=:id', { id: custId }) || notFound('Customer');
  const t = now(); const issue = i.issue_date || today();
  const terms = i.terms_days ?? cust.terms_days ?? n('default_terms_days', 14);
  return tx(() => {
    const { lines, marks } = job && i.include_job_work !== false ? unbilledFor(job) : { lines: [], marks: { items: [], time: [], expenses: [] } };
    const all2 = [...lines, ...(i.items || [])];
    if (job && !all2.length) bad(`Nothing left to invoice on ${job.number}: no uninvoiced line items, billable time or billable expenses. Add items to the job or pass items.`);
    const id = insert('invoices', {
      number: nextNumber('INV', 'invoices'), customer_id: cust.id, job_id: job ? job.id : null, location_id: i.location_id || (job ? job.location_id : null),
      title: str(i.title) || (job ? job.title : ''), status: 'draft', issue_date: issue, due_date: i.due_date || addDays(issue, terms),
      message: i.message ?? (setting('invoice_message') || ''), terms: i.terms ?? (setting('invoice_terms') || ''), internal_notes: str(i.internal_notes),
      customer_po: str(i.customer_po) || (job ? job.customer_po : ''), discount: i.discount || 0, tax_rate: i.tax_rate ?? (cust.tax_exempt ? 0 : n('tax_rate', 0)),
      public_token: token(18), created_by: ctx.actor, is_demo: isDemo, created_at: t, updated_at: t
    });
    L.addLines('invoice', id, all2);
    for (const x of marks.items) run('UPDATE line_items SET invoice_id=:i WHERE id=:id', { i: id, id: x });
    for (const x of marks.time) run('UPDATE time_entries SET invoice_id=:i WHERE id=:id', { i: id, id: x });
    for (const x of marks.expenses) run('UPDATE expenses SET invoice_id=:i WHERE id=:id', { i: id, id: x });
    recalc(id);
    A.log('invoice', id, `Invoice created${job ? ` for job ${job.number}` : ''}.`, { ctx, isDemo });
    if (job) {
      A.log('job', job.id, `Invoiced on ${get('SELECT number FROM invoices WHERE id=:id', { id }).number}.`, { ctx, isDemo });
      if (job.status === 'completed') { update('jobs', job.id, { status: 'invoiced', updated_at: t }); emit('job.status_changed', { id: job.id, from: 'completed', to: 'invoiced' }, ctx); }
    }
    emit('invoice.created', { id }, ctx);
    return id;
  });
}
op({
  name: 'create_invoice', method: 'POST', path: '/api/invoices', tags: ['Invoices'],
  title: 'Create invoice', description: 'Create a draft invoice. With job_id it automatically pulls in the job\'s uninvoiced line items, billable time (grouped per person) and billable expenses, then marks the job invoiced if it is completed. Add extra items as needed. Then send_invoice.',
  input: S.obj({ customer_id: S.idOpt, job_id: S.idOpt, include_job_work: S.bool('Pull in the job\'s unbilled work (default true)'), items: L.LINES, ...FIELDS }),
  handler: (i, ctx) => getInvoice(createInvoice(i, ctx))
});
op({
  name: 'update_invoice', method: 'PUT', path: '/api/invoices/:id', tags: ['Invoices'],
  title: 'Update invoice', description: 'Edit an unpaid invoice. Sending items replaces the line items. Paid and void invoices are locked.',
  input: S.obj({ id: S.id, items: L.LINES, ...FIELDS }, ['id']),
  handler: (i, ctx) => {
    const inv = get('SELECT * FROM invoices WHERE id=:id', { id: i.id }) || notFound('Invoice');
    if (['paid', 'void'].includes(inv.status)) bad(`This invoice is ${inv.status} and locked.`);
    const o = pick(i, ['location_id', 'title', 'issue_date', 'due_date', 'message', 'terms', 'internal_notes', 'customer_po', 'discount', 'tax_rate']);
    if (i.terms_days !== undefined && i.terms_days !== null && !o.due_date) o.due_date = addDays(o.issue_date || inv.issue_date, i.terms_days);
    tx(() => {
      update('invoices', inv.id, { ...o, updated_at: now() });
      if (i.items) L.setLines('invoice', inv.id, i.items);
      recalc(inv.id);
      A.log('invoice', inv.id, 'Invoice updated.', { ctx });
    });
    return getInvoice(inv.id);
  }
});

async function emailInvoice(inv, { to, cc, subject, message, reminder = false }, ctx) {
  const addr = str(to) || inv.customer_email || get("SELECT email FROM contacts WHERE customer_id=:c AND email != '' ORDER BY is_primary DESC LIMIT 1", { c: inv.customer_id })?.email;
  if (!addr) bad('The customer has no email address. Add one, pass "to", or use method "mark_sent" and share the link.');
  const m = reminder ? tpl.reminderEmail(inv, { message, subject }) : tpl.invoiceEmail(inv, { message, subject });
  return mailer.send({ to: addr, cc, subject: m.subject, text: m.text, html: m.html, ctx, customerId: inv.customer_id, entity: ['invoice', inv.id] });
}
op({
  name: 'send_invoice', method: 'POST', path: '/api/invoices/:id/send', tags: ['Invoices'], scope: 'email.send',
  title: 'Send invoice', description: 'Email the invoice with its online view/pay link from the business Gmail account, or method "mark_sent" if you delivered it another way.',
  input: S.obj({ id: S.id, method: S.enum(['email', 'mark_sent']), to: S.str('', 300), cc: S.str('', 300), subject: S.str('', 300), message: S.str('', 6000) }, ['id']),
  handler: async (i, ctx) => {
    const inv = getInvoice(i.id);
    if (inv.status === 'void') bad('This invoice is void.');
    if (!inv.items.length) bad('This invoice has no line items.');
    const sent = (i.method || 'email') === 'email' ? await emailInvoice(inv, i, ctx) : null;
    tx(() => {
      update('invoices', inv.id, { status: inv.status === 'draft' ? 'sent' : inv.status, sent_at: now(), updated_at: now() });
      A.log('invoice', inv.id, sent ? `Emailed to ${sent.to}.` : 'Marked as sent.', { ctx, kind: sent ? 'email' : 'system' });
      emit('invoice.sent', { id: inv.id, emailed: !!sent }, ctx);
    });
    return { ...getInvoice(inv.id), emailed: !!sent };
  }
});
op({
  name: 'send_payment_reminder', method: 'POST', path: '/api/invoices/:id/remind', tags: ['Invoices'], scope: 'email.send',
  title: 'Send payment reminder', description: 'Email a polite payment reminder for an unpaid invoice (includes the pay link and days overdue).',
  input: S.obj({ id: S.id, to: S.str('', 300), message: S.str('Custom reminder text', 6000), subject: S.str('', 300) }, ['id']),
  handler: async (i, ctx) => remind(i.id, i, ctx)
});
async function remind(id, opts, ctx) {
  const inv = getInvoice(id);
  if (!['sent', 'viewed', 'partial'].includes(inv.status)) bad(`Reminders are for unpaid sent invoices (this one is ${inv.status}).`);
  const sent = await emailInvoice(inv, { ...opts, reminder: true }, ctx);
  update('invoices', inv.id, { last_reminder_at: now(), reminder_count: inv.reminder_count + 1, updated_at: now() });
  A.log('invoice', inv.id, `Payment reminder #${inv.reminder_count + 1} emailed to ${sent.to}.`, { ctx, kind: 'email' });
  return getInvoice(inv.id);
}
op({
  name: 'void_invoice', method: 'POST', path: '/api/invoices/:id/void', tags: ['Invoices'],
  title: 'Void invoice', description: 'Cancel an invoice that should not be paid. Its job work becomes uninvoiced again so it can be re-invoiced. Invoices with payments cannot be voided.',
  input: S.obj({ id: S.id, reason: S.str('', 1000) }, ['id']),
  handler: (i, ctx) => {
    const inv = get('SELECT * FROM invoices WHERE id=:id', { id: i.id }) || notFound('Invoice');
    if (inv.status === 'void') return getInvoice(inv.id);
    if (get('SELECT id FROM payments WHERE invoice_id=:id', { id: inv.id })) bad('This invoice has payments. Delete or refund them first.');
    tx(() => {
      update('invoices', inv.id, { status: 'void', voided_at: now(), balance: 0, updated_at: now() });
      run('UPDATE line_items SET invoice_id=NULL WHERE invoice_id=:i', { i: inv.id });
      run('UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=:i', { i: inv.id });
      run('UPDATE expenses SET invoice_id=NULL WHERE invoice_id=:i', { i: inv.id });
      if (inv.job_id) run("UPDATE jobs SET status='completed', updated_at=:t WHERE id=:j AND status='invoiced'", { j: inv.job_id, t: now() });
      A.log('invoice', inv.id, `Invoice voided${i.reason ? `: ${i.reason}` : ''}.`, { ctx, kind: 'status' });
      emit('invoice.voided', { id: inv.id }, ctx);
    });
    return getInvoice(inv.id);
  }
});
op({
  name: 'delete_invoice', method: 'DELETE', path: '/api/invoices/:id', tags: ['Invoices'], scope: 'admin', mcp: false,
  title: 'Delete draft invoice', input: S.obj({ id: S.id }, ['id']),
  handler: i => {
    const inv = get('SELECT * FROM invoices WHERE id=:id', { id: i.id }) || notFound('Invoice');
    if (inv.status !== 'draft') bad('Only draft invoices can be deleted. Void sent invoices instead.');
    tx(() => {
      run('UPDATE line_items SET invoice_id=NULL WHERE invoice_id=:i', { i: inv.id });
      run('UPDATE time_entries SET invoice_id=NULL WHERE invoice_id=:i', { i: inv.id });
      run('UPDATE expenses SET invoice_id=NULL WHERE invoice_id=:i', { i: inv.id });
      if (inv.job_id) run("UPDATE jobs SET status='completed' WHERE id=:j AND status='invoiced'", { j: inv.job_id });
      run("DELETE FROM line_items WHERE parent_type='invoice' AND parent_id=:i", { i: inv.id });
      run("DELETE FROM activity WHERE entity_type='invoice' AND entity_id=:i", { i: inv.id });
      run('DELETE FROM invoices WHERE id=:i', { i: inv.id });
    });
    return { ok: true };
  }
});

// ---------------- payments ----------------
function recordPayment(i, ctx, { isDemo = 0 } = {}) {
  const inv = get('SELECT * FROM invoices WHERE id=:id', { id: i.invoice_id }) || notFound('Invoice');
  if (inv.status === 'void') bad('This invoice is void.');
  if (inv.status === 'draft') update('invoices', inv.id, { status: 'sent', sent_at: inv.sent_at || now() });
  const amount = round2(i.amount ?? inv.balance);
  if (!(amount > 0)) bad('amount must be greater than zero.');
  if (amount > round2(inv.balance) + 0.01) bad(`amount ($${amount.toFixed(2)}) is more than the balance ($${inv.balance.toFixed(2)}).`);
  return tx(() => {
    const pid = insert('payments', { invoice_id: inv.id, customer_id: inv.customer_id, amount, method: i.method || 'check', reference: str(i.reference), received_on: i.received_on || today(),
      notes: str(i.notes), external_id: i.external_id || null, created_by: ctx.actor, is_demo: isDemo, created_at: now() });
    const st = recalc(inv.id);
    A.log('invoice', inv.id, `Payment received: $${amount.toFixed(2)} by ${i.method || 'check'}${i.reference ? ` (#${i.reference})` : ''}.`, { ctx, isDemo });
    emit('payment.recorded', { id: pid, invoice_id: inv.id, amount }, ctx);
    if (st.after === 'paid' && st.before !== 'paid') emit('invoice.paid', { id: inv.id }, ctx);
    return pid;
  });
}
op({
  name: 'record_payment', method: 'POST', path: '/api/invoices/:invoice_id/payments', tags: ['Invoices'],
  title: 'Record payment', description: 'Record money received against an invoice (defaults to the full balance). Updates balance and status (partial / paid).',
  input: S.obj({ invoice_id: S.id, amount: S.num('Default: full balance', { minimum: 0.01 }), method: S.enum(METHODS), reference: S.str('Check # or transaction id', 100), received_on: S.date, notes: S.str('', 1000) }, ['invoice_id']),
  handler: (i, ctx) => { recordPayment(i, ctx); return getInvoice(i.invoice_id); }
});
op({
  name: 'list_payments', method: 'GET', path: '/api/payments', tags: ['Invoices'], roles: R.BOOKS,
  title: 'List payments', description: 'Money received, newest first. Filter by date range, method or customer.',
  input: S.obj({ from: S.date, to: S.date, method: S.enum(METHODS), customer_id: S.idOpt, limit: S.limit }),
  handler: i => {
    const w = []; const p = { l: i.limit || 300 };
    if (i.from) { w.push('p.received_on >= :f'); p.f = i.from; }
    if (i.to) { w.push('p.received_on <= :t'); p.t = i.to; }
    if (i.method) { w.push('p.method=:m'); p.m = i.method; }
    if (i.customer_id) { w.push('p.customer_id=:c'); p.c = i.customer_id; }
    return all(`SELECT p.*, i.number invoice_number, c.name customer_name FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=p.customer_id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY p.received_on DESC, p.id DESC LIMIT :l`, p);
  }
});
op({
  name: 'delete_payment', method: 'DELETE', path: '/api/payments/:id', tags: ['Invoices'], scope: 'admin', mcp: false,
  title: 'Delete payment', input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const p = get('SELECT * FROM payments WHERE id=:id', { id: i.id }) || notFound('Payment');
    tx(() => { run('DELETE FROM payments WHERE id=:id', { id: p.id }); if (p.invoice_id) { recalc(p.invoice_id); A.log('invoice', p.invoice_id, `Payment of $${p.amount.toFixed(2)} deleted.`, { ctx }); } });
    return { ok: true };
  }
});

op({
  name: 'get_ar_aging', method: 'GET', path: '/api/reports/ar-aging', tags: ['Reports'], roles: R.BOOKS,
  title: 'Accounts receivable aging', description: 'Who owes money and how late: unpaid balances per customer in buckets (current, 1-30, 31-60, 61-90, 90+ days past due), with each open invoice.',
  input: S.obj({}),
  handler: () => {
    const t = today();
    const rows = all(`SELECT i.id, i.number, i.customer_id, c.name customer_name, c.email customer_email, i.issue_date, i.due_date, i.total, i.balance, i.status, i.reminder_count, i.last_reminder_at
      FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ${OPEN} AND i.balance > 0 ORDER BY i.due_date`);
    const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
    const by = new Map(); const totals = Object.fromEntries([...buckets, 'total'].map(b => [b, 0]));
    for (const r of rows) {
      const late = daysBetween(r.due_date, t);
      r.days_overdue = Math.max(0, late);
      const b = late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90_plus';
      const c = by.get(r.customer_id) || { customer_id: r.customer_id, customer_name: r.customer_name, customer_email: r.customer_email, ...Object.fromEntries([...buckets, 'total'].map(x => [x, 0])), invoices: [] };
      c[b] = round2(c[b] + r.balance); c.total = round2(c.total + r.balance); c.invoices.push(r);
      totals[b] = round2(totals[b] + r.balance); totals.total = round2(totals.total + r.balance);
      by.set(r.customer_id, c);
    }
    return { as_of: t, totals, customers: [...by.values()].sort((a, b) => b.total - a.total) };
  }
});

// ---------------- customer-facing (public link) ----------------
function publicView(i) {
  return {
    kind: 'invoice', number: i.number, title: i.title, status: i.status, status_label: LABEL[i.status], issue_date: i.issue_date, due_date: i.due_date, is_overdue: !!i.is_overdue,
    message: i.message, terms: i.terms, customer_po: i.customer_po, customer: { name: i.customer_name }, address: i.address, billing_address: i.billing_address,
    items: i.items.map(l => pick(l, ['name', 'description', 'qty', 'unit', 'unit_price', 'total', 'kind'])),
    subtotal: i.subtotal, discount: i.discount, tax: i.tax, tax_rate: i.tax_rate, total: i.total, amount_paid: i.amount_paid, balance: i.balance,
    payments: i.payments.map(p => pick(p, ['amount', 'method', 'received_on'])), company: company(), currency: setting('currency') || 'USD',
    pay_online: !!require('../integrations/stripe').enabled() && i.balance > 0 && i.status !== 'void',
    payment_instructions: setting('payment_instructions') || ''
  };
}
op({
  name: 'public_get_invoice', method: 'GET', path: '/public/invoices/:token', public: true, mcp: false, tags: ['Customer portal'],
  title: 'Customer view of an invoice', input: S.obj({ token: S.str() }, ['token']),
  handler: (i, ctx) => {
    const r = get('SELECT id FROM invoices WHERE public_token=:t', { t: i.token }) || notFound('Invoice');
    const inv = getInvoice(r.id);
    if (inv.status === 'draft') notFound('Invoice');
    if (!inv.viewed_at) {
      update('invoices', inv.id, { viewed_at: now(), status: inv.status === 'sent' ? 'viewed' : inv.status });
      A.log('invoice', inv.id, 'Customer opened the invoice.', { ctx });
      emit('invoice.viewed', { id: inv.id }, ctx);
    }
    return publicView(getInvoice(inv.id));
  }
});

module.exports = { getInvoice, createInvoice, recordPayment, recalc, remind, publicUrl, unbilledFor, STATUS, LABEL, METHODS, OPEN };
