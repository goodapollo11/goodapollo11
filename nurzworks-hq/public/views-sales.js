/* NurzWorks HQ - customers (CRM), estimates, invoices, payments, price book */
'use strict';

// ======================= line item editor (estimates, invoices, job items) =======================
function linesEditor(el, lines, pricebook, { totals = true, tax_rate = 0, discount = 0, tax_exempt = false, showCost = can('office') } = {}) {
  const listId = 'pb' + Math.random().toString(36).slice(2, 8);
  let rows = lines.map(l => ({ ...l }));
  const st = { tax_rate: Number(tax_rate) || 0, discount: Number(discount) || 0 };
  const money = v => fmt.money(v);
  function calc() {
    const sub = rows.reduce((s, l) => s + Math.round((+l.qty || 0) * (+l.unit_price || 0) * 100) / 100, 0);
    const disc = Math.min(Math.max(st.discount, 0), Math.max(sub, 0));
    const taxable = rows.filter(l => l.taxable).reduce((s, l) => s + (+l.qty || 0) * (+l.unit_price || 0), 0);
    const tax = tax_exempt ? 0 : Math.round((taxable - disc * (sub ? taxable / sub : 0)) * st.tax_rate) / 100;
    const cost = rows.reduce((s, l) => s + (+l.qty || 0) * (+l.unit_cost || 0), 0);
    return { sub, disc, tax, total: sub - disc + tax, cost };
  }
  function draw() {
    el.innerHTML = `<datalist id="${listId}">${pricebook.filter(p => p.active).map(p => `<option value="${e(p.name)}">${e(p.code)} · ${fmt.money(p.price)}/${e(p.unit)}</option>`).join('')}</datalist>
      <div class="tbl-wrap"><table class="lines-tbl"><thead><tr><th>Item</th><th style="width:80px" class="num">Qty</th><th style="width:110px" class="num">Price</th>${showCost ? '<th style="width:96px" class="num">Cost</th>' : ''}<th style="width:46px">Tax</th><th style="width:100px" class="num">Total</th><th style="width:36px"></th></tr></thead>
      <tbody>${rows.map((l, i) => `<tr data-i="${i}"><td><input list="${listId}" data-f="name" value="${e(l.name)}" placeholder="Pick from price book or type"><textarea data-f="description" placeholder="Description (optional)" rows="1">${e(l.description || '')}</textarea></td>
        <td class="num"><input type="number" step="any" min="0" data-f="qty" value="${l.qty ?? 1}"></td><td class="num"><input type="number" step="0.01" data-f="unit_price" value="${l.unit_price ?? 0}"></td>
        ${showCost ? `<td class="num"><input type="number" step="0.01" min="0" data-f="unit_cost" value="${l.unit_cost ?? 0}" title="Your cost per unit"></td>` : ''}
        <td style="text-align:center"><input type="checkbox" data-f="taxable" ${l.taxable ? 'checked' : ''} style="width:18px;height:18px;margin-top:7px"></td>
        <td class="num" style="padding-top:11px;font-weight:600">${money((+l.qty || 0) * (+l.unit_price || 0))}</td><td><button type="button" class="icon-btn" data-rm="${i}" title="Remove">${icon('x')}</button></td></tr>`).join('')}</tbody></table></div>
      <div class="row mt-s"><button type="button" class="btn sm" id="${listId}add">${icon('plus')}Add line</button>${!rows.length ? '<span class="muted small">Add services, labor, materials or fees. Start typing to pick from the price book.</span>' : ''}</div>
      ${totals ? `<div class="lines-tot"><span>Subtotal <b>${money(calc().sub)}</b></span><label>Discount $<input type="number" step="0.01" min="0" class="inp" id="${listId}disc" value="${st.discount || ''}" style="width:90px;height:30px;display:inline-block"></label>
        <label>Tax %<input type="number" step="0.001" min="0" class="inp" id="${listId}tax" value="${st.tax_rate}" style="width:80px;height:30px;display:inline-block"></label><span>Tax <b>${money(calc().tax)}</b></span><span>Total <b>${money(calc().total)}</b></span>${showCost ? `<span class="muted">Margin ${money(calc().sub - calc().disc - calc().cost)}</span>` : ''}</div>` : ''}`;
    $$('tbody tr', el).forEach(tr => {
      const i = +tr.dataset.i;
      $$('[data-f]', tr).forEach(inp => inp.addEventListener('change', () => {
        const f = inp.dataset.f; const l = rows[i];
        if (f === 'taxable') l.taxable = inp.checked; else l[f] = ['qty', 'unit_price', 'unit_cost'].includes(f) ? Number(inp.value) : inp.value;
        if (f === 'name') { const p = pricebook.find(x => x.name === inp.value); if (p) Object.assign(l, { pricebook_id: p.id, unit_price: p.price, unit_cost: p.cost, unit: p.unit, kind: p.kind, taxable: !!p.taxable, description: l.description || p.description }); else l.pricebook_id = null; }
        draw();
      }));
    });
    $$('[data-rm]', el).forEach(b => b.onclick = () => { rows.splice(+b.dataset.rm, 1); draw(); });
    $('#' + listId + 'add').onclick = () => { rows.push({ name: '', qty: 1, unit_price: 0, unit_cost: 0, taxable: false }); draw(); const ins = $$('input[data-f=name]', el); ins[ins.length - 1].focus(); };
    const d = $('#' + listId + 'disc'); if (d) d.onchange = () => { st.discount = Number(d.value) || 0; draw(); };
    const t = $('#' + listId + 'tax'); if (t) t.onchange = () => { st.tax_rate = Number(t.value) || 0; draw(); };
  }
  draw();
  return {
    get: () => rows.filter(l => String(l.name || '').trim()).map(l => ({ pricebook_id: l.pricebook_id || null, kind: l.kind, name: l.name, description: l.description || '', qty: +l.qty || 0, unit: l.unit || '', unit_price: +l.unit_price || 0, unit_cost: +l.unit_cost || 0, taxable: !!l.taxable, source_type: l.source_type, source_id: l.source_id })),
    meta: () => ({ ...st })
  };
}

// document layout shared by estimates and invoices (also used for printing)
function docHtml(kind, d) {
  const co = S.meta.company;
  const items = d.items.map(l => `<tr><td><b>${e(l.name)}</b>${l.description ? `<div class="muted small" style="white-space:pre-wrap">${e(l.description)}</div>` : ''}</td><td class="num">${fmt.num(l.qty, 2)}${l.unit ? ' ' + e(l.unit) : ''}</td><td class="num">${fmt.money(l.unit_price)}</td><td class="num">${fmt.money(l.total)}</td></tr>`).join('');
  return `<div class="doc"><div class="doc-head"><div><div class="co">${e(co.name)}</div><div class="muted small" style="white-space:pre-wrap">${e([co.address, co.phone, co.email, co.website].filter(Boolean).join('\n'))}</div></div>
    <div class="ttl"><div class="k-label">${kind === 'estimate' ? 'Estimate' : 'Invoice'}</div><div class="n">${e(d.number)}</div><div class="small muted">${kind === 'estimate' ? `Issued ${fmt.date(d.issue_date)}${d.expiry_date ? ` · valid until ${fmt.date(d.expiry_date)}` : ''}` : `Issued ${fmt.date(d.issue_date)} · due ${fmt.date(d.due_date)}`}</div>${d.customer_po ? `<div class="small muted">PO ${e(d.customer_po)}</div>` : ''}</div></div>
    <div class="doc-parties"><div><div class="k-label">${kind === 'estimate' ? 'Prepared for' : 'Bill to'}</div><b>${e(d.customer_name)}</b><div class="muted small">${e(d.billing_address || '')}</div></div>${d.address ? `<div><div class="k-label">Service address</div>${e(d.address)}</div>` : ''}</div>
    ${d.title ? `<div style="font-weight:650;margin-bottom:8px">${e(d.title)}</div>` : ''}
    ${d.message ? `<div class="note" style="margin:0 0 14px">${e(d.message)}</div>` : ''}
    <div class="tbl-wrap"><table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${items || '<tr><td colspan="4" class="muted">No line items yet.</td></tr>'}</tbody></table></div>
    <div class="totals"><div class="cost-row"><span>Subtotal</span><span>${fmt.money(d.subtotal)}</span></div>${d.discount ? `<div class="cost-row"><span>Discount</span><span>-${fmt.money(d.discount)}</span></div>` : ''}${d.tax ? `<div class="cost-row"><span>Tax (${fmt.num(d.tax_rate, 3)}%)</span><span>${fmt.money(d.tax)}</span></div>` : ''}
      <div class="cost-row total"><span>Total</span><span>${fmt.money(d.total)}</span></div>${kind === 'invoice' && d.amount_paid ? `<div class="cost-row"><span>Paid</span><span>-${fmt.money(d.amount_paid)}</span></div><div class="cost-row total"><span>Balance due</span><span>${fmt.money(d.balance)}</span></div>` : ''}</div>
    ${d.terms ? `<div class="note"><b>Terms.</b> ${e(d.terms)}</div>` : ''}</div>`;
}
async function sendDialog(kind, d) {
  const gmail = S.meta.integrations.gmail && can('email');
  const to = d.customer_email || '';
  const verb = kind === 'estimate' ? 'Estimate' : 'Invoice';
  const subject = kind === 'estimate' ? `Estimate ${d.number} from ${S.meta.company.name}: ${d.title}` : `Invoice ${d.number} from ${S.meta.company.name} - ${fmt.money(d.balance)} due ${fmt.date(d.due_date)}`;
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${d.message || ''}\n\nView ${kind === 'estimate' ? 'and approve ' : ''}online: ${d.public_url}\n\n${S.meta.company.name}`)}`;
  const r = await modal({ title: `Send ${verb.toLowerCase()} ${d.number}`, body: `
    ${gmail ? '' : `<div class="callout info" style="margin-bottom:12px">${icon('mail')}<div>Gmail isn't connected${can('admin') ? ' (<a href="#/integrations" data-x>connect it</a>)' : ''}. Send the link from your own mail app, then mark it sent.</div></div>`}
    <form class="form" onsubmit="return false">
      <div class="field full"><label>To</label><input name="to" type="email" value="${e(to)}" ${gmail ? '' : 'readonly'}></div>
      ${gmail ? `<div class="field full"><label>Cc</label><input name="cc" placeholder="optional"></div><div class="field full"><label>Subject</label><input name="subject" value="${e(subject)}"></div>
      <div class="field full"><label>Message</label><textarea name="message" rows="5">${e(d.message || '')}</textarea><div class="hint">The email includes the total, due date and a button to view${kind === 'estimate' ? ' and approve' : ''} online.</div></div>` : ''}
      <div class="field full"><label>Customer link</label><div class="copy-box"><input readonly value="${e(d.public_url)}"><button type="button" class="btn sm" id="cpLink">${icon('copy')}Copy</button></div></div>
    </form>`,
    foot: gmail ? `<button class="btn" data-x>Cancel</button><button class="btn" id="markSent">Mark as sent</button><button class="btn primary" id="sendNow">${icon('send')}Send via Gmail</button>`
      : `<button class="btn" data-x>Cancel</button><a class="btn" href="${mailto}">${icon('mail')}Open in mail app</a><button class="btn primary" id="markSent">Mark as sent</button>`,
    onMount: ctx => {
      $('#cpLink', ctx.el).onclick = () => copyText(d.public_url);
      const path = `/api/${kind}s/${d.id}/send`;
      $('#markSent', ctx.el).onclick = async () => { try { await POST(path, { method: 'mark_sent' }); ctx.close(true); } catch (err) { ctx.error(err.message); } };
      const sn = $('#sendNow', ctx.el); if (sn) sn.onclick = async () => { sn.disabled = true; try { await POST(path, { method: 'email', ...readForm(ctx.el) }); toast('Emailed'); ctx.close(true); } catch (err) { ctx.error(err.message); sn.disabled = false; } };
    }
  });
  if (r) { toast(`${verb} marked sent`); rerender(); }
}

// ======================= CUSTOMERS =======================
VIEWS.customers = async (view, r) => {
  if (r.id) return customerDetail(view, r.id, r.q);
  const q = r.q; const tab = q.tab || 'all';
  const rows = await api('/api/customers' + qs({ q: q.q, status: tab === 'all' ? '' : tab, sort: q.sort || 'name', limit: 500 }));
  view.innerHTML = `
  <div class="page-head"><div><h1>Customers</h1><div class="sub">${rows.length} shown · ${fmt.money0(rows.reduce((s, c) => s + c.balance, 0))} owed</div></div>
    <div class="actions">${can('books') ? `<a class="btn" href="/api/export/customers.csv">${icon('download')}CSV</a>` : ''}${can('office') ? `<button class="btn primary" id="cNew">${icon('plus')}New customer</button>` : ''}</div></div>
  <div class="card"><div class="tabs">${[['all', 'All'], ['active', 'Active'], ['lead', 'Leads'], ['inactive', 'Inactive']].map(([k, l]) => `<a data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="filters"><input type="search" id="cq" placeholder="Name, phone, email, address, tag…" value="${e(q.q || '')}"><span class="spacer"></span>
      <select id="cSort">${opt([['name', 'A-Z'], ['recent', 'Recent activity'], ['balance', 'Balance owed'], ['created', 'Newest']], q.sort || 'name')}</select></div>
    <div id="cTbl">${table(rows, [
      { label: 'Customer', cls: 'title-cell', render: c => `<div>${e(c.name)} ${c.status === 'lead' ? pill('customer', 'lead') : c.status === 'inactive' ? pill('customer', 'inactive') : ''}</div><div class="sub">${e(c.number)}${c.company && c.company !== c.name ? ' · ' + e(c.company) : ''}${c.tags ? ' · ' + e(c.tags) : ''}</div>` },
      { label: 'Contact', render: c => `<div>${e(c.phone || '—')}</div><div class="sub">${e(c.email || '')}</div>` },
      { label: 'Address', hideM: 1, render: c => `<span class="muted">${e(c.address || '—')}</span>` },
      { label: 'Open jobs', num: 1, hideM: 1, render: c => c.open_jobs || '<span class="muted">0</span>' },
      { label: 'Balance', num: 1, render: c => c.balance ? `<b>${fmt.money0(c.balance)}</b>` : '<span class="muted">—</span>' },
      { label: 'Last activity', hideM: 1, render: c => `<span class="muted nowrap">${fmt.rel(c.last_activity || c.updated_at)}</span>` }
    ], { onRow: 1, empty: 'No customers match.', emptyIcon: 'users' })}</div></div>`;
  const setQ = patch => { const nq = { ...q, ...patch }; Object.keys(nq).forEach(k => !nq[k] && delete nq[k]); location.hash = '#/customers' + qs(nq); };
  $$('[data-tab]', view).forEach(a => a.onclick = () => setQ({ tab: a.dataset.tab === 'all' ? '' : a.dataset.tab }));
  let st; $('#cq').oninput = ev => { clearTimeout(st); st = setTimeout(() => setQ({ q: ev.target.value }), 350); };
  $('#cSort').onchange = ev => setQ({ sort: ev.target.value });
  bindTable($('#cTbl'), rows, { onRow: c => (location.hash = '#/customers/' + c.id) });
  const cn = $('#cNew'); if (cn) cn.onclick = () => customerForm();
};
async function customerForm(c = null) {
  const res = await formModal({
    title: c ? `Edit ${c.name}` : 'New customer', size: 'wide', okLabel: c ? 'Save' : 'Create customer',
    fields: [
      { name: 'name', label: 'Name (person or business)', value: c && c.name, required: 1 }, { name: 'kind', label: 'Type', type: 'select', options: [['residential', 'Residential'], ['commercial', 'Commercial']], value: (c && c.kind) || 'commercial' },
      { name: 'company', label: 'Company', value: c && c.company }, { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active customer'], ['lead', 'Lead / prospect'], ['inactive', 'Inactive']], value: (c && c.status) || 'active' },
      { name: 'phone', label: 'Phone', type: 'tel', value: c && c.phone }, { name: 'email', label: 'Email', type: 'email', value: c && c.email },
      { name: 'alt_phone', label: 'Alt. phone', type: 'tel', value: c && c.alt_phone }, { name: 'source', label: 'Lead source', type: 'select', options: ['', 'referral', 'website', 'google', 'repeat', 'sign', 'social', 'other'].map(x => [x, x ? cap(x) : '—']), value: c && c.source },
      ...(c ? [] : [{ type: 'heading', label: 'Service address' }, { name: 'street', label: 'Street', full: 1 }, { name: 'city', label: 'City' }, { name: 'state', label: 'State', value: 'WI' }, { name: 'zip', label: 'ZIP' }, { name: 'access_notes', label: 'Access notes', placeholder: 'Gate code, parking, pets, who to ask for', full: 1 }]),
      { type: 'heading', label: 'Billing' },
      ...(c ? [{ name: 'billing_street', label: 'Billing street', value: c.billing_street, full: 1 }, { name: 'billing_city', label: 'City', value: c.billing_city }, { name: 'billing_state', label: 'State', value: c.billing_state }, { name: 'billing_zip', label: 'ZIP', value: c.billing_zip }] : []),
      { name: 'terms_days', label: 'Payment terms (days)', type: 'number', min: 0, value: c ? c.terms_days ?? '' : '', placeholder: `default ${S.meta.settings.default_terms_days}` }, { name: 'tax_exempt', label: 'Tax exempt', type: 'checkbox', value: c && c.tax_exempt },
      { name: 'tags', label: 'Tags (comma-separated)', value: c && c.tags, full: 1 }, { name: 'notes', label: 'Internal notes', type: 'textarea', rows: 2, value: c && c.notes, full: 1 }
    ],
    save: vals => {
      if (c) return PUT('/api/customers/' + c.id, vals);
      const { street, city, state, zip, access_notes, ...rest } = vals;
      return POST('/api/customers', { ...rest, address: street || city ? { street, city, state, zip, access_notes } : undefined, billing_state: state });
    }
  });
  if (res) {
    invalidateCustomers();
    if (res.possible_duplicates && res.possible_duplicates.length) toast(`Heads up: similar customer exists (${res.possible_duplicates[0].name})`, 'error'); else toast(c ? 'Customer saved' : 'Customer created');
    if (!c) location.hash = '#/customers/' + res.id; else rerender();
  }
}
async function customerDetail(view, id, q) {
  const c = await api('/api/customers/' + id);
  const tab = q.tab || 'overview'; const office = can('office'), books = can('books');
  const tabs = [['overview', 'Overview'], ['jobs', `Jobs`, c.jobs.length], ...(books ? [['estimates', 'Estimates', c.estimates.length], ['invoices', 'Invoices', c.invoices.length]] : []), ['plans', 'Plans', c.plans.length], ...(office ? [['email', 'Email', c.emails.length]] : []), ['activity', 'Activity']];
  const addr = l => l.address || [l.street, l.city].filter(Boolean).join(', ');
  const body = {
    overview: () => `<div class="grid g2"><div>
      <div class="card"><div class="card-h"><h2>Contact</h2></div><div class="card-b"><div class="dl two">
        <div><div class="k">Phone</div><div class="v">${c.phone ? `<a href="${telUrl(c.phone)}">${e(c.phone)}</a>` : '—'}${c.alt_phone ? `<br><a href="${telUrl(c.alt_phone)}">${e(c.alt_phone)}</a>` : ''}</div></div>
        <div><div class="k">Email</div><div class="v">${c.email ? `<a href="mailto:${e(c.email)}">${e(c.email)}</a>` : '—'}</div></div>
        <div><div class="k">Billing address</div><div class="v">${e([c.billing_street, c.billing_city, [c.billing_state, c.billing_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—')}</div></div>
        <div><div class="k">Terms</div><div class="v">${c.terms_days != null ? `Net ${c.terms_days}` : `Default (net ${e(S.meta.settings.default_terms_days)})`}${c.tax_exempt ? ' · tax exempt' : ''}</div></div>
        <div><div class="k">Source</div><div class="v">${e(c.source || '—')}</div></div><div><div class="k">Customer since</div><div class="v">${fmt.date(c.created_at)}</div></div>
      </div>${c.notes ? `<div class="mt"><div class="k-label">Notes</div><div class="desc">${e(c.notes)}</div></div>` : ''}</div></div>
      <div class="card mt"><div class="card-h"><h2>${icon('pin')} Service locations</h2>${office ? `<div class="right"><button class="btn sm" id="addLoc">${icon('plus')}Add</button></div>` : ''}</div><div class="card-b flush">${c.locations.length ? `<ul class="list">${c.locations.map(l => `<li><div class="grow"><div class="t">${e(l.name || 'Location')} ${l.is_primary ? '<span class="tag">primary</span>' : ''}</div><div class="s"><a href="${mapsUrl(addr(l))}" target="_blank" rel="noopener">${e(addr(l))}</a></div>${l.access_notes ? `<div class="s">${icon('key')} ${e(l.access_notes)}</div>` : ''}</div>${office ? `<button class="icon-btn" data-loc="${l.id}" title="Edit">${icon('edit')}</button>` : ''}</li>`).join('')}</ul>` : '<div class="empty">No service address yet.</div>'}</div></div>
      <div class="card mt"><div class="card-h"><h2>${icon('users')} People</h2>${office ? `<div class="right"><button class="btn sm" id="addContact">${icon('plus')}Add</button></div>` : ''}</div><div class="card-b flush">${c.contacts.length ? `<ul class="list">${c.contacts.map(k => `<li><div class="grow"><div class="t">${e(k.name)} ${k.is_primary ? '<span class="tag">primary</span>' : ''}</div><div class="s">${e(k.role)}${k.phone ? ` · <a href="${telUrl(k.phone)}">${e(k.phone)}</a>` : ''}${k.email ? ` · <a href="mailto:${e(k.email)}">${e(k.email)}</a>` : ''}</div></div>${office ? `<button class="icon-btn" data-contact="${k.id}" title="Edit">${icon('edit')}</button>` : ''}</li>`).join('')}</ul>` : '<div class="empty">No other contacts.</div>'}</div></div>
    </div><div>
      ${books ? `<div class="card"><div class="card-h"><h2>${icon('dollar')} Account</h2></div><div class="card-b">
        <div class="cost-row"><span>Balance owed</span><b style="color:${c.balance ? 'var(--crit-ink)' : 'inherit'}">${fmt.money(c.balance)}</b></div><div class="cost-row"><span>Lifetime invoiced</span><span>${fmt.money(c.stats.lifetime_invoiced)}</span></div>
        <div class="cost-row"><span>Lifetime paid</span><span>${fmt.money(c.stats.lifetime_paid)}</span></div><div class="cost-row"><span>Jobs</span><span>${c.stats.jobs_done} done / ${c.stats.job_count} total</span></div></div></div>` : ''}
      <div class="card ${books ? 'mt' : ''}"><div class="card-h"><h2>${icon('wo')} Open work</h2></div><div class="card-b flush">${(() => { const open = c.jobs.filter(j => !['completed', 'invoiced', 'cancelled'].includes(j.status)); return open.length ? `<ul class="list">${open.map(j => `<li class="click" data-href="#/jobs/${j.id}"><div class="grow"><div class="t">${e(j.title)}</div><div class="s">${e(j.number)}${j.next_visit ? ' · next visit ' + fmt.dt(j.next_visit) : ''}</div></div>${pill('job', j.status)}</li>`).join('')}</ul>` : '<div class="empty">No open jobs.</div>'; })()}</div></div>
      <div class="card mt"><div class="card-h"><h2>${icon('task')} Open tasks</h2><div class="right"><button class="btn sm" id="cTask">${icon('plus')}Task</button></div></div><div class="card-b flush">${c.tasks.length ? `<ul class="list">${c.tasks.map(t => `<li class="click" data-href="#/tasks?id=${t.id}"><div class="grow"><div class="t">${e(t.title)}</div><div class="s">${e(t.assignee || 'Unassigned')}${t.due_date ? ' · due ' + fmt.dueIn(t.due_date) : ''}</div></div></li>`).join('')}</ul>` : '<div class="empty">No open tasks.</div>'}</div></div>
      <div class="card mt"><div class="card-h"><h2>Recent activity</h2><a class="right small" href="#/customers/${c.id}?tab=activity">All</a></div><div class="card-b">${timeline(c.activity.slice(0, 6), { showRef: true })}</div></div>
    </div></div>`,
    jobs: () => `<div class="card">${table(c.jobs, [{ label: 'Job', render: j => `<span class="code">${e(j.number)}</span>` }, { label: 'Title', cls: 'title-cell', render: j => e(j.title) }, { label: 'Type', hideM: 1, render: j => `<span class="tag">${e(j.type)}</span>` }, { label: 'Status', render: j => pill('job', j.status) }, { label: 'Next visit', hideM: 1, render: j => j.next_visit ? fmt.dt(j.next_visit) : '—' }, { label: 'Created', hideM: 1, render: j => fmt.date(j.created_at) }], { onRow: 1, empty: 'No jobs yet.' })}</div>`,
    estimates: () => `<div class="card">${table(c.estimates, [{ label: 'Estimate', render: x => `<span class="code">${e(x.number)}</span>` }, { label: 'Title', cls: 'title-cell', render: x => e(x.title) }, { label: 'Status', render: x => pill('estimate', x.status) }, { label: 'Issued', hideM: 1, render: x => fmt.date(x.issue_date) }, { label: 'Total', num: 1, render: x => fmt.money(x.total) }], { onRow: 1, empty: 'No estimates yet.' })}</div>`,
    invoices: () => `<div class="card">${table(c.invoices, [{ label: 'Invoice', render: x => `<span class="code">${e(x.number)}</span>` }, { label: 'Title', cls: 'title-cell', render: x => e(x.title || '—') }, { label: 'Status', render: x => pill('invoice', x.status) }, { label: 'Due', hideM: 1, render: x => fmt.date(x.due_date) }, { label: 'Total', num: 1, render: x => fmt.money(x.total) }, { label: 'Balance', num: 1, render: x => x.balance ? `<b>${fmt.money(x.balance)}</b>` : '—' }], { onRow: 1, empty: 'No invoices yet.' })}</div>`,
    plans: () => `<div class="card">${table(c.plans, [{ label: 'Plan', render: p => `<span class="code">${e(p.number)}</span>` }, { label: 'Name', cls: 'title-cell', render: p => e(p.name) }, { label: 'Every', render: p => `${p.interval_value} ${p.interval_unit}${p.interval_value > 1 ? 's' : ''}` }, { label: 'Next due', render: p => fmt.date(p.next_due) }, { label: 'Price', num: 1, render: p => fmt.money0(p.price) }, { label: 'Status', render: p => pill('plan', p.status) }], { onRow: 1, empty: 'No service plans. Set up recurring maintenance from Service Plans.' })}</div>`,
    email: () => `<div class="card"><div class="card-h"><h2>${icon('mail')} Email</h2>${S.meta.integrations.gmail ? `<div class="right"><button class="btn sm" id="loadMail">${icon('refresh')}Load all mail with this customer</button>${can('email') || can('office') ? `<button class="btn sm primary" id="cCompose">${icon('send')}New email</button>` : ''}</div>` : ''}</div>
      <div class="card-b flush" id="cMail">${c.emails.length ? `<ul class="list">${c.emails.map(t => `<li class="click" data-href="#/inbox?thread=${e(t.thread_id)}"><div class="grow"><div class="t">${e(t.subject)}</div><div class="s">${e(t.from_name || t.from_email)} · ${e(t.snippet)}</div></div><span class="small muted nowrap">${fmt.rel(t.last_date)}</span></li>`).join('')}</ul>` : `<div class="empty">${S.meta.integrations.gmail ? 'No linked email yet. Load mail to find conversations with this customer.' : 'Connect Gmail under Integrations to see email with this customer here.'}</div>`}</div></div>`,
    activity: () => `<div class="card"><div class="card-h"><h2>Activity</h2><div class="right"><button class="btn sm" id="cNote2">${icon('pen')}Add note</button></div></div><div class="card-b">${timeline(c.activity, { showRef: true })}</div></div>`
  };
  view.innerHTML = `
  <div class="crumb"><a href="#/customers">Customers</a> / ${e(c.number)}</div>
  <div class="detail-head"><div><h1>${e(c.name)}</h1><div class="meta">${pill('customer', c.status)}<span class="tag">${e(c.kind)}</span>${c.company && c.company !== c.name ? `<span class="muted">${e(c.company)}</span>` : ''}${(c.tags || '').split(',').filter(Boolean).map(t => `<span class="tag">${e(t.trim())}</span>`).join('')}</div></div>
    <div class="actions">${office ? `<button class="btn primary" id="cJob">${icon('wo')}New job</button><button class="btn" id="cEst">${icon('est')}Estimate</button><button class="btn" id="cInv">${icon('inv')}Invoice</button>` : ''}<button class="btn" id="cNote">${icon('pen')}Note</button>${office ? `<button class="btn" id="cPortal" title="Link where the customer sees their estimates, invoices and visits">${icon('link')}Portal link</button><button class="btn" id="cEdit">${icon('edit')}Edit</button>` : ''}
      ${can('admin') ? `<button class="btn danger" id="cDel" title="Delete">${icon('trash')}</button>` : ''}</div></div>
  <div class="card" style="margin-bottom:16px;border-radius:var(--radius)"><div class="tabs" style="border-bottom:none">${tabs.map(([k, l, n]) => `<a href="#/customers/${c.id}?tab=${k}" class="${tab === k ? 'on' : ''}">${l}${n ? ` <span class="count">${n}</span>` : ''}</a>`).join('')}</div></div>
  ${(body[tab] || body.overview)()}`;
  const nav = { jobs: x => '#/jobs/' + x.id, estimates: x => '#/estimates/' + x.id, invoices: x => '#/invoices/' + x.id, plans: x => '#/plans?id=' + x.id };
  if (nav[tab]) $$('tbody tr', view).forEach(tr => tr.onclick = () => (location.hash = nav[tab](c[tab][+tr.dataset.i])));
  const b = id2 => $('#' + id2);
  if (b('cJob')) b('cJob').onclick = () => jobForm(null, { customer_id: c.id });
  if (b('cEst')) b('cEst').onclick = () => estimateEditor(null, { customer_id: c.id });
  if (b('cInv')) b('cInv').onclick = () => invoiceEditor(null, { customer_id: c.id });
  b('cNote').onclick = () => noteDialog('customer', c.id);
  if (b('cNote2')) b('cNote2').onclick = () => noteDialog('customer', c.id);
  if (b('cEdit')) b('cEdit').onclick = () => customerForm(c);
  if (b('cPortal')) b('cPortal').onclick = () => copyText(c.portal_url);
  if (b('cTask')) b('cTask').onclick = () => taskForm({ related_type: 'customer', related_id: c.id });
  if (b('cDel')) b('cDel').onclick = async () => { if (await confirmBox('Delete customer', `Permanently delete <b>${e(c.name)}</b> and ALL their jobs, estimates, invoices and history? Consider marking them inactive instead.`, 'Delete forever', true)) { await DEL('/api/customers/' + c.id); invalidateCustomers(); toast('Customer deleted'); location.hash = '#/customers'; } };
  if (b('addLoc')) b('addLoc').onclick = () => locationForm(c.id);
  $$('[data-loc]', view).forEach(x => x.onclick = () => locationForm(c.id, c.locations.find(l => l.id === +x.dataset.loc)));
  if (b('addContact')) b('addContact').onclick = () => contactForm(c.id);
  $$('[data-contact]', view).forEach(x => x.onclick = () => contactForm(c.id, c.contacts.find(k => k.id === +x.dataset.contact)));
  if (b('loadMail')) b('loadMail').onclick = async () => {
    b('loadMail').disabled = true;
    try { const r = await api('/api/email/threads' + qs({ customer_id: c.id, max: 30 })); $('#cMail').innerHTML = r.threads.length ? `<ul class="list">${r.threads.map(t => `<li class="click" data-href="#/inbox?thread=${e(t.thread_id)}"><div class="grow"><div class="t">${e(t.subject)}</div><div class="s">${e(t.from_name || t.from_email)} · ${e(t.snippet)}</div></div><span class="small muted nowrap">${fmt.rel(t.last_date)}</span></li>`).join('')}</ul>` : `<div class="empty">${e(r.note || 'No email found with this customer.')}</div>`; }
    catch (err) { toast(err.message, 'error'); }
    b('loadMail').disabled = false;
  };
  if (b('cCompose')) b('cCompose').onclick = () => composeEmail({ to: c.email, customer_id: c.id });
}
async function locationForm(customerId, l = null) {
  const r = await formModal({ title: l ? 'Edit location' : 'Add service location', okLabel: 'Save',
    extraFoot: l && can('office') ? `<button class="btn danger left" id="locDel">${icon('trash')}Delete</button>` : '',
    fields: [{ name: 'name', label: 'Label', value: l && l.name, placeholder: 'Main plant, Home, Building B' }, { name: 'is_primary', label: 'Primary location', type: 'checkbox', value: l && l.is_primary },
      { name: 'street', label: 'Street', value: l && l.street, full: 1 }, { name: 'city', label: 'City', value: l && l.city }, { name: 'state', label: 'State', value: (l && l.state) || 'WI' }, { name: 'zip', label: 'ZIP', value: l && l.zip },
      { name: 'access_notes', label: 'Access notes', type: 'textarea', rows: 2, value: l && l.access_notes, full: 1, placeholder: 'Gate codes, parking, pets, safety gear, who to ask for' }],
    onMount: ctx => { const d = $('#locDel', ctx.el); if (d) d.onclick = async () => { await DEL('/api/locations/' + l.id); ctx.close(true); }; },
    save: v => l ? PUT('/api/locations/' + l.id, v) : POST(`/api/customers/${customerId}/locations`, v) });
  if (r) { invalidateCustomers(); toast('Saved'); rerender(); }
}
async function contactForm(customerId, k = null) {
  const r = await formModal({ title: k ? `Edit ${k.name}` : 'Add contact person', okLabel: 'Save',
    extraFoot: k ? `<button class="btn danger left" id="kDel">${icon('trash')}Delete</button>` : '',
    fields: [{ name: 'name', label: 'Name', value: k && k.name, required: 1 }, { name: 'role', label: 'Role / title', value: k && k.role }, { name: 'phone', label: 'Phone', type: 'tel', value: k && k.phone }, { name: 'email', label: 'Email', type: 'email', value: k && k.email },
      { name: 'is_primary', label: 'Primary contact', type: 'checkbox', value: k && k.is_primary }, { name: 'notes', label: 'Notes', value: k && k.notes, full: 1 }],
    onMount: ctx => { const d = $('#kDel', ctx.el); if (d) d.onclick = async () => { await DEL('/api/contacts/' + k.id); ctx.close(true); }; },
    save: v => k ? PUT('/api/contacts/' + k.id, v) : POST(`/api/customers/${customerId}/contacts`, v) });
  if (r) { toast('Saved'); rerender(); }
}

// ======================= ESTIMATES =======================
VIEWS.estimates = async (view, r) => {
  if (r.id) return estimateDetail(view, r.id);
  const tab = r.q.tab || 'open';
  const rows = await api('/api/estimates' + qs({ status: tab, q: r.q.q }));
  view.innerHTML = `
  <div class="page-head"><div><h1>Estimates</h1><div class="sub">${rows.length} shown · ${fmt.money0(rows.reduce((s, x) => s + x.total, 0))}</div></div>
    <div class="actions">${can('books') ? `<a class="btn" href="/api/export/estimates.csv">${icon('download')}CSV</a>` : ''}${can('office') ? `<button class="btn primary" id="eNew">${icon('plus')}New estimate</button>` : ''}</div></div>
  <div class="card"><div class="tabs">${[['open', 'Open'], ['draft', 'Draft'], ['sent', 'Awaiting answer'], ['converted', 'Won'], ['declined', 'Declined'], ['expired', 'Expired'], ['all', 'All']].map(([k, l]) => `<a href="#/estimates?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="eTbl">${table(rows, [
      { label: 'Estimate', render: x => `<span class="code">${e(x.number)}</span>` }, { label: 'For', cls: 'title-cell', render: x => `<div>${e(x.title)}</div><div class="sub">${e(x.customer_name)}</div>` },
      { label: 'Status', render: x => pill('estimate', x.status) + (x.viewed_at && x.status === 'sent' ? ' <span class="tag">viewed</span>' : '') },
      { label: 'Issued', hideM: 1, render: x => fmt.date(x.issue_date) }, { label: 'Expires', hideM: 1, render: x => x.expiry_date ? fmt.date(x.expiry_date) : '—' }, { label: 'Total', num: 1, render: x => fmt.money(x.total) }
    ], { onRow: 1, empty: 'No estimates here.', emptyIcon: 'est' })}</div></div>`;
  bindTable($('#eTbl'), rows, { onRow: x => (location.hash = '#/estimates/' + x.id) });
  const en = $('#eNew'); if (en) en.onclick = () => estimateEditor();
};
async function estimateEditor(est = null, preset = {}) {
  const pb = await api('/api/pricebook');
  const custs = await customers();
  let editor; const cid = est ? est.customer_id : preset.customer_id;
  const locsFor = id => ((custs.find(x => x.id === Number(id)) || { locations: [] }).locations);
  const r = await modal({
    title: est ? `Edit ${est.number}` : 'New estimate', size: 'wide',
    body: `<form class="form g3f" onsubmit="return false">
      ${est ? `<div class="field full"><label>Customer</label><input class="inp" value="${e(est.customer_name)}" readonly data-skip="1"></div>` : fieldHtml({ name: 'customer_id', label: 'Customer', type: 'customer', value: cid, full: 1, required: 1 })}
      ${fieldHtml({ name: 'title', label: 'Title', value: est ? est.title : preset.title, full: 1, required: 1, placeholder: 'e.g. Conveyor VFD replacement' })}
      ${fieldHtml({ name: 'location_id', label: 'Service location', type: 'select', options: locsFor(cid).map(l => [l.id, `${l.name ? l.name + ' - ' : ''}${l.address}`]), value: est && est.location_id, blank: 'Primary address' })}
      ${fieldHtml({ name: 'issue_date', label: 'Issue date', type: 'date', value: est ? est.issue_date : todayStr() })}
      ${fieldHtml({ name: 'expiry_date', label: 'Valid until', type: 'date', value: est ? est.expiry_date : addDays(todayStr(), Number(S.meta.settings.estimate_valid_days || 30)) })}
      <div class="field full"><label>Line items</label><div id="eLines"></div></div>
      ${fieldHtml({ name: 'message', label: 'Message to customer', type: 'textarea', rows: 2, value: est ? est.message : undefined, full: 1, placeholder: 'Default estimate message from Settings' })}
      ${fieldHtml({ name: 'terms', label: 'Terms', type: 'textarea', rows: 2, value: est ? est.terms : undefined, full: 1, placeholder: 'Default terms from Settings' })}
      ${fieldHtml({ name: 'internal_notes', label: 'Internal notes (private)', type: 'textarea', rows: 2, value: est ? est.internal_notes : '', full: 1 })}</form>`,
    foot: `<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${est ? 'Save estimate' : 'Create estimate'}</button>`,
    onMount: ctx => {
      bindCustomerPickers(ctx.el);
      editor = linesEditor($('#eLines', ctx.el), est ? est.items : [], pb, { tax_rate: est ? est.tax_rate : S.meta.settings.tax_rate, discount: est ? est.discount : 0 });
      const hid = $('input[name=customer_id]', ctx.el);
      if (hid) hid.addEventListener('change', () => { $('[name=location_id]', ctx.el).innerHTML = opt(locsFor(hid.value).map(l => [l.id, `${l.name ? l.name + ' - ' : ''}${l.address}`]), '', 'Primary address'); });
      $('[data-ok]', ctx.el).onclick = async () => {
        const v = readForm(ctx.el); const m = editor.meta();
        if (!est && !v.customer_id) return ctx.error('Choose a customer.');
        if (!String(v.title).trim()) return ctx.error('Title is required.');
        const body = { ...v, items: editor.get(), tax_rate: m.tax_rate, discount: m.discount };
        if (!est) { if (!body.message) delete body.message; if (!body.terms) delete body.terms; }
        try { const res = est ? await PUT('/api/estimates/' + est.id, body) : await POST('/api/estimates', body); ctx.close(res); } catch (err) { ctx.error(err.message); }
      };
    }
  });
  if (r) { toast(est ? 'Estimate saved' : `${r.number} created`); if (!est) location.hash = '#/estimates/' + r.id; else rerender(); }
}
async function estimateDetail(view, id) {
  const x = await api('/api/estimates/' + id);
  const office = can('office'); const locked = ['approved', 'converted'].includes(x.status);
  view.innerHTML = `
  <div class="crumb"><a href="#/estimates">Estimates</a> / ${e(x.number)}</div>
  <div class="detail-head"><div><h1>${e(x.title)}</h1><div class="meta">${pill('estimate', x.status)}${x.viewed_at ? `<span class="tag">viewed ${fmt.rel(x.viewed_at)}</span>` : ''}<a href="#/customers/${x.customer_id}">${e(x.customer_name)}</a>${x.job_id ? `<a href="#/jobs/${x.job_id}">${icon('wo')} ${e(x.job_number)}</a>` : ''}</div></div>
    <div class="actions">${office && !locked ? `<button class="btn primary" id="xSend">${icon('send')}${x.status === 'draft' ? 'Send' : 'Resend'}</button><button class="btn" id="xEdit">${icon('edit')}Edit</button>` : ''}
      ${office && ['sent', 'draft', 'expired'].includes(x.status) ? `<button class="btn good" id="xApprove">${icon('check')}Mark approved</button><button class="btn" id="xDecline">${icon('ban')}Declined</button>` : ''}
      ${office && x.status === 'approved' ? `<button class="btn primary" id="xConvert">${icon('wo')}Create job</button>` : ''}${office && locked && x.status !== 'converted' ? `<button class="btn" id="xDraft">${icon('undo')}Back to draft</button>` : ''}
      <button class="btn" id="xLink">${icon('link')}Copy link</button><button class="btn" id="xPrint">${icon('print')}Print</button>${office ? `<button class="btn danger" id="xDel" title="Delete">${icon('trash')}</button>` : ''}</div></div>
  ${x.status === 'converted' || x.status === 'approved' ? `<div class="notice">${icon('check')}<span>Approved${x.approved_name ? ` by <b>${e(x.approved_name)}</b>` : ''} ${fmt.dt(x.approved_at)}${x.job_id ? ` · job <a href="#/jobs/${x.job_id}">${e(x.job_number)}</a>` : ''}</span></div>` : ''}
  ${x.status === 'declined' ? `<div class="notice warn">${icon('ban')}<span>Declined ${fmt.dt(x.declined_at)}${x.decline_reason ? `: ${e(x.decline_reason)}` : ''}</span></div>` : ''}
  <div class="grid g-main"><div>${docHtml('estimate', x)}</div>
  <div><div class="card"><div class="card-h"><h2>Summary</h2></div><div class="card-b">
    <div class="cost-row"><span>Total</span><b>${fmt.money(x.total)}</b></div><div class="cost-row"><span>Your cost</span><span>${fmt.money(x.cost)}</span></div><div class="cost-row"><span>Margin</span><span>${fmt.money(x.margin)}${x.total ? ` (${Math.round(100 * x.margin / Math.max(1, x.subtotal - x.discount))}%)` : ''}</span></div>
    ${x.internal_notes ? `<div class="mt"><div class="k-label">Internal notes</div><div class="desc">${e(x.internal_notes)}</div></div>` : ''}</div></div>
    <div class="card mt"><div class="card-h"><h2>History</h2></div><div class="card-b">${timeline(x.activity)}</div></div></div></div>`;
  const b = id2 => $('#' + id2);
  if (b('xSend')) b('xSend').onclick = () => sendDialog('estimate', x);
  if (b('xEdit')) b('xEdit').onclick = () => estimateEditor(x);
  if (b('xApprove')) b('xApprove').onclick = async () => { const r2 = await formModal({ title: 'Record approval', size: 'narrow', okLabel: 'Mark approved', fields: [{ name: 'approved_by', label: 'Approved by', value: x.customer_name, full: 1 }], save: v => POST(`/api/estimates/${x.id}/status`, { status: 'approved', approved_by: v.approved_by }) }); if (r2) { toast(r2.created_job_id ? 'Approved - job created' : 'Approved'); rerender(); } };
  if (b('xDecline')) b('xDecline').onclick = async () => { const r2 = await formModal({ title: 'Estimate declined', size: 'narrow', okLabel: 'Save', fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 2, full: 1 }], save: v => POST(`/api/estimates/${x.id}/status`, { status: 'declined', reason: v.reason }) }); if (r2) rerender(); };
  if (b('xConvert')) b('xConvert').onclick = async () => { const r2 = await POST(`/api/estimates/${x.id}/convert`); toast(`${r2.job.number} created`); location.hash = '#/jobs/' + r2.job.id; };
  if (b('xDraft')) b('xDraft').onclick = async () => { await POST(`/api/estimates/${x.id}/status`, { status: 'draft' }); rerender(); };
  b('xLink').onclick = () => copyText(x.public_url);
  b('xPrint').onclick = () => window.open(x.public_url + '?print=1', '_blank');
  if (b('xDel')) b('xDel').onclick = async () => { if (await confirmBox('Delete estimate', `Delete ${e(x.number)}?`, 'Delete', true)) { await DEL('/api/estimates/' + x.id); location.hash = '#/estimates'; } };
}

// ======================= INVOICES & PAYMENTS =======================
VIEWS.invoices = async (view, r) => {
  if (r.id) return invoiceDetail(view, r.id);
  const tab = r.q.tab || 'unpaid';
  const tabs = [['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['draft', 'Draft'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All'], ['payments', 'Payments']];
  if (tab === 'payments') {
    const rows = await api('/api/payments');
    view.innerHTML = `<div class="page-head"><div><h1>Payments</h1><div class="sub">${rows.length} payments · ${fmt.money(rows.reduce((s, p) => s + p.amount, 0))}</div></div><div class="actions"><a class="btn" href="/api/export/payments.csv">${icon('download')}CSV</a></div></div>
      <div class="card"><div class="tabs">${tabs.map(([k, l]) => `<a href="#/invoices?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div><div id="pTbl">${table(rows, [
        { label: 'Date', render: p => fmt.date(p.received_on) }, { label: 'Customer', cls: 'title-cell', render: p => e(p.customer_name) }, { label: 'Invoice', render: p => p.invoice_number ? `<span class="code">${e(p.invoice_number)}</span>` : '—' },
        { label: 'Method', render: p => `<span class="tag">${e(p.method)}</span>` }, { label: 'Reference', hideM: 1, render: p => e(p.reference || '—') }, { label: 'Amount', num: 1, render: p => `<b>${fmt.money(p.amount)}</b>` }
      ], { onRow: 1, empty: 'No payments yet.' })}</div></div>`;
    bindTable($('#pTbl'), rows, { onRow: p => p.invoice_id && (location.hash = '#/invoices/' + p.invoice_id) });
    return;
  }
  const rows = await api('/api/invoices' + qs({ status: tab, q: r.q.q }));
  view.innerHTML = `
  <div class="page-head"><div><h1>Invoices</h1><div class="sub">${rows.length} shown · ${fmt.money(rows.reduce((s, x) => s + x.balance, 0))} outstanding</div></div>
    <div class="actions"><a class="btn" href="/api/export/invoices.csv">${icon('download')}CSV</a>${can('office') ? `<button class="btn primary" id="iNew">${icon('plus')}New invoice</button>` : ''}</div></div>
  <div class="card"><div class="tabs">${tabs.map(([k, l]) => `<a href="#/invoices?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="iTbl">${table(rows, [
      { label: 'Invoice', render: x => `<span class="code">${e(x.number)}</span>` }, { label: 'Customer', cls: 'title-cell', render: x => `<div>${e(x.customer_name)}</div><div class="sub">${e(x.title || x.job_number || '')}</div>` },
      { label: 'Status', render: x => invStatus(x) }, { label: 'Issued', hideM: 1, render: x => fmt.date(x.issue_date) },
      { label: 'Due', render: x => x.is_overdue ? `<span class="overdue-flag">${icon('alert')}${fmt.date(x.due_date)}</span>` : fmt.date(x.due_date) },
      { label: 'Total', num: 1, hideM: 1, render: x => fmt.money(x.total) }, { label: 'Balance', num: 1, render: x => x.balance ? `<b>${fmt.money(x.balance)}</b>` : '<span class="muted">—</span>' }
    ], { onRow: 1, empty: 'No invoices here.', emptyIcon: 'inv' })}</div></div>`;
  bindTable($('#iTbl'), rows, { onRow: x => (location.hash = '#/invoices/' + x.id) });
  const n = $('#iNew'); if (n) n.onclick = () => invoiceEditor();
};
async function invoiceEditor(inv = null, preset = {}) {
  const pb = await api('/api/pricebook');
  let editor;
  const r = await modal({
    title: inv ? `Edit ${inv.number}` : 'New invoice', size: 'wide',
    body: `<form class="form g3f" onsubmit="return false">
      ${inv ? `<div class="field full"><label>Customer</label><input class="inp" value="${e(inv.customer_name)}" readonly data-skip="1"></div>` : fieldHtml({ name: 'customer_id', label: 'Customer', type: 'customer', value: preset.customer_id, full: 1, required: 1 })}
      ${fieldHtml({ name: 'title', label: 'Title', value: inv ? inv.title : '', full: 1, placeholder: 'What this invoice is for' })}
      ${fieldHtml({ name: 'issue_date', label: 'Issue date', type: 'date', value: inv ? inv.issue_date : todayStr() })}
      ${fieldHtml({ name: 'due_date', label: 'Due date', type: 'date', value: inv ? inv.due_date : addDays(todayStr(), Number(S.meta.settings.default_terms_days || 14)) })}
      ${fieldHtml({ name: 'customer_po', label: 'Customer PO #', value: inv ? inv.customer_po : '' })}
      <div class="field full"><label>Line items</label><div id="iLines"></div></div>
      ${fieldHtml({ name: 'message', label: 'Message to customer', type: 'textarea', rows: 2, value: inv ? inv.message : undefined, full: 1, placeholder: 'Default invoice message from Settings' })}
      ${fieldHtml({ name: 'terms', label: 'Terms', type: 'textarea', rows: 2, value: inv ? inv.terms : undefined, full: 1, placeholder: 'Default terms from Settings' })}
      ${fieldHtml({ name: 'internal_notes', label: 'Internal notes (private)', type: 'textarea', rows: 2, value: inv ? inv.internal_notes : '', full: 1 })}</form>`,
    foot: `<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${inv ? 'Save invoice' : 'Create invoice'}</button>`,
    onMount: ctx => {
      bindCustomerPickers(ctx.el);
      editor = linesEditor($('#iLines', ctx.el), inv ? inv.items : [], pb, { tax_rate: inv ? inv.tax_rate : S.meta.settings.tax_rate, discount: inv ? inv.discount : 0 });
      $('[data-ok]', ctx.el).onclick = async () => {
        const v = readForm(ctx.el); const m = editor.meta();
        if (!inv && !v.customer_id) return ctx.error('Choose a customer.');
        const body = { ...v, items: editor.get(), tax_rate: m.tax_rate, discount: m.discount };
        if (!inv) { if (!body.message) delete body.message; if (!body.terms) delete body.terms; }
        try { const res = inv ? await PUT('/api/invoices/' + inv.id, body) : await POST('/api/invoices', body); ctx.close(res); } catch (err) { ctx.error(err.message); }
      };
    }
  });
  if (r) { toast(inv ? 'Invoice saved' : `${r.number} created`); if (!inv) location.hash = '#/invoices/' + r.id; else rerender(); }
}
async function invoiceDetail(view, id) {
  const x = await api('/api/invoices/' + id);
  const office = can('office'); const open = ['sent', 'viewed', 'partial'].includes(x.status);
  view.innerHTML = `
  <div class="crumb"><a href="#/invoices">Invoices</a> / ${e(x.number)}</div>
  <div class="detail-head"><div><h1>${e(x.number)} · ${e(x.customer_name)}</h1><div class="meta">${invStatus(x)}${x.is_overdue ? `<span class="overdue-flag">${x.days_overdue} days overdue</span>` : ''}${x.viewed_at ? `<span class="tag">viewed ${fmt.rel(x.viewed_at)}</span>` : ''}${x.reminder_count ? `<span class="tag">${x.reminder_count} reminder${x.reminder_count > 1 ? 's' : ''}</span>` : ''}
    <a href="#/customers/${x.customer_id}">${e(x.customer_name)}</a>${x.job_id ? `<a href="#/jobs/${x.job_id}">${icon('wo')} ${e(x.job_number)}</a>` : ''}</div></div>
    <div class="actions">${office && x.status !== 'void' && x.status !== 'paid' ? `<button class="btn ${x.status === 'draft' ? 'primary' : ''}" id="iSend">${icon('send')}${x.status === 'draft' ? 'Send' : 'Resend'}</button>` : ''}
      ${office && x.status !== 'void' && x.balance > 0 ? `<button class="btn ${x.status !== 'draft' ? 'primary' : ''}" id="iPay">${icon('dollar')}Record payment</button>` : ''}
      ${office && open && S.meta.integrations.gmail && can('email') ? `<button class="btn" id="iRemind">${icon('mail')}Reminder</button>` : ''}
      ${office && !['paid', 'void'].includes(x.status) ? `<button class="btn" id="iEdit">${icon('edit')}Edit</button>` : ''}<button class="btn" id="iLink">${icon('link')}Copy link</button><button class="btn" id="iPrint">${icon('print')}Print</button>
      ${office && x.status !== 'void' && !x.payments.length && x.status !== 'draft' ? `<button class="btn danger" id="iVoid">${icon('ban')}Void</button>` : ''}${can('admin') && x.status === 'draft' ? `<button class="btn danger" id="iDel">${icon('trash')}</button>` : ''}</div></div>
  ${x.status === 'paid' ? `<div class="notice">${icon('check')}<span>Paid in full ${x.paid_at ? fmt.date(x.paid_at) : ''}.</span></div>` : ''}
  <div class="grid g-main"><div>${docHtml('invoice', x)}</div>
  <div><div class="card"><div class="card-h"><h2>${icon('dollar')} Payments</h2></div><div class="card-b">
      <div class="cost-row"><span>Total</span><span>${fmt.money(x.total)}</span></div><div class="cost-row"><span>Paid</span><span>${fmt.money(x.amount_paid)}</span></div><div class="cost-row total"><span>Balance</span><span>${fmt.money(x.balance)}</span></div>
      ${x.payments.length ? `<ul class="list" style="margin:8px -16px -14px">${x.payments.map(p => `<li><div class="grow"><div class="t">${fmt.money(p.amount)} · ${e(p.method)}</div><div class="s">${fmt.date(p.received_on)}${p.reference ? ' · #' + e(p.reference) : ''}${p.notes ? ' · ' + e(p.notes) : ''}</div></div>${can('admin') ? `<button class="icon-btn" data-delpay="${p.id}" title="Delete">${icon('trash')}</button>` : ''}</li>`).join('')}</ul>` : ''}</div></div>
    ${x.internal_notes ? `<div class="card mt"><div class="card-b"><div class="k-label">Internal notes</div><div class="desc">${e(x.internal_notes)}</div></div></div>` : ''}
    <div class="card mt"><div class="card-h"><h2>History</h2></div><div class="card-b">${timeline(x.activity)}</div></div></div></div>`;
  const b = id2 => $('#' + id2);
  if (b('iSend')) b('iSend').onclick = () => sendDialog('invoice', x);
  if (b('iPay')) b('iPay').onclick = () => paymentDialog(x);
  if (b('iRemind')) b('iRemind').onclick = async () => { if (await confirmBox('Send reminder', `Email a payment reminder for ${e(x.number)} (${fmt.money(x.balance)}) to ${e(x.customer_email || 'the customer')}?`, 'Send reminder')) { try { await POST(`/api/invoices/${x.id}/remind`); toast('Reminder sent'); rerender(); } catch (err) { toast(err.message, 'error'); } } };
  if (b('iEdit')) b('iEdit').onclick = () => invoiceEditor(x);
  b('iLink').onclick = () => copyText(x.public_url);
  b('iPrint').onclick = () => window.open(x.public_url + '?print=1', '_blank');
  if (b('iVoid')) b('iVoid').onclick = async () => { const r2 = await formModal({ title: `Void ${x.number}`, size: 'narrow', okLabel: 'Void invoice', fields: [{ name: 'reason', label: 'Reason', full: 1 }], save: v => POST(`/api/invoices/${x.id}/void`, v) }); if (r2) { toast('Invoice voided'); rerender(); } };
  if (b('iDel')) b('iDel').onclick = async () => { if (await confirmBox('Delete draft', `Delete draft ${e(x.number)}? Job work goes back to unbilled.`, 'Delete', true)) { await DEL('/api/invoices/' + x.id); location.hash = '#/invoices'; } };
  $$('[data-delpay]', view).forEach(d => d.onclick = async () => { if (await confirmBox('Delete payment', 'Delete this payment record?', 'Delete', true)) { await DEL('/api/payments/' + d.dataset.delpay); rerender(); } });
}
async function paymentDialog(x) {
  const r = await formModal({ title: `Record payment · ${x.number}`, size: 'narrow', okLabel: 'Record payment',
    fields: [{ name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, value: x.balance, required: 1 }, { name: 'method', label: 'Method', type: 'select', options: [['check', 'Check'], ['cash', 'Cash'], ['card', 'Card'], ['ach', 'ACH / bank transfer'], ['zelle', 'Zelle'], ['venmo', 'Venmo'], ['paypal', 'PayPal'], ['other', 'Other']], value: 'check' },
      { name: 'received_on', label: 'Received', type: 'date', value: todayStr() }, { name: 'reference', label: 'Check # / reference' }, { name: 'notes', label: 'Notes', full: 1 }],
    save: v => POST(`/api/invoices/${x.id}/payments`, v) });
  if (r) { toast(r.status === 'paid' ? 'Paid in full' : 'Payment recorded'); rerender(); }
}

// ======================= PRICE BOOK =======================
VIEWS.pricebook = async (view, r) => {
  const rows = await api('/api/pricebook' + qs({ q: r.q.q, include_inactive: 1 }));
  const cats = [...new Set(rows.map(p => p.category || 'Other'))];
  view.innerHTML = `
  <div class="page-head"><div><h1>Price book</h1><div class="sub">${rows.filter(p => p.active).length} active items · used on estimates, jobs and invoices (and by AI staff when quoting)</div></div>
    <div class="actions">${can('office') ? `<button class="btn primary" id="pbNew">${icon('plus')}New item</button>` : ''}</div></div>
  <div class="card"><div class="filters"><input type="search" id="pbq" placeholder="Search items…" value="${e(r.q.q || '')}"></div>
    ${cats.map(cat => `<div class="card-h" style="background:var(--card-3)"><h3>${e(cat)}</h3></div><div class="pb-tbl" data-cat="${e(cat)}">${table(rows.filter(p => (p.category || 'Other') === cat), [
      { label: 'Code', render: p => `<span class="code">${e(p.code || '—')}</span>` }, { label: 'Item', cls: 'title-cell', render: p => `<div>${e(p.name)} ${p.active ? '' : '<span class="tag">inactive</span>'}</div><div class="sub">${e(p.description)}</div>` },
      { label: 'Kind', hideM: 1, render: p => `<span class="tag">${e(p.kind)}</span>` }, { label: 'Unit', hideM: 1, render: p => e(p.unit) }, { label: 'Price', num: 1, render: p => fmt.money(p.price) },
      { label: 'Cost', num: 1, hideM: 1, render: p => fmt.money(p.cost) }, { label: 'Margin', num: 1, hideM: 1, render: p => p.price ? fmt.pct(100 * (p.price - p.cost) / p.price) : '—' }, { label: 'Tax', hideM: 1, render: p => p.taxable ? 'yes' : '' }
    ], { onRow: 1, compact: 1 })}</div>`).join('') || '<div class="empty">No items yet. Add your standard services, labor rates, materials and fees.</div>'}</div>`;
  $$('.pb-tbl', view).forEach(el => bindTable(el, rows.filter(p => (p.category || 'Other') === el.dataset.cat), { onRow: p => can('office') && pbForm(p) }));
  let st; $('#pbq').oninput = ev => { clearTimeout(st); st = setTimeout(() => { location.hash = '#/pricebook' + qs({ q: ev.target.value }); }, 350); };
  const n = $('#pbNew'); if (n) n.onclick = () => pbForm();
};
async function pbForm(p = null) {
  const r = await formModal({ title: p ? `Edit ${p.name}` : 'New price book item', okLabel: 'Save',
    extraFoot: p && can('office') ? `<button class="btn danger left" id="pbDel">${icon('trash')}Delete</button>` : '',
    fields: [{ name: 'name', label: 'Name', value: p && p.name, required: 1, full: 1 }, { name: 'code', label: 'Code / SKU', value: p && p.code }, { name: 'category', label: 'Category', value: p && p.category },
      { name: 'kind', label: 'Kind', type: 'select', options: [['service', 'Service'], ['labor', 'Labor'], ['material', 'Material'], ['fee', 'Fee'], ['discount', 'Discount']], value: (p && p.kind) || 'service' }, { name: 'unit', label: 'Unit', value: (p && p.unit) || 'ea' },
      { name: 'price', label: 'Price', type: 'number', step: '0.01', value: p ? p.price : '' }, { name: 'cost', label: 'Your cost', type: 'number', step: '0.01', value: p ? p.cost : '' },
      { name: 'taxable', label: 'Taxable', type: 'checkbox', value: p && p.taxable }, { name: 'active', label: 'Active', type: 'checkbox', value: p ? p.active : 1 },
      { name: 'description', label: 'Description (shown to customers)', type: 'textarea', rows: 2, value: p && p.description, full: 1 }],
    onMount: ctx => { const d = $('#pbDel', ctx.el); if (d) d.onclick = async () => { await DEL('/api/pricebook/' + p.id); ctx.close(true); }; },
    save: v => p ? PUT('/api/pricebook/' + p.id, v) : POST('/api/pricebook', v) });
  if (r) { toast('Saved'); rerender(); }
}
