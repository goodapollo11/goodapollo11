// Customer portal: view & approve estimates, view & pay invoices, customer hub. No login - access is by private link.
'use strict';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const root = document.getElementById('root');
const [, , kind, token] = location.pathname.split('/');
const params = new URLSearchParams(location.search);
let CUR = 'USD', TZ = 'America/Chicago';
const money = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: CUR }).format(Number(v) || 0);
const date = s => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : '';
const when = s => new Date(s).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const LOGO = '<svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect class="logo-bg" width="32" height="32" rx="7"/><path class="logo-stroke" d="M9 23V9l14 14V9" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function theme(t) { let saved = null; try { saved = localStorage.getItem('nw_theme'); } catch (_) { /* ignore */ } document.documentElement.dataset.theme = saved || t || 'nurzworks'; }
async function j(url, opts) { const r = await fetch(url, opts); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Something went wrong.'); return d; }
const post = (url, body) => j(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function hero(co, title, sub) {
  return `<div class="pub-hero">${LOGO}<div><h1>${esc(title)}</h1><p>${esc(sub || co.tagline || '')}</p></div></div>`;
}
function docHtml(k, d) {
  const co = d.company;
  const items = d.items.map(l => `<tr><td><b>${esc(l.name)}</b>${l.description ? `<div class="muted small" style="white-space:pre-wrap">${esc(l.description)}</div>` : ''}</td><td class="num">${Number(l.qty).toLocaleString('en-US', { maximumFractionDigits: 2 })}${l.unit ? ' ' + esc(l.unit) : ''}</td><td class="num">${money(l.unit_price)}</td><td class="num">${money(l.total)}</td></tr>`).join('');
  return `<div class="doc"><div class="doc-head"><div><div class="co">${esc(co.name)}</div><div class="muted small" style="white-space:pre-wrap">${esc([co.address, co.phone, co.email, co.website].filter(Boolean).join('\n'))}</div></div>
    <div class="ttl"><div class="k-label">${k === 'estimate' ? 'Estimate' : 'Invoice'}</div><div class="n">${esc(d.number)}</div><div class="small muted">${k === 'estimate' ? `Issued ${date(d.issue_date)}${d.expiry_date ? `<br>Valid until ${date(d.expiry_date)}` : ''}` : `Issued ${date(d.issue_date)}<br>Due ${date(d.due_date)}`}</div>${d.customer_po ? `<div class="small muted">PO ${esc(d.customer_po)}</div>` : ''}</div></div>
    <div class="doc-parties"><div><div class="k-label">${k === 'estimate' ? 'Prepared for' : 'Bill to'}</div><b>${esc(d.customer.name)}</b>${d.billing_address ? `<div class="muted small">${esc(d.billing_address)}</div>` : ''}</div>${d.address ? `<div><div class="k-label">Service address</div>${esc(d.address)}</div>` : ''}</div>
    ${d.title ? `<div style="font-weight:650;margin-bottom:8px">${esc(d.title)}</div>` : ''}${d.message ? `<div class="note" style="margin:0 0 14px">${esc(d.message)}</div>` : ''}
    <div class="tbl-wrap"><table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>${items}</tbody></table></div>
    <div class="totals"><div class="cost-row"><span>Subtotal</span><span>${money(d.subtotal)}</span></div>${d.discount ? `<div class="cost-row"><span>Discount</span><span>-${money(d.discount)}</span></div>` : ''}${d.tax ? `<div class="cost-row"><span>Tax (${d.tax_rate}%)</span><span>${money(d.tax)}</span></div>` : ''}
      <div class="cost-row total"><span>Total</span><span>${money(d.total)}</span></div>${k === 'invoice' && d.amount_paid ? `<div class="cost-row"><span>Paid</span><span>-${money(d.amount_paid)}</span></div><div class="cost-row total"><span>Balance due</span><span>${money(d.balance)}</span></div>` : ''}</div>
    ${d.terms ? `<div class="note"><b>Terms.</b> ${esc(d.terms)}</div>` : ''}${k === 'invoice' && d.payment_instructions ? `<div class="note"><b>How to pay.</b> ${esc(d.payment_instructions)}</div>` : ''}</div>`;
}

async function estimate() {
  const d = await j('/public/estimates/' + token); CUR = d.currency;
  document.title = `Estimate ${d.number} - ${d.company.name}`;
  const st = d.status;
  let status = '';
  if (st === 'approved' || st === 'converted') status = `<div class="pub-status good">✓ Approved${d.approved_name ? ` by ${esc(d.approved_name)}` : ''}. Thank you - we'll be in touch to schedule.</div>`;
  else if (st === 'declined') status = `<div class="pub-status bad">This estimate was declined.</div>`;
  else if (d.expired) status = `<div class="pub-status warn">This estimate has expired. Please contact us for an updated quote.</div>`;
  const canDecide = (st === 'sent' || st === 'draft') && !d.expired;
  root.innerHTML = hero(d.company, `Estimate from ${d.company.name}`, d.title) + docHtml('estimate', d) + `<div class="no-print" style="padding:0 4px">${status}
    ${canDecide ? `<div class="card card-b mt"><h3 style="margin:0 0 8px">Ready to go ahead?</h3><form class="form" onsubmit="return false"><div class="field full"><label>Type your full name to approve</label><input id="sig" autocomplete="name" placeholder="Your name"></div>
      <div class="field full"><label>Note (optional)</label><textarea id="note" rows="2" placeholder="Scheduling preferences or questions"></textarea></div>
      <div class="full"><label class="check"><input type="checkbox" id="agree"> I approve this estimate (${money(d.total)}) and its terms.</label></div><div class="full" id="err"></div>
      <div class="full pub-actions"><button class="btn good lg" id="approve">Approve estimate</button><button class="btn lg" id="decline">Decline</button><button class="btn lg" id="print">Print</button></div></form></div>` : `<div class="pub-actions"><button class="btn" id="print">Print / save PDF</button></div>`}</div>`;
  document.getElementById('print').onclick = () => window.print();
  if (canDecide) {
    document.getElementById('approve').onclick = async () => {
      const name = document.getElementById('sig').value.trim(); const err = document.getElementById('err');
      if (!name) return (err.innerHTML = '<div class="err">Type your name to approve.</div>');
      if (!document.getElementById('agree').checked) return (err.innerHTML = '<div class="err">Check the box to confirm your approval.</div>');
      try { await post(`/public/estimates/${token}/approve`, { name, note: document.getElementById('note').value }); estimate(); } catch (e) { err.innerHTML = `<div class="err">${esc(e.message)}</div>`; }
    };
    document.getElementById('decline').onclick = async () => {
      const reason = prompt('Sorry to hear that. Any feedback on why? (optional)') ?? null;
      if (reason === null) return;
      try { await post(`/public/estimates/${token}/decline`, { reason }); estimate(); } catch (e) { alert(e.message); }
    };
  }
}

async function invoice() {
  const d = await j('/public/invoices/' + token); CUR = d.currency;
  document.title = `Invoice ${d.number} - ${d.company.name}`;
  let status = '';
  if (params.get('paid')) status = '<div class="pub-status good">✓ Thank you! Your payment was received. This page updates once it clears.</div>';
  else if (d.status === 'paid') status = '<div class="pub-status good">✓ Paid in full. Thank you!</div>';
  else if (d.status === 'void') status = '<div class="pub-status warn">This invoice was cancelled - nothing is due.</div>';
  else if (d.is_overdue) status = `<div class="pub-status bad">This invoice was due ${date(d.due_date)}. Balance: <b>${money(d.balance)}</b></div>`;
  root.innerHTML = hero(d.company, `Invoice from ${d.company.name}`, d.title) + docHtml('invoice', d) + `<div class="no-print" style="padding:0 4px">${status}
    <div class="pub-actions">${d.pay_online && !params.get('paid') ? `<button class="btn primary lg" id="pay">Pay ${money(d.balance)} online</button>` : ''}<button class="btn lg" id="print">Print / save PDF</button></div><div id="err"></div></div>`;
  document.getElementById('print').onclick = () => window.print();
  const p = document.getElementById('pay');
  if (p) p.onclick = async () => { p.disabled = true; try { const r = await post(`/public/invoices/${token}/pay`); location.href = r.url; } catch (e) { document.getElementById('err').innerHTML = `<div class="err">${esc(e.message)}</div>`; p.disabled = false; } };
}

async function hub() {
  const d = await j('/public/customers/' + token); CUR = 'USD'; TZ = d.time_zone || TZ;
  document.title = `${d.company.name} - your account`;
  const open = d.invoices.filter(i => i.balance > 0 && !['paid', 'void'].includes(i.status));
  root.innerHTML = hero(d.company, `Hi ${d.customer.name.split(' ')[0]}`, `Your account with ${d.company.name}`) + `<div class="card pub-card"><div class="card-b">
    ${open.length ? `<div class="pub-status warn">You have ${open.length} open invoice${open.length > 1 ? 's' : ''} totalling <b>${money(open.reduce((s, i) => s + i.balance, 0))}</b>.</div>` : '<div class="pub-status good">✓ You\'re all paid up. Thank you!</div>'}
    ${d.visits.length ? `<h3>Upcoming visits</h3><ul class="list">${d.visits.map(v => `<li><div class="grow"><div class="t">${when(v.start_at)}</div><div class="s">${esc(v.title)}</div></div></li>`).join('')}</ul>` : ''}
    ${d.estimates.length ? `<h3>Estimates</h3><ul class="list">${d.estimates.map(x => `<li><a class="grow" href="/p/e/${esc(x.public_token)}"><div class="t">${esc(x.number)} · ${esc(x.title)}</div><div class="s">${date(x.issue_date)} · ${esc(x.status === 'sent' ? 'awaiting your approval' : x.status === 'converted' ? 'approved' : x.status)}</div></a><b>${money(x.total)}</b></li>`).join('')}</ul>` : ''}
    ${d.invoices.length ? `<h3>Invoices</h3><ul class="list">${d.invoices.map(x => `<li><a class="grow" href="/p/i/${esc(x.public_token)}"><div class="t">${esc(x.number)}${x.title ? ' · ' + esc(x.title) : ''}</div><div class="s">${date(x.issue_date)} · ${x.balance > 0 && x.status !== 'void' ? `due ${date(x.due_date)}` : esc(x.status)}</div></a><b>${money(x.balance > 0 ? x.balance : x.total)}</b></li>`).join('')}</ul>` : ''}
    <div class="pub-actions"><a class="btn primary" href="/request">Request service</a>${d.company.phone ? `<a class="btn" href="tel:${esc(d.company.phone.replace(/[^\d+]/g, ''))}">Call ${esc(d.company.phone)}</a>` : ''}</div></div></div>`;
}

fetch('/public/info').then(r => r.json()).then(i => theme(i.theme)).catch(() => theme());
({ e: estimate, i: invoice, c: hub }[kind] || (async () => { throw new Error('Page not found'); }))()
  .then(() => { if (params.get('print')) setTimeout(() => window.print(), 400); })
  .catch(e => { root.innerHTML = `<div class="card card-b"><div class="err">${esc(e.message)}</div><p class="muted">This link may have expired or been replaced. Please contact us.</p></div>`; });
