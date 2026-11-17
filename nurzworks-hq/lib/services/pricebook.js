'use strict';
// Price book (services, labor, materials, fees) and the shared line-item engine for estimates, jobs and invoices.
const { all, get, run, insert, update, now } = require('../db');
const { bad, notFound, str, num, round2, pick } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');

const KINDS = ['service', 'labor', 'material', 'fee', 'discount'];
const ITEM = {
  code: S.str('SKU / short code', 60), name: S.str('', 200), description: S.str('', 4000), kind: S.enum(KINDS),
  unit: S.str('ea, hr, ft, visit...', 20), price: S.num('Customer price per unit'), cost: S.num('Your cost per unit'),
  taxable: S.bool(), category: S.str('', 100), active: S.bool()
};

op({
  name: 'list_pricebook', method: 'GET', path: '/api/pricebook', tags: ['Price book'],
  title: 'List price book', description: 'Standard services, labor rates, materials and fees with prices. Use these items (pricebook_id) when building estimates, jobs and invoices so pricing stays consistent.',
  input: S.obj({ q: S.str(), kind: S.enum(KINDS), category: S.str(), include_inactive: S.bool() }),
  handler: i => {
    const w = []; const p = {};
    if (!i.include_inactive) w.push('active=1');
    if (i.q) { w.push('(name LIKE :q OR code LIKE :q OR description LIKE :q OR category LIKE :q)'); p.q = `%${i.q}%`; }
    if (i.kind) { w.push('kind=:k'); p.k = i.kind; }
    if (i.category) { w.push('category=:c'); p.c = i.category; }
    return all(`SELECT *, (SELECT COUNT(*) FROM line_items li WHERE li.pricebook_id=p.id) uses FROM pricebook p ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY category, name`, p);
  }
});
op({
  name: 'create_pricebook_item', method: 'POST', path: '/api/pricebook', tags: ['Price book'],
  title: 'Add price book item', input: S.obj(ITEM, ['name']),
  handler: i => {
    const t = now();
    const id = insert('pricebook', { kind: 'service', unit: 'ea', price: 0, cost: 0, active: 1, ...pick(i, Object.keys(ITEM)), taxable: i.taxable ? 1 : 0, active: i.active === false ? 0 : 1, created_at: t, updated_at: t });
    return get('SELECT * FROM pricebook WHERE id=:id', { id });
  }
});
op({
  name: 'update_pricebook_item', method: 'PUT', path: '/api/pricebook/:id', tags: ['Price book'],
  title: 'Update price book item', input: S.obj({ id: S.id, ...ITEM }, ['id']),
  handler: i => {
    const cur = get('SELECT * FROM pricebook WHERE id=:id', { id: i.id }) || notFound('Price book item');
    const o = pick(i, Object.keys(ITEM));
    for (const k of ['taxable', 'active']) if (o[k] !== undefined) o[k] = o[k] ? 1 : 0;
    if (o.name === '') bad('name is required.');
    update('pricebook', cur.id, { ...o, updated_at: now() });
    return get('SELECT * FROM pricebook WHERE id=:id', { id: cur.id });
  }
});
op({
  name: 'delete_pricebook_item', method: 'DELETE', path: '/api/pricebook/:id', tags: ['Price book'], mcp: false,
  title: 'Delete price book item', input: S.obj({ id: S.id }, ['id']),
  handler: i => { run('DELETE FROM pricebook WHERE id=:id', { id: i.id }); return { ok: true }; }
});

// ---------------- line items ----------------
const LINE = S.obj({
  pricebook_id: { type: ['integer', 'null'], description: 'Price book item to copy name/price/cost from (fields you send override it)' },
  kind: S.enum(KINDS), name: S.str('Line name', 200), description: S.str('', 4000),
  qty: S.num('Quantity (default 1)'), unit: S.str('', 20), unit_price: S.num('Price per unit to the customer'), unit_cost: S.num('Your cost per unit (for profit tracking)'),
  taxable: S.bool()
}, [], 'A line item. Give pricebook_id, or name + unit_price.');
const LINES = { type: 'array', items: LINE, maxItems: 200 };

function normalizeLine(l) {
  let base = {};
  if (l.pricebook_id) {
    const p = get('SELECT * FROM pricebook WHERE id=:id', { id: l.pricebook_id });
    if (!p) bad(`Price book item ${l.pricebook_id} not found.`);
    base = { pricebook_id: p.id, kind: p.kind, name: p.name, description: p.description, unit: p.unit, unit_price: p.price, unit_cost: p.cost, taxable: p.taxable };
  }
  const o = { kind: 'service', qty: 1, unit: '', unit_price: 0, unit_cost: 0, taxable: 0, description: '', ...base };
  for (const k of ['kind', 'name', 'description', 'unit']) if (l[k] !== undefined && l[k] !== null && (k !== 'name' || str(l[k]))) o[k] = str(l[k]);
  for (const k of ['qty', 'unit_price', 'unit_cost']) if (l[k] !== undefined && l[k] !== null && l[k] !== '') o[k] = num(l[k]);
  if (l.taxable !== undefined && l.taxable !== null) o.taxable = l.taxable ? 1 : 0;
  if (!str(o.name)) bad('Each line item needs a name or a pricebook_id.');
  if (!KINDS.includes(o.kind)) o.kind = 'service';
  o.qty = round2(o.qty); o.unit_price = round2(o.unit_price); o.unit_cost = round2(o.unit_cost);
  return { ...o, source_type: str(l.source_type), source_id: l.source_id || null };
}
function getLines(type, id) {
  return all('SELECT * FROM line_items WHERE parent_type=:t AND parent_id=:id ORDER BY sort, id', { t: type, id })
    .map(l => ({ ...l, total: round2(l.qty * l.unit_price) }));
}
function addLines(type, id, lines) {
  const start = (get('SELECT MAX(sort) m FROM line_items WHERE parent_type=:t AND parent_id=:id', { t: type, id })?.m ?? -1) + 1;
  const t = now();
  lines.map(normalizeLine).forEach((l, j) => insert('line_items', {
    parent_type: type, parent_id: id, pricebook_id: l.pricebook_id || null, kind: l.kind, name: l.name, description: l.description, qty: l.qty, unit: l.unit,
    unit_price: l.unit_price, unit_cost: l.unit_cost, taxable: l.taxable, sort: start + j, source_type: l.source_type, source_id: l.source_id, created_at: t
  }));
}
function setLines(type, id, lines) {
  run('DELETE FROM line_items WHERE parent_type=:t AND parent_id=:id', { t: type, id });
  addLines(type, id, lines || []);
}
// subtotal - discount + tax. Discount is spread across lines proportionally so tax applies only to the taxable share.
function totals(lines, { discount = 0, tax_rate = 0, tax_exempt = false } = {}) {
  const subtotal = round2(lines.reduce((s, l) => s + round2(l.qty * l.unit_price), 0));
  const disc = Math.min(Math.max(round2(discount), 0), Math.max(subtotal, 0));
  const taxableBase = lines.filter(l => l.taxable).reduce((s, l) => s + round2(l.qty * l.unit_price), 0);
  const share = subtotal > 0 ? taxableBase / subtotal : 0;
  const tax = tax_exempt ? 0 : round2((taxableBase - disc * share) * (num(tax_rate) / 100));
  const cost = round2(lines.reduce((s, l) => s + round2(l.qty * l.unit_cost), 0));
  return { subtotal, discount: disc, tax, total: round2(subtotal - disc + tax), cost };
}

module.exports = { LINE, LINES, KINDS, normalizeLine, getLines, addLines, setLines, totals };
