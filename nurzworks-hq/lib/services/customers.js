'use strict';
// CRM: customers, contacts and service locations.
const { all, get, run, insert, update, tx, now, nextNumber } = require('../db');
const { bad, notFound, str, token, normEmail, addressLine, pick } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const A = require('./activity');
const { emit } = require('../events');

const STATUS = ['lead', 'active', 'inactive'];
const KIND = ['residential', 'commercial'];
const ADDRESS = S.obj({
  name: S.str('Label such as "Home" or "Main plant"', 120), street: S.str('', 200), city: S.str('', 100), state: S.str('', 50), zip: S.str('', 20),
  access_notes: S.str('Gate codes, parking, pets, who to ask for', 2000), lat: { type: ['number', 'null'] }, lng: { type: ['number', 'null'] }
}, [], 'Service address');
const FIELDS = {
  name: S.str('Display name: person or business', 200), kind: S.enum(KIND), company: S.str('', 200),
  email: { type: 'string', maxLength: 200, description: 'Primary email' }, phone: S.str('Primary phone', 50), alt_phone: S.str('', 50),
  status: S.enum(STATUS, 'lead = prospect, active = customer, inactive = past customer'), source: S.str('Lead source: referral, website, google, repeat, sign, other', 100),
  tags: S.str('Comma-separated tags', 500), billing_street: S.str('', 200), billing_city: S.str('', 100), billing_state: S.str('', 50), billing_zip: S.str('', 20),
  notes: S.str('Internal notes', 10000), tax_exempt: S.bool(), terms_days: { type: ['integer', 'null'], minimum: 0, maximum: 365, description: 'Payment terms in days (blank = company default)' }
};
const COLS = Object.keys(FIELDS);

function clean(i) {
  const o = pick(i, COLS);
  for (const k of COLS) if (typeof o[k] === 'string') o[k] = o[k].trim();
  if (o.email !== undefined) o.email = normEmail(o.email);
  if (o.tags !== undefined) o.tags = o.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean).filter((t, j, a) => a.indexOf(t) === j).join(', ');
  if (o.tax_exempt !== undefined) o.tax_exempt = o.tax_exempt ? 1 : 0;
  return o;
}
function duplicates(email, phone, exceptId = 0) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!email && d.length < 7) return [];
  return all(`SELECT id, number, name, email, phone FROM customers WHERE id != :x AND ((:e != '' AND lower(email)=:e) OR (length(:d) >= 7 AND digits(phone) LIKE '%' || :d))`,
    { x: exceptId, e: normEmail(email), d: d.slice(-10) });
}
function primaryLocation(customerId) {
  return get('SELECT * FROM locations WHERE customer_id=:c ORDER BY is_primary DESC, id LIMIT 1', { c: customerId });
}
function addLocation(customerId, loc, ctx, { quiet = false } = {}) {
  const hasAny = get('SELECT id FROM locations WHERE customer_id=:c', { c: customerId });
  const t = now();
  const id = insert('locations', {
    customer_id: customerId, name: str(loc.name) || (hasAny ? '' : 'Primary'), street: str(loc.street), city: str(loc.city), state: str(loc.state), zip: str(loc.zip),
    lat: loc.lat ?? null, lng: loc.lng ?? null, access_notes: str(loc.access_notes), is_primary: hasAny ? (loc.is_primary ? 1 : 0) : 1, created_at: t, updated_at: t
  });
  if (loc.is_primary && hasAny) run('UPDATE locations SET is_primary=0 WHERE customer_id=:c AND id!=:id', { c: customerId, id });
  if (!quiet) A.log('customer', customerId, `Added service location: ${addressLine(loc) || loc.name}.`, { ctx });
  return id;
}

const LIST_SQL = `SELECT c.*,
  (SELECT COUNT(*) FROM jobs j WHERE j.customer_id=c.id AND j.status NOT IN ('completed','invoiced','cancelled')) open_jobs,
  (SELECT COALESCE(SUM(balance),0) FROM invoices i WHERE i.customer_id=c.id AND i.status IN ('sent','viewed','partial')) balance,
  (SELECT MAX(created_at) FROM activity a WHERE a.customer_id=c.id) last_activity,
  (SELECT street || CASE WHEN city != '' THEN ', ' || city ELSE '' END FROM locations l WHERE l.customer_id=c.id ORDER BY is_primary DESC, id LIMIT 1) address
  FROM customers c`;

op({
  name: 'list_customers', method: 'GET', path: '/api/customers', tags: ['Customers'],
  title: 'List / search customers', description: 'Search customers by name, company, email, phone (any format), customer number, tag or address. Returns open job count and unpaid balance for each.',
  input: S.obj({ q: S.str('Search text'), status: S.enum(STATUS), tag: S.str(), sort: S.enum(['name', 'recent', 'balance', 'created']), limit: S.limit, offset: S.offset }),
  handler: i => {
    const w = []; const p = { l: i.limit || 100, o: i.offset || 0 };
    if (i.q) {
      p.q = `%${i.q}%`; p.d = i.q.replace(/\D/g, '');
      w.push(`(c.name LIKE :q OR c.company LIKE :q OR c.email LIKE :q OR c.number LIKE :q OR c.tags LIKE :q
        OR (length(:d) >= 4 AND (digits(c.phone) LIKE '%' || :d || '%' OR digits(c.alt_phone) LIKE '%' || :d || '%'))
        OR EXISTS (SELECT 1 FROM locations l WHERE l.customer_id=c.id AND (l.street LIKE :q OR l.city LIKE :q OR l.name LIKE :q))
        OR EXISTS (SELECT 1 FROM contacts k WHERE k.customer_id=c.id AND (k.name LIKE :q OR k.email LIKE :q)))`);
    }
    if (i.status) { w.push('c.status=:s'); p.s = i.status; }
    if (i.tag) { w.push("(', ' || c.tags || ',') LIKE :tg"); p.tg = `%, ${i.tag.toLowerCase()},%`; }
    const order = { name: 'c.name COLLATE NOCASE', recent: 'COALESCE(last_activity, c.updated_at) DESC', balance: 'balance DESC', created: 'c.created_at DESC' }[i.sort] || 'c.name COLLATE NOCASE';
    return all(`${LIST_SQL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ${order} LIMIT :l OFFSET :o`, p);
  }
});

op({
  name: 'lookup_customers', method: 'GET', path: '/api/lookup/customers', tags: ['Customers'], mcp: false,
  title: 'Customer picker list', input: S.obj({}),
  handler: () => all(`SELECT c.id, c.number, c.name, c.company, c.email, c.phone, c.status,
    (SELECT json_group_array(json_object('id', l.id, 'name', l.name, 'address', trim(l.street || ', ' || l.city, ', '), 'is_primary', l.is_primary)) FROM locations l WHERE l.customer_id=c.id) locations
    FROM customers c ORDER BY c.name COLLATE NOCASE`).map(r => ({ ...r, locations: JSON.parse(r.locations || '[]') }))
});

function getCustomer(id) {
  const c = get(`${LIST_SQL} WHERE c.id=:id`, { id }) || notFound('Customer');
  c.contacts = all('SELECT * FROM contacts WHERE customer_id=:id ORDER BY is_primary DESC, name', { id });
  c.locations = all('SELECT * FROM locations WHERE customer_id=:id ORDER BY is_primary DESC, id', { id }).map(l => ({ ...l, address: addressLine(l) }));
  c.jobs = all(`SELECT j.id, j.number, j.title, j.status, j.type, j.priority, j.created_at, j.completed_at,
      (SELECT MIN(start_at) FROM visits v WHERE v.job_id=j.id AND v.status NOT IN ('completed','cancelled')) next_visit
    FROM jobs j WHERE j.customer_id=:id ORDER BY j.created_at DESC LIMIT 50`, { id });
  c.estimates = all('SELECT id, number, title, status, total, issue_date, expiry_date FROM estimates WHERE customer_id=:id ORDER BY created_at DESC LIMIT 50', { id });
  c.invoices = all('SELECT id, number, title, status, total, balance, issue_date, due_date FROM invoices WHERE customer_id=:id ORDER BY created_at DESC LIMIT 50', { id });
  c.plans = all('SELECT id, number, name, status, interval_value, interval_unit, next_due, price FROM plans WHERE customer_id=:id ORDER BY status, next_due', { id });
  c.tasks = all("SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.customer_id=:id AND t.status NOT IN ('done','cancelled') ORDER BY COALESCE(t.due_date,'9999')", { id });
  c.emails = all('SELECT thread_id, subject, snippet, from_name, from_email, last_date, unread FROM email_threads WHERE customer_id=:id ORDER BY last_date DESC LIMIT 25', { id });
  c.stats = get(`SELECT
      (SELECT COALESCE(SUM(amount),0) FROM payments WHERE customer_id=:id) lifetime_paid,
      (SELECT COALESCE(SUM(total),0) FROM invoices WHERE customer_id=:id AND status != 'void') lifetime_invoiced,
      (SELECT COUNT(*) FROM jobs WHERE customer_id=:id) job_count,
      (SELECT COUNT(*) FROM jobs WHERE customer_id=:id AND status IN ('completed','invoiced')) jobs_done,
      (SELECT MIN(created_at) FROM jobs WHERE customer_id=:id) first_job`, { id });
  c.activity = A.listForCustomer(id, 60);
  c.portal_url = `${require('../config').baseUrl()}/p/c/${c.portal_token}`;
  return c;
}

op({
  name: 'get_customer', method: 'GET', path: '/api/customers/:id', tags: ['Customers'],
  title: 'Get customer', description: 'Full customer record: contacts, service locations, jobs, estimates, invoices, service plans, open tasks, linked emails, lifetime stats and activity timeline.',
  input: S.obj({ id: S.id }, ['id']),
  handler: i => getCustomer(i.id)
});

op({
  name: 'create_customer', method: 'POST', path: '/api/customers', tags: ['Customers'],
  title: 'Create customer', description: 'Create a customer (or lead). Optionally include a service address. Returns the new customer plus possible_duplicates if the email or phone matches an existing customer - check those before creating more.',
  input: S.obj({ ...FIELDS, address: ADDRESS, contacts: { type: 'array', items: S.obj({ name: S.str(), role: S.str(), email: S.str(), phone: S.str() }, ['name']), maxItems: 20 } }, ['name']),
  handler: (i, ctx) => {
    const o = clean(i);
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) bad('email must be a valid email address.');
    const dups = duplicates(o.email, o.phone);
    const t = now();
    const id = tx(() => {
      const id = insert('customers', {
        kind: 'residential', status: 'active', ...o, number: nextNumber('C', 'customers'), portal_token: token(18), created_by: ctx.actor, created_at: t, updated_at: t
      });
      const addr = i.address;
      if (addr && (addr.street || addr.city || addr.name)) {
        addLocation(id, addr, ctx, { quiet: true });
        if (!o.billing_street && addr.street) update('customers', id, { billing_street: str(addr.street), billing_city: str(addr.city), billing_state: str(addr.state), billing_zip: str(addr.zip) });
      }
      for (const k of i.contacts || []) insert('contacts', { customer_id: id, name: str(k.name), role: str(k.role), email: normEmail(k.email), phone: str(k.phone), created_at: t });
      A.log('customer', id, `Customer created${o.status === 'lead' ? ' as a lead' : ''}${o.source ? ` (source: ${o.source})` : ''}.`, { ctx, customerId: id });
      emit('customer.created', { id }, ctx);
      return id;
    });
    const c = getCustomer(id);
    if (dups.length) c.possible_duplicates = dups;
    return c;
  }
});

op({
  name: 'update_customer', method: 'PUT', path: '/api/customers/:id', tags: ['Customers'],
  title: 'Update customer', description: 'Change any customer fields. Only the fields you send are changed.',
  input: S.obj({ id: S.id, ...FIELDS }, ['id']),
  handler: (i, ctx) => {
    const cur = get('SELECT * FROM customers WHERE id=:id', { id: i.id }) || notFound('Customer');
    const o = clean(i);
    if (o.name === '') bad('name is required.');
    if (o.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) bad('email must be a valid email address.');
    const changed = Object.keys(o).filter(k => String(o[k] ?? '') !== String(cur[k] ?? ''));
    if (!changed.length) return getCustomer(cur.id);
    tx(() => {
      update('customers', cur.id, { ...o, updated_at: now() });
      if (o.status && o.status !== cur.status) A.log('customer', cur.id, `Status changed from ${cur.status} to ${o.status}.`, { ctx, kind: 'status' });
      else A.log('customer', cur.id, `Updated ${changed.map(k => k.replace(/_/g, ' ')).join(', ')}.`, { ctx });
      emit('customer.updated', { id: cur.id, changed }, ctx);
    });
    return getCustomer(cur.id);
  }
});

op({
  name: 'delete_customer', method: 'DELETE', path: '/api/customers/:id', tags: ['Customers'], scope: 'admin', mcp: false,
  title: 'Delete customer', description: 'Permanently delete a customer and all of their jobs, estimates, invoices and history.',
  input: S.obj({ id: S.id }, ['id']),
  handler: i => {
    const c = get('SELECT id FROM customers WHERE id=:id', { id: i.id }) || notFound('Customer');
    tx(() => {
      for (const t of ['estimate', 'job', 'invoice']) run(`DELETE FROM line_items WHERE parent_type='${t}' AND parent_id IN (SELECT id FROM ${t}s WHERE customer_id=:c)`, { c: c.id });
      run('DELETE FROM activity WHERE customer_id=:c', { c: c.id });
      run('DELETE FROM customers WHERE id=:c', { c: c.id });
    });
    return { ok: true };
  }
});

// ---------------- contacts ----------------
const CONTACT = { name: S.str('', 200), role: S.str('Title or relationship, e.g. Facilities Manager', 120), email: S.str('', 200), phone: S.str('', 50), is_primary: S.bool(), notes: S.str('', 2000) };
op({
  name: 'add_contact', method: 'POST', path: '/api/customers/:customer_id/contacts', tags: ['Customers'],
  title: 'Add contact person', description: 'Add a person (decision maker, tenant, site contact) to a customer.',
  input: S.obj({ customer_id: S.id, ...CONTACT }, ['customer_id', 'name']),
  handler: (i, ctx) => {
    get('SELECT id FROM customers WHERE id=:id', { id: i.customer_id }) || notFound('Customer');
    const id = insert('contacts', { customer_id: i.customer_id, name: str(i.name), role: str(i.role), email: normEmail(i.email), phone: str(i.phone), is_primary: i.is_primary ? 1 : 0, notes: str(i.notes), created_at: now() });
    if (i.is_primary) run('UPDATE contacts SET is_primary=0 WHERE customer_id=:c AND id!=:id', { c: i.customer_id, id });
    A.log('customer', i.customer_id, `Added contact ${i.name}${i.role ? ` (${i.role})` : ''}.`, { ctx });
    return get('SELECT * FROM contacts WHERE id=:id', { id });
  }
});
op({
  name: 'update_contact', method: 'PUT', path: '/api/contacts/:id', tags: ['Customers'],
  title: 'Update contact person', input: S.obj({ id: S.id, ...CONTACT }, ['id']),
  handler: i => {
    const k = get('SELECT * FROM contacts WHERE id=:id', { id: i.id }) || notFound('Contact');
    const o = pick(i, Object.keys(CONTACT));
    if (o.email !== undefined) o.email = normEmail(o.email);
    if (o.is_primary !== undefined) o.is_primary = o.is_primary ? 1 : 0;
    update('contacts', k.id, o);
    if (o.is_primary) run('UPDATE contacts SET is_primary=0 WHERE customer_id=:c AND id!=:id', { c: k.customer_id, id: k.id });
    return get('SELECT * FROM contacts WHERE id=:id', { id: k.id });
  }
});
op({
  name: 'delete_contact', method: 'DELETE', path: '/api/contacts/:id', tags: ['Customers'], mcp: false,
  title: 'Delete contact person', input: S.obj({ id: S.id }, ['id']),
  handler: i => { run('DELETE FROM contacts WHERE id=:id', { id: i.id }); return { ok: true }; }
});

// ---------------- locations ----------------
op({
  name: 'add_location', method: 'POST', path: '/api/customers/:customer_id/locations', tags: ['Customers'],
  title: 'Add service location', description: 'Add a service address (property, site, branch) to a customer. Jobs and visits happen at locations.',
  input: S.obj({ customer_id: S.id, ...ADDRESS.properties, is_primary: S.bool() }, ['customer_id']),
  handler: (i, ctx) => {
    get('SELECT id FROM customers WHERE id=:id', { id: i.customer_id }) || notFound('Customer');
    if (!str(i.street) && !str(i.name)) bad('Enter a street address or a name for the location.');
    const id = addLocation(i.customer_id, i, ctx);
    return { ...get('SELECT * FROM locations WHERE id=:id', { id }), address: addressLine(get('SELECT * FROM locations WHERE id=:id', { id })) };
  }
});
op({
  name: 'update_location', method: 'PUT', path: '/api/locations/:id', tags: ['Customers'],
  title: 'Update service location', input: S.obj({ id: S.id, ...ADDRESS.properties, is_primary: S.bool() }, ['id']),
  handler: i => {
    const l = get('SELECT * FROM locations WHERE id=:id', { id: i.id }) || notFound('Location');
    const o = pick(i, ['name', 'street', 'city', 'state', 'zip', 'lat', 'lng', 'access_notes', 'is_primary']);
    if (o.is_primary !== undefined) o.is_primary = o.is_primary ? 1 : 0;
    update('locations', l.id, { ...o, updated_at: now() });
    if (o.is_primary) run('UPDATE locations SET is_primary=0 WHERE customer_id=:c AND id!=:id', { c: l.customer_id, id: l.id });
    const r = get('SELECT * FROM locations WHERE id=:id', { id: l.id });
    return { ...r, address: addressLine(r) };
  }
});
op({
  name: 'delete_location', method: 'DELETE', path: '/api/locations/:id', tags: ['Customers'], mcp: false,
  title: 'Delete service location', input: S.obj({ id: S.id }, ['id']),
  handler: i => { run('DELETE FROM locations WHERE id=:id', { id: i.id }); return { ok: true }; }
});

// find a customer by email/phone (used by request conversion, Gmail linking, Slack)
function findByContact(email, phone) {
  const e = normEmail(email);
  if (e) {
    const c = get('SELECT * FROM customers WHERE lower(email)=:e', { e }) || get('SELECT c.* FROM contacts k JOIN customers c ON c.id=k.customer_id WHERE lower(k.email)=:e', { e });
    if (c) return c;
  }
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  if (d.length >= 7) return get("SELECT * FROM customers WHERE digits(phone) LIKE '%' || :d OR digits(alt_phone) LIKE '%' || :d", { d });
  return null;
}

module.exports = { getCustomer, addLocation, primaryLocation, findByContact, duplicates, STATUS };
