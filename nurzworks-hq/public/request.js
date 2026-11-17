// Public service request form (no login)
'use strict';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $id = id => document.getElementById(id);
fetch('/public/info').then(r => r.json()).then(info => {
  let saved = null; try { saved = localStorage.getItem('nw_theme'); } catch (_) { /* ignore */ }
  document.documentElement.dataset.theme = saved || info.theme || 'nurzworks';
  $id('co').textContent = `${info.company.name} - request service`;
  document.title = `Request service - ${info.company.name}`;
  if (info.company.tagline) $id('tag').textContent = `${info.company.tagline}. Tell us what you need - we'll get back to you quickly.`;
  $id('svc').innerHTML = info.services.map(s => `<option value="${esc(s)}">`).join('');
  const bits = [info.company.phone && `Call ${esc(info.company.phone)}`, info.company.email && `<a href="mailto:${esc(info.company.email)}">${esc(info.company.email)}</a>`, info.business_hours && esc(info.business_hours)].filter(Boolean);
  $id('foot').innerHTML = bits.join(' · ');
  try { $id('name').value = localStorage.getItem('nw_req_name') || ''; $id('email').value = localStorage.getItem('nw_req_email') || ''; $id('phone').value = localStorage.getItem('nw_req_phone') || ''; } catch (_) { /* ignore */ }
}).catch(() => {});
$id('go').onclick = async () => {
  const body = Object.fromEntries(new FormData($id('f')));
  const err = $id('err'); err.innerHTML = '';
  if (!body.service.trim() && !body.details.trim()) { err.innerHTML = '<div class="err">Tell us what you need help with.</div>'; return; }
  if (!body.name.trim()) { err.innerHTML = '<div class="err">Please enter your name.</div>'; return; }
  if (!body.phone.trim() && !body.email.trim()) { err.innerHTML = '<div class="err">Please give us a phone number or email so we can reach you.</div>'; return; }
  const btn = $id('go'); btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch('/public/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Something went wrong.');
    try { localStorage.setItem('nw_req_name', body.name); localStorage.setItem('nw_req_email', body.email); localStorage.setItem('nw_req_phone', body.phone); } catch (_) { /* ignore */ }
    $id('body').innerHTML = `<div class="pub-done"><div style="font-size:15px">Thanks! Your request was sent.</div><div class="num">${esc(d.number)}</div><div class="muted">We'll contact you shortly. Keep this number for reference.</div><p><a class="btn" href="/request">Send another request</a></p></div>`;
  } catch (e) { err.innerHTML = `<div class="err">${esc(e.message)}</div>`; btn.disabled = false; btn.textContent = 'Send request'; }
};
