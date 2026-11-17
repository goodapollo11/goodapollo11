/* NurzWorks HQ - office: inbox (Gmail), tasks, time & expenses, reports */
'use strict';

// ======================= INBOX (Gmail) =======================
const INBOX = { label: 'INBOX', q: '', thread: null, page: null };
VIEWS.inbox = async (view, r) => {
  if (!S.meta.integrations.gmail) {
    view.innerHTML = `<div class="page-head"><div><h1>Inbox</h1><div class="sub">Your business Gmail, inside HQ</div></div></div>
      <div class="card card-b" style="max-width:720px"><div class="row" style="gap:14px;align-items:flex-start">${icon('mail')}<div><h3 style="margin:0 0 6px">Connect your Google Workspace mailbox</h3>
      <p class="muted" style="margin:0 0 10px">Read and answer customer email here, see every conversation on the customer's record, send estimates and invoices from your own address, and let AI staff triage the inbox and draft replies for your review.</p>
      ${can('admin') ? `<a class="btn primary" href="#/integrations">${icon('plug')}Set up Google</a>` : '<span class="muted">Ask an admin to connect Google under Integrations.</span>'}</div></div></div>`;
    return;
  }
  if (r.q.thread) INBOX.thread = r.q.thread;
  view.innerHTML = `<div class="page-head"><div><h1>Inbox</h1><div class="sub">${e(S.meta.company.email || 'Business Gmail')}</div></div>
    <div class="actions"><button class="btn primary" id="mCompose">${icon('send')}Compose</button></div></div>
    <div class="card"><div class="filters"><div class="seg">${[['INBOX', 'Inbox'], ['UNREAD', 'Unread'], ['STARRED', 'Starred'], ['SENT', 'Sent'], ['ALL', 'All mail']].map(([k, l]) => `<button data-label="${k}" class="${INBOX.label === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="search" id="mq" placeholder="Search mail (Gmail syntax: from: subject: newer_than:7d)" value="${e(INBOX.q)}" style="flex:1;min-width:200px"><button class="btn sm" id="mRefresh">${icon('refresh')}</button></div>
    <div class="inbox ${INBOX.thread ? 'reading' : ''}" id="inboxEl"><div class="threads" id="threads"><div class="loading">Loading mail…</div></div><div class="thread-view" id="threadView"><div class="empty">${icon('mail')}Pick a conversation.</div></div></div></div>`;
  $$('[data-label]', view).forEach(b => b.onclick = () => { INBOX.label = b.dataset.label; INBOX.thread = null; router(); });
  let st; $('#mq').oninput = ev => { clearTimeout(st); st = setTimeout(() => { INBOX.q = ev.target.value; loadThreads(); }, 500); };
  $('#mRefresh').onclick = () => loadThreads();
  $('#mCompose').onclick = () => composeEmail({});
  await loadThreads();
  if (INBOX.thread) openThread(INBOX.thread);
};
async function loadThreads(more = false) {
  const box = $('#threads'); if (!box) return;
  try {
    const r = await api('/api/email/threads' + qs({ label: INBOX.label, q: INBOX.q, page_token: more ? INBOX.page : '' }));
    INBOX.page = r.next_page_token;
    const html = r.threads.map(t => `<div class="thread-item ${t.unread ? 'unread' : ''} ${t.thread_id === INBOX.thread ? 'on' : ''}" data-thread="${e(t.thread_id)}">
      <div class="top-line">${t.unread ? '<span class="udot"></span>' : ''}<span class="from">${e(t.from_name || t.from_email || '(me)')}</span><span class="small muted nowrap">${fmt.rel(t.last_date)}</span></div>
      <div class="subj">${e(t.subject)}${t.message_count > 1 ? ` <span class="muted">(${t.message_count})</span>` : ''}</div><div class="snip">${t.customer_name ? `<span class="tag">${e(t.customer_name)}</span> ` : ''}${e(t.snippet)}</div></div>`).join('');
    box.innerHTML = (more ? box.innerHTML.replace(/<button class="btn sm block" id="mMore">[\s\S]*$/, '') : '') + (html || '<div class="empty">No conversations.</div>') + (INBOX.page ? `<button class="btn sm block" id="mMore">Load more</button>` : '');
    $$('[data-thread]', box).forEach(el => el.onclick = () => openThread(el.dataset.thread));
    const mm = $('#mMore'); if (mm) mm.onclick = () => loadThreads(true);
  } catch (err) { box.innerHTML = `<div class="card-b"><div class="err">${e(err.message)}</div></div>`; }
}
async function openThread(id) {
  INBOX.thread = id;
  $$('.thread-item').forEach(x => x.classList.toggle('on', x.dataset.thread === id));
  $('#inboxEl').classList.add('reading');
  const tv = $('#threadView'); tv.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const t = await api('/api/email/threads/' + encodeURIComponent(id));
    const last = t.messages[t.messages.length - 1];
    const quoted = s => e(s).split('\n').map(line => /^&gt;/.test(line) ? `<span class="quoted">${line}</span>` : line).join('\n');
    tv.innerHTML = `<button class="btn sm ghost" id="tBack" style="margin-bottom:8px">${icon('chevL')}Back</button>
      <h2 style="margin:0 0 6px;font-size:18px">${e(t.subject)}</h2>
      <div class="row" style="margin-bottom:12px">${t.customer_id ? `<a class="chip on" href="#/customers/${t.customer_id}">${icon('users')}${e(t.customer_name)}</a>${t.job_id ? `<a class="chip" href="#/jobs/${t.job_id}">${icon('wo')}${e(t.job_number)}</a>` : ''}` : '<span class="chip">Not linked to a customer</span>'}
        <button class="btn sm" id="tLink">${icon('link')}${t.customer_id ? 'Change link' : 'Link to customer'}</button>
        <span style="flex:1"></span><button class="btn sm" id="tReply">${icon('reply')}Reply</button><button class="btn sm" id="tRead">${t.unread ? 'Mark read' : 'Mark unread'}</button><button class="btn sm" id="tArchive">${icon('archive')}Archive</button>
        <button class="btn sm" id="tReq">${icon('inbox')}Make request</button><button class="btn sm" id="tTask">${icon('task')}Task</button></div>
      ${t.messages.map((m, i) => `<div class="msg"><div class="msg-h"><b>${e(m.from)}</b><span class="muted">to ${e(m.to)}${m.cc ? ', cc ' + e(m.cc) : ''}</span><span class="muted" style="margin-left:auto">${fmt.dt(m.date)}</span></div>
        <div class="msg-b" id="mb${i}">${quoted(m.text || '(no text)')}</div>${m.html ? `<div style="padding:0 14px 10px"><button class="btn sm ghost" data-html="${i}">${icon('eye')}Show formatted</button></div>` : ''}
        ${m.attachments.length ? `<div class="msg-h" style="border-top:1px solid var(--line-2);border-bottom:none">${icon('clip')}${m.attachments.map(a => e(a.filename)).join(', ')} <span class="muted">(open in Gmail to download)</span></div>` : ''}</div>`).join('')}
      ${t.unknown_senders && t.unknown_senders.length && !t.customer_id ? `<div class="callout info">${icon('users')}<div>Unknown sender${t.unknown_senders.length > 1 ? 's' : ''}: ${t.unknown_senders.map(x => e(x)).join(', ')}. ${t.suggestions.length ? '' : 'Link to a customer or turn this into a request.'}</div></div>` : ''}`;
    $('#tBack').onclick = () => { $('#inboxEl').classList.remove('reading'); INBOX.thread = null; };
    $$('[data-html]', tv).forEach(b => b.onclick = () => {
      const m = t.messages[+b.dataset.html]; const fr = document.createElement('iframe'); fr.setAttribute('sandbox', ''); fr.setAttribute('referrerpolicy', 'no-referrer');
      fr.srcdoc = `<base target="_blank"><style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#15202b;margin:12px}img{max-width:100%}</style>${m.html}`;
      const mb = $('#mb' + b.dataset.html); mb.replaceWith(fr); b.remove(); fr.onload = () => { try { fr.style.height = Math.min(1600, fr.contentDocument.body.scrollHeight + 30) + 'px'; } catch (_) { fr.style.height = '500px'; } };
    });
    $('#tReply').onclick = () => composeEmail({ thread_id: t.thread_id, to: last.from_us ? last.to : last.from, subject: /^re:/i.test(t.subject) ? t.subject : 'Re: ' + t.subject, customer_id: t.customer_id, job_id: t.job_id });
    $('#tRead').onclick = async () => { await POST(`/api/email/threads/${encodeURIComponent(id)}/modify`, { read: !!t.unread }); loadThreads(); openThread(id); };
    $('#tArchive').onclick = async () => { await POST(`/api/email/threads/${encodeURIComponent(id)}/modify`, { archive: true, read: true }); toast('Archived'); INBOX.thread = null; $('#inboxEl').classList.remove('reading'); tv.innerHTML = ''; loadThreads(); };
    $('#tLink').onclick = async () => {
      const r2 = await formModal({ title: 'Link conversation', size: 'narrow', okLabel: 'Link', fields: [{ name: 'customer_id', label: 'Customer', type: 'customer', value: t.customer_id, full: 1 }],
        save: v => POST(`/api/email/threads/${encodeURIComponent(id)}/link`, { customer_id: v.customer_id || null }) });
      if (r2) { toast('Linked'); openThread(id); loadThreads(); }
    };
    $('#tReq').onclick = async () => {
      const f = last.from_us ? { name: '', email: '' } : (() => { const m = String(last.from).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return m ? { name: m[1], email: m[2] } : { name: last.from, email: last.from }; })();
      const r2 = await POST('/api/requests', { name: f.name || f.email || 'Email lead', email: f.email, service: t.subject.slice(0, 200), details: (last.text || '').slice(0, 4000), source: 'email', customer_id: t.customer_id || null }).catch(err => toast(err.message, 'error'));
      if (r2) { toast(`${r2.number} created`); location.hash = '#/requests/' + r2.id; }
    };
    $('#tTask').onclick = () => taskForm({ title: `Email: ${t.subject}`.slice(0, 200), details: `From ${last.from}\n\n${(last.text || '').slice(0, 1500)}`, related_type: t.customer_id ? 'customer' : '', related_id: t.customer_id || '' });
    if (t.unread) { POST(`/api/email/threads/${encodeURIComponent(id)}/modify`, { read: true }).catch(() => {}); }
  } catch (err) { tv.innerHTML = `<div class="err">${e(err.message)}</div>`; }
}
async function composeEmail(p) {
  const sendOk = can('email');
  await modal({ title: p.thread_id ? 'Reply' : 'New email', size: 'wide', body: `<form class="form" onsubmit="return false">
      <div class="field full"><label>To</label><input name="to" value="${e(p.to || '')}" placeholder="name@example.com, …"></div>
      <div class="field"><label>Cc</label><input name="cc"></div><div class="field"><label>Subject</label><input name="subject" value="${e(p.subject || '')}"></div>
      <div class="field full"><label>Message</label><textarea name="body" rows="10">${e(p.body || '')}</textarea><div class="hint">Sent from the business Gmail account and logged on the customer's record.</div></div></form>`,
    foot: `<button class="btn" data-x>Cancel</button><button class="btn" id="cDraft">${icon('edit')}Save as Gmail draft</button>${sendOk ? `<button class="btn primary" id="cSend">${icon('send')}Send</button>` : ''}`,
    onMount: ctx => {
      const go = async draft => {
        const v = readForm(ctx.el); if (!v.body.trim()) return ctx.error('Write a message first.');
        try { await POST(draft ? '/api/email/drafts' : '/api/email/send', { ...v, thread_id: p.thread_id, customer_id: p.customer_id || undefined, job_id: p.job_id || undefined }); toast(draft ? 'Draft saved in Gmail' : 'Sent'); ctx.close(true); if (INBOX.thread) openThread(INBOX.thread); }
        catch (err) { ctx.error(err.message); }
      };
      $('#cDraft', ctx.el).onclick = () => go(true);
      const s = $('#cSend', ctx.el); if (s) s.onclick = () => go(false);
    } });
}

// ======================= TASKS =======================
VIEWS.tasks = async (view, r) => {
  const tab = r.q.tab || (S.me.role === 'field' ? 'mine' : 'mine');
  const q = { mine: { assigned_to: 'me' }, ai: { assigned_to: 'ai' }, all: {}, none: { assigned_to: 'none' }, done: { status: 'done' } }[tab] || {};
  const rows = await api('/api/tasks' + qs({ status: 'open', ...q, limit: 300 }));
  view.innerHTML = `
  <div class="page-head"><div><h1>Tasks</h1><div class="sub">To-dos for people and AI staff. AI staff pick up their tasks through MCP and report back here.</div></div>
    <div class="actions">${can('write') ? `<button class="btn primary" id="tNew">${icon('plus')}New task</button>` : ''}</div></div>
  <div class="card"><div class="tabs">${[['mine', 'Mine'], ['ai', 'AI staff'], ['all', 'Everyone'], ['none', 'Unassigned'], ['done', 'Done']].map(([k, l]) => `<a href="#/tasks?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${rows.length ? `<ul class="list">${rows.map(t => `<li class="click" data-task="${t.id}"><input type="checkbox" data-done="${t.id}" ${t.status === 'done' ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--good)" ${can('write') ? '' : 'disabled'} aria-label="Done">
      ${avatar(userById(t.assigned_to)) || '<span class="avatar sm" style="background:var(--muted-soft);color:var(--ink-3)">?</span>'}
      <div class="grow"><div class="t" style="${t.status === 'done' ? 'text-decoration:line-through;color:var(--ink-3)' : ''}">${e(t.title)}</div>
        <div class="s">${e(t.assignee || 'Unassigned')}${t.assignee_kind === 'ai' ? ' (AI)' : ''}${t.related_label ? ' · ' + e(t.related_label) : ''}${t.status === 'waiting' ? ' · waiting' : t.status === 'in_progress' ? ' · in progress' : ''}${t.result ? ' · ' + e(t.result.slice(0, 120)) : ''}</div></div>
      ${t.due_date ? `<span class="small nowrap ${t.due_date < todayStr() && t.status !== 'done' ? 'overdue-flag' : 'muted'}">${fmt.dueIn(t.due_date)}</span>` : ''}${priPill(t.priority)}</li>`).join('')}</ul>` : '<div class="empty">' + icon('task') + 'Nothing here.</div>'}</div>`;
  const tn = $('#tNew'); if (tn) tn.onclick = () => taskForm({ assigned_to: tab === 'mine' ? S.me.id : '' });
  $$('[data-done]', view).forEach(c => c.addEventListener('click', async ev => { ev.stopPropagation(); await PUT('/api/tasks/' + c.dataset.done, { status: c.checked ? 'done' : 'open' }); toast(c.checked ? 'Done' : 'Reopened'); rerender(); }));
  $$('[data-task]', view).forEach(li => li.addEventListener('click', ev => { if (ev.target.closest('input')) return; taskDetail(+li.dataset.task); }));
  if (r.q.id) taskDetail(+r.q.id);
};
async function taskForm(preset = {}, task = null) {
  const team = S.meta.team;
  const r = await formModal({ title: task ? 'Edit task' : 'New task', okLabel: task ? 'Save' : 'Create task',
    fields: [{ name: 'title', label: 'Task', value: (task || preset).title, required: 1, full: 1 },
      { name: 'assigned_to', label: 'Assign to', type: 'select', options: team.map(u => [u.id, `${u.name}${u.kind === 'ai' ? ' (AI staff)' : ''}`]), value: (task || preset).assigned_to ?? '', blank: 'Unassigned' },
      { name: 'due_date', label: 'Due', type: 'date', value: (task || preset).due_date }, { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map(p => [p, cap(p)]), value: (task || preset).priority || 'normal' },
      ...(task ? [{ name: 'status', label: 'Status', type: 'select', options: Object.entries(LABELS.task), value: task.status }] : []),
      { name: 'details', label: 'Details / instructions', type: 'textarea', rows: 4, value: (task || preset).details, full: 1, placeholder: 'For AI staff: be specific about the outcome you want.' }],
    save: v => task ? PUT('/api/tasks/' + task.id, v) : POST('/api/tasks', { ...v, related_type: preset.related_type || undefined, related_id: preset.related_id || undefined }) });
  if (r) { toast(task ? 'Task saved' : 'Task created'); rerender(); }
}
async function taskDetail(id) {
  const t = await api('/api/tasks/' + id);
  const link = t.related_type && t.related_id ? `#/${{ customer: 'customers', job: 'jobs', estimate: 'estimates', invoice: 'invoices', request: 'requests', plan: 'plans', visit: 'schedule' }[t.related_type]}/${t.related_id}` : '';
  await modal({ title: t.title, body: `<div class="row" style="margin-bottom:10px">${pill('task', t.status)}${priPill(t.priority)}${t.due_date ? `<span class="muted">due ${fmt.date(t.due_date)}</span>` : ''}${link ? `<a href="${link}" data-x>${e(t.related_label || t.related_type)}</a>` : ''}</div>
      <div class="dl two"><div><div class="k">Assigned to</div><div class="v">${e(t.assignee || 'Unassigned')}${t.assignee_kind === 'ai' ? ' <span class="tag ai">AI</span>' : ''}</div></div><div><div class="k">Created by</div><div class="v">${e(t.created_by)} · ${fmt.rel(t.created_at)}</div></div></div>
      ${t.details ? `<div class="mt"><div class="k-label">Details</div><div class="desc">${e(t.details)}</div></div>` : ''}${t.result ? `<div class="callout good mt">${icon('check')}<div><b>Result:</b> ${e(t.result)}</div></div>` : ''}
      <div class="mt"><div class="k-label">History</div>${timeline(t.activity)}</div>`,
    foot: `${can('write') ? `<button class="btn danger left" id="tDel">${icon('trash')}</button><button class="btn" id="tEdit">${icon('edit')}Edit</button>${t.status !== 'done' ? `<button class="btn good" id="tDone">${icon('check')}Mark done</button>` : ''}` : ''}<button class="btn" data-x>Close</button>`,
    onMount: ctx => {
      const d = $('#tDone', ctx.el); if (d) d.onclick = async () => { const r2 = await formModal({ title: 'Complete task', size: 'narrow', okLabel: 'Done', fields: [{ name: 'result', label: 'What was done (optional)', type: 'textarea', rows: 3, full: 1 }], save: v => PUT('/api/tasks/' + t.id, { status: 'done', result: v.result }) }); if (r2) { ctx.close(); toast('Done'); rerender(); } };
      const ed = $('#tEdit', ctx.el); if (ed) ed.onclick = () => { ctx.close(); taskForm({}, t); };
      const del = $('#tDel', ctx.el); if (del) del.onclick = async () => { if (await confirmBox('Delete task', 'Delete this task?', 'Delete', true)) { await DEL('/api/tasks/' + t.id); ctx.close(); rerender(); } };
    } });
}

// ======================= TIME & EXPENSES =======================
let tsWeek = null;
VIEWS.time = async (view, r) => {
  const tab = r.q.tab || 'timesheet';
  const field = S.me.role === 'field';
  const head = `<div class="page-head"><div><h1>Time & expenses</h1><div class="sub">Clock in from My Day or a visit; log time, mileage and receipts here</div></div>
    <div class="actions">${can('books') ? `<a class="btn" href="/api/export/${tab === 'expenses' ? 'expenses' : 'time'}.csv">${icon('download')}CSV</a>` : ''}${can('write') ? `<button class="btn" id="xNew">${icon('dollar')}Expense / mileage</button><button class="btn primary" id="tmNew">${icon('plus')}Log time</button>` : ''}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="tabs" style="border-bottom:none">${[['timesheet', 'Timesheet'], ['entries', 'Time entries'], ['expenses', 'Expenses & mileage']].map(([k, l]) => `<a href="#/time?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div></div>`;
  if (tab === 'timesheet') {
    const wk = tsWeek || mondayOf(todayStr()); const end = addDays(wk, 6);
    const rows = await api('/api/time' + qs({ from: wk, to: end, user_id: field ? 'me' : '', limit: 500 }));
    const people = field ? [S.me] : S.meta.team.filter(u => u.kind === 'human');
    const days = Array.from({ length: 7 }, (_, i) => addDays(wk, i));
    const cell = (u, d) => rows.filter(x => x.user_id === u.id && x.work_date === d).reduce((s, x) => s + x.hours, 0);
    view.innerHTML = head + `<div class="card"><div class="cal-tools"><button class="icon-btn" id="wPrev">${icon('chevL')}</button><button class="btn sm" id="wNow">This week</button><button class="icon-btn" id="wNext">${icon('chevron')}</button><span class="date">${fmt.date(wk)} - ${fmt.date(end)}</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Person</th>${days.map(d => `<th class="num">${weekday(d)} ${+d.slice(8)}</th>`).join('')}<th class="num">Total</th><th class="num">Billable</th></tr></thead><tbody>
      ${people.map(u => { const tot = days.reduce((s, d) => s + cell(u, d), 0); const bill = rows.filter(x => x.user_id === u.id && x.billable).reduce((s, x) => s + x.hours, 0);
        return `<tr><td>${avatar(u)} ${e(u.name)}</td>${days.map(d => { const h = cell(u, d); return `<td class="num ${h ? '' : 'muted'}">${h ? fmt.num(h, 2) : '·'}</td>`; }).join('')}<td class="num"><b>${fmt.num(tot, 2)}</b></td><td class="num">${fmt.num(bill, 2)}</td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>Total</td>${days.map(d => `<td class="num">${fmt.num(rows.filter(x => x.work_date === d).reduce((s, x) => s + x.hours, 0), 2)}</td>`).join('')}<td class="num">${fmt.num(rows.reduce((s, x) => s + x.hours, 0), 2)}</td><td class="num">${fmt.num(rows.filter(x => x.billable).reduce((s, x) => s + x.hours, 0), 2)}</td></tr></tfoot></table></div>
      <div class="card-h" style="border-top:1px solid var(--line-2)"><h3>Entries this week</h3></div>${timeTable(rows)}</div>`;
    $('#wPrev').onclick = () => { tsWeek = addDays(wk, -7); router(); }; $('#wNext').onclick = () => { tsWeek = addDays(wk, 7); router(); }; $('#wNow').onclick = () => { tsWeek = null; router(); };
    bindTimeRows(view, rows);
  } else if (tab === 'entries') {
    const rows = await api('/api/time' + qs({ user_id: field ? 'me' : r.q.user, from: r.q.from, to: r.q.to, unbilled: r.q.unbilled, limit: 500 }));
    view.innerHTML = head + `<div class="card"><div class="filters">${field ? '' : `<select id="fUser">${opt(S.meta.team.filter(u => u.kind === 'human').map(u => [u.id, u.name]), r.q.user, 'Everyone')}</select>`}
      <input type="date" id="fFrom" value="${e(r.q.from || '')}"><input type="date" id="fTo" value="${e(r.q.to || '')}"><label class="check small"><input type="checkbox" id="fUnb" ${r.q.unbilled ? 'checked' : ''}>Unbilled only</label>
      <span class="spacer"></span><span class="muted small">${fmt.num(rows.reduce((s, x) => s + x.hours, 0), 2)} h</span></div>${timeTable(rows)}</div>`;
    const setQ = () => { location.hash = '#/time' + qs({ tab: 'entries', user: $('#fUser') ? $('#fUser').value : '', from: $('#fFrom').value, to: $('#fTo').value, unbilled: $('#fUnb').checked ? 1 : '' }); };
    $$('.filters select, .filters input', view).forEach(x => x.onchange = setQ);
    bindTimeRows(view, rows);
  } else {
    const rows = await api('/api/expenses' + qs({ user_id: field ? 'me' : '', limit: 500 }));
    view.innerHTML = head + `<div class="card"><div id="xTbl">${table(rows, [
      { label: 'Date', render: x => fmt.date(x.expense_date) }, { label: 'Category', render: x => `<span class="tag">${e(x.category)}</span>` },
      { label: 'Details', cls: 'title-cell', render: x => `<div>${e(x.vendor || x.description || '—')}</div><div class="sub">${e(x.description && x.vendor ? x.description : '')}${x.miles ? ` ${fmt.num(x.miles, 1)} mi` : ''}</div>` },
      { label: 'Job', hideM: 1, render: x => x.job_number ? `<a href="#/jobs/${x.job_id}">${e(x.job_number)}</a>` : '—' }, { label: 'Person', hideM: 1, render: x => e(x.user_name || '—') },
      { label: 'Receipt', hideM: 1, render: x => x.receipt_id ? `<a href="/api/attachments/${x.receipt_id}/file" target="_blank" rel="noopener">${icon('clip')}</a>` : '' },
      { label: 'Billable', hideM: 1, render: x => x.billable ? (x.invoice_number ? e(x.invoice_number) : 'yes') : '' }, { label: 'Amount', num: 1, render: x => `<b>${fmt.money(x.amount)}</b>` }
    ], { onRow: 1, empty: 'No expenses yet.', emptyIcon: 'dollar' })}</div></div>`;
    bindTable($('#xTbl'), rows, { onRow: x => expenseForm({}, x) });
  }
  const tn = $('#tmNew'); if (tn) tn.onclick = () => timeForm();
  const xn = $('#xNew'); if (xn) xn.onclick = () => expenseForm();
};
const timeTable = rows => table(rows, [
  { label: 'Date', render: t => fmt.date(t.work_date) }, { label: 'Person', render: t => e(t.user_name) },
  { label: 'Job', render: t => t.job_number ? `<a href="#/jobs/${t.job_id}">${e(t.job_number)}</a><div class="sub">${e(t.customer_name || '')}</div>` : '<span class="muted">General</span>' },
  { label: 'Category', hideM: 1, render: t => `<span class="tag">${e(t.category)}</span>` }, { label: 'Notes', hideM: 1, render: t => `<span class="muted">${e(t.description)}</span>` },
  { label: 'Hours', num: 1, render: t => t.started_at && !t.ended_at ? '<span class="pill st-on_site">running</span>' : `<b>${fmt.num(t.hours, 2)}</b>` },
  { label: 'Billable', hideM: 1, render: t => t.billable ? (t.invoice_number ? e(t.invoice_number) : fmt.money(t.bill_rate) + '/h') : '<span class="muted">no</span>' }
], { onRow: 1, compact: 1, empty: 'No time logged.' });
function bindTimeRows(view, rows) { $$('tbody tr[data-i]', view).forEach(tr => { const t = rows[+tr.dataset.i]; if (t && t.user_name) tr.onclick = ev => { if (!ev.target.closest('a')) timeForm({}, t); }; }); }
async function timeForm(preset = {}, entry = null) {
  const jobs = await api('/api/jobs?status=all&sort=number&limit=200');
  const people = S.meta.team.filter(u => u.kind === 'human');
  const v = entry || { work_date: todayStr(), user_id: S.me.kind === 'human' ? S.me.id : '', billable: false, category: 'labor', ...preset };
  const r = await formModal({ title: entry ? 'Edit time' : 'Log time', okLabel: 'Save',
    extraFoot: entry && !entry.invoice_id ? `<button class="btn danger left" id="teDel">${icon('trash')}Delete</button>` : '',
    fields: [
      ...(can('office') ? [{ name: 'user_id', label: 'Person', type: 'select', options: people.map(u => [u.id, u.name]), value: v.user_id }] : []),
      { name: 'work_date', label: 'Date', type: 'date', value: v.work_date }, { name: 'hours', label: 'Hours', type: 'number', step: '0.25', min: 0, value: v.hours || '', required: 1 },
      { name: 'job_id', label: 'Job', type: 'select', options: jobs.map(j => [j.id, `${j.number} · ${j.title} - ${j.customer_name}`]), value: v.job_id, blank: 'General / not job related' },
      { name: 'category', label: 'Category', type: 'select', options: ['labor', 'consulting', 'travel', 'admin', 'training', 'other'].map(c => [c, cap(c)]), value: v.category },
      { name: 'billable', label: 'Billable to the customer', type: 'checkbox', value: v.billable }, { name: 'description', label: 'What was done', full: 1, value: v.description }],
    onMount: ctx => { const d = $('#teDel', ctx.el); if (d) d.onclick = async () => { await DEL('/api/time/' + entry.id); ctx.close(true); }; },
    save: vals => entry ? PUT('/api/time/' + entry.id, vals) : POST('/api/time', vals) });
  if (r) { toast('Time saved'); rerender(); }
}
async function expenseForm(preset = {}, x = null) {
  const jobs = await api('/api/jobs?status=all&sort=number&limit=200');
  const v = x || { expense_date: todayStr(), category: 'materials', ...preset };
  const r = await formModal({ title: x ? 'Edit expense' : 'Log expense or mileage', okLabel: 'Save',
    extraFoot: x && !x.invoice_id ? `<button class="btn danger left" id="exDel">${icon('trash')}Delete</button>` : '',
    fields: [{ name: 'expense_date', label: 'Date', type: 'date', value: v.expense_date }, { name: 'category', label: 'Category', type: 'select', options: ['materials', 'fuel', 'mileage', 'tools', 'equipment', 'meals', 'lodging', 'subcontractor', 'software', 'office', 'other'].map(c => [c, cap(c)]), value: v.category },
      { name: 'amount', label: 'Amount ($)', type: 'number', step: '0.01', min: 0, value: v.amount || '', hint: 'For mileage, leave blank and enter miles.' }, { name: 'miles', label: 'Miles', type: 'number', step: '0.1', min: 0, value: v.miles || '', hint: `Mileage rate $${S.meta.settings.mileage_rate}/mi` },
      { name: 'vendor', label: 'Vendor', value: v.vendor }, { name: 'job_id', label: 'Job', type: 'select', options: jobs.map(j => [j.id, `${j.number} · ${j.title}`]), value: v.job_id, blank: 'Not job related' },
      { name: 'description', label: 'Description', value: v.description, full: 1 }, { name: 'billable', label: 'Re-bill to the customer', type: 'checkbox', value: v.billable }, { name: 'markup_pct', label: 'Markup %', type: 'number', min: 0, value: v.markup_pct || '' },
      ...(x ? [] : [{ name: 'receipt', label: 'Receipt photo', type: 'html', full: 1, html: `<input type="file" id="xReceipt" accept="image/*,application/pdf" capture="environment" class="inp" style="padding:5px" data-skip="1">` }])],
    onMount: ctx => { const d = $('#exDel', ctx.el); if (d) d.onclick = async () => { await DEL('/api/expenses/' + x.id); ctx.close(true); }; },
    save: async (vals, ctx) => {
      const body = { ...vals }; delete body.receipt;
      if (!body.amount) delete body.amount;
      const res = x ? await PUT('/api/expenses/' + x.id, body) : await POST('/api/expenses', body);
      const f = !x && $('#xReceipt', ctx.el).files[0];
      if (f) await upload('expense', res.id, f, { kind: 'receipt' });
      return res;
    } });
  if (r) { toast('Expense saved'); rerender(); }
}

// ======================= REPORTS =======================
const REP = { period: 'month', from: '', to: '' };
function periodRange(p) {
  const t = todayStr(); const y = +t.slice(0, 4), m = +t.slice(5, 7);
  if (p === 'month') return [t.slice(0, 8) + '01', t];
  if (p === 'last') { const lm = addMonths(t.slice(0, 8) + '01', -1); return [lm, addDays(t.slice(0, 8) + '01', -1)]; }
  if (p === 'quarter') { const qm = Math.floor((m - 1) / 3) * 3 + 1; return [`${y}-${String(qm).padStart(2, '0')}-01`, t]; }
  if (p === 'ytd') return [`${y}-01-01`, t];
  if (p === '12m') return [addDays(t, -365), t];
  return [REP.from || t.slice(0, 8) + '01', REP.to || t];
}
VIEWS.reports = async (view, r) => {
  if (r.q.period) REP.period = r.q.period;
  const [from, to] = periodRange(REP.period);
  const [s, rev, prof, team, pipe, custs, aging, kpis] = await Promise.all(['summary', 'revenue', 'profitability', 'team', 'pipeline', 'customers'].map(k => api(`/api/reports/${k}` + qs({ from, to, months: 12 })))
    .concat([api('/api/reports/ar-aging'), api('/api/reports/kpis?months=12')]));
  const C = CH();
  const sc = (k, v, d = '') => `<div><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
  view.innerHTML = `
  <div class="page-head"><div><h1>Reports</h1><div class="sub">${fmt.date(from)} - ${fmt.date(to)}</div></div>
    <div class="actions"><div class="seg">${[['month', 'This month'], ['last', 'Last month'], ['quarter', 'Quarter'], ['ytd', 'Year to date'], ['12m', '12 months'], ['custom', 'Custom']].map(([k, l]) => `<button data-p="${k}" class="${REP.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${REP.period === 'custom' ? `<input type="date" class="inp" id="rFrom" value="${from}" style="width:auto"><input type="date" class="inp" id="rTo" value="${to}" style="width:auto">` : ''}<button class="btn" id="rPrint">${icon('print')}</button></div></div>
  <div class="card"><div class="scorecard">
    ${sc('Revenue', fmt.money0(s.revenue), `${s.invoices} invoices · avg ${fmt.money0(s.avg_invoice)}`)}${sc('Collected', fmt.money0(s.collected), `${s.payments} payments`)}
    ${sc('Receivables', fmt.money0(s.outstanding), `${fmt.money0(s.overdue)} overdue`)}${sc('Gross profit', fmt.money0(s.gross_profit), 'revenue - materials - labor - expenses')}
    ${sc('Jobs completed', fmt.num(s.jobs_completed))}${sc('Hours logged', fmt.num(s.hours, 1), `${fmt.num(s.billable_hours, 1)} billable (${fmt.pct(s.billable_pct)})`)}
    ${sc('Estimates', `${s.estimates_won}/${s.estimates_sent}`, `won · ${fmt.money0(s.estimates_won_value)} · win rate ${fmt.pct(s.win_rate)}`)}${sc('New customers', fmt.num(s.new_customers), `${s.new_requests} requests · ${s.requests_converted} converted`)}
  </div></div>
  <div class="grid g-main mt">
    <div class="card"><div class="card-h"><h2>Revenue, collections & costs</h2><span class="muted">12 months</span></div><div class="card-b">${groupedBars(rev.map(x => ({ label: fmt.month(x.period), values: [x.invoiced, x.collected, round2(x.labor_cost + x.expenses)] })), [{ name: 'Invoiced', color: C.s1 }, { name: 'Collected', color: C.s3 }, { name: 'Labor + expenses', color: C.s2 }], { fmtV: v => fmt.money0(v), fmtAxis: kfmt })}</div></div>
    <div class="card"><div class="card-h"><h2>Profit by job type</h2></div><div class="card-b flush">${table(prof.by_type, [{ label: 'Type', render: x => `<span class="tag">${e(x.type)}</span>` }, { label: 'Jobs', num: 1, render: x => x.jobs }, { label: 'Revenue', num: 1, render: x => fmt.money0(x.revenue) }, { label: 'Margin', num: 1, render: x => fmt.pct(x.margin_pct) }], { compact: 1, empty: 'No completed jobs in this period.' })}
      <div class="tbl-foot">${prof.totals.jobs} jobs · ${fmt.money0(prof.totals.revenue)} revenue · ${fmt.money0(prof.totals.profit)} profit (${fmt.pct(prof.totals.margin_pct)})</div></div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><div class="card-h"><h2>Most profitable jobs</h2></div><div class="card-b flush">${jobProfitTable([...prof.jobs].sort((a, b) => b.profit - a.profit).slice(0, 8))}</div></div>
    <div class="card"><div class="card-h"><h2>Least profitable jobs</h2></div><div class="card-b flush">${jobProfitTable([...prof.jobs].sort((a, b) => a.profit - b.profit).slice(0, 8))}</div></div>
  </div>
  <div class="card mt"><div class="card-h"><h2>${icon('users')} Team & AI staff</h2></div><div class="card-b flush">${table(team, [
    { label: 'Name', render: u => `${avatar(u)} ${e(u.name)} ${u.kind === 'ai' ? '<span class="tag ai">AI</span>' : ''}` }, { label: 'Hours', num: 1, render: u => fmt.num(u.hours, 1) }, { label: 'Billable', num: 1, render: u => fmt.num(u.billable_hours, 1) },
    { label: 'Billable %', num: 1, render: u => fmt.pct(u.billable_pct) }, { label: 'Billable value', num: 1, hideM: 1, render: u => fmt.money0(u.billable_value) }, { label: 'Visits done', num: 1, render: u => u.visits_completed },
    { label: 'Tasks done', num: 1, render: u => u.tasks_done }, { label: 'API calls', num: 1, hideM: 1, render: u => u.api_calls || '' }
  ], { compact: 1 })}</div></div>
  <div class="grid g3 mt">
    <div class="card"><div class="card-h"><h2>Estimate pipeline</h2><span class="muted">win rate ${fmt.pct(pipe.win_rate)}</span></div><div class="card-b">${hBars(pipe.estimates_by_status.map(x => ({ label: LABELS.estimate[x.status] || x.status, n: x.v, tip: `${x.n} estimates` })), { fmtV: v => fmt.money0(v) })}</div></div>
    <div class="card"><div class="card-h"><h2>Requests by source</h2></div><div class="card-b">${hBars(pipe.requests_by_source.map(x => ({ label: cap(x.source), n: x.n, tip: `${x.converted} converted` })), { color: C.s2 })}</div></div>
    <div class="card"><div class="card-h"><h2>New customers by source</h2></div><div class="card-b">${hBars(custs.sources.map(x => ({ label: cap(x.source), n: x.customers })), { color: C.s3 })}</div></div>
  </div>
  <div class="grid g2 mt">
    <div class="card"><div class="card-h"><h2>Top customers</h2></div><div class="card-b flush">${table(custs.top.slice(0, 10), [{ label: 'Customer', render: c => `<a href="#/customers/${c.id}">${e(c.name)}</a>` }, { label: 'Invoices', num: 1, render: c => c.invoices }, { label: 'Revenue', num: 1, render: c => fmt.money0(c.revenue) }, { label: 'Owes', num: 1, render: c => c.balance ? fmt.money0(c.balance) : '—' }], { compact: 1, empty: 'No invoices in this period.' })}</div></div>
    <div class="card" id="ar"><div class="card-h"><h2>Receivables aging</h2><span class="muted">${fmt.money0(aging.totals.total)}</span></div><div class="card-b flush">${table(aging.customers, [{ label: 'Customer', render: c => `<a href="#/customers/${c.customer_id}">${e(c.customer_name)}</a>` }, { label: 'Current', num: 1, render: c => c.current ? fmt.money0(c.current) : '' }, { label: '1-30', num: 1, render: c => c.d1_30 ? fmt.money0(c.d1_30) : '' }, { label: '31-60', num: 1, render: c => c.d31_60 ? fmt.money0(c.d31_60) : '' }, { label: '61-90', num: 1, render: c => c.d61_90 ? fmt.money0(c.d61_90) : '' }, { label: '90+', num: 1, render: c => c.d90_plus ? `<b class="overdue-flag">${fmt.money0(c.d90_plus)}</b>` : '' }, { label: 'Total', num: 1, render: c => `<b>${fmt.money0(c.total)}</b>` }], { compact: 1, empty: 'Nobody owes you money.' })}</div></div>
  </div>
  <div class="card mt"><div class="card-h"><h2>Monthly KPI history</h2><span class="muted">snapshots refresh automatically</span></div><div class="card-b flush">${table([...kpis].reverse(), [
    { label: 'Month', render: k => fmt.month(k.period) }, { label: 'Revenue', num: 1, render: k => fmt.money0(k.revenue) }, { label: 'Collected', num: 1, render: k => fmt.money0(k.collected) }, { label: 'Jobs', num: 1, render: k => k.jobs_completed },
    { label: 'Hours', num: 1, hideM: 1, render: k => fmt.num(k.hours, 1) }, { label: 'Billable %', num: 1, hideM: 1, render: k => fmt.pct(k.billable_pct) }, { label: 'Gross profit', num: 1, render: k => fmt.money0(k.gross_profit) }, { label: 'Win rate', num: 1, hideM: 1, render: k => fmt.pct(k.win_rate) }
  ], { compact: 1, empty: 'History builds automatically as you work.' })}</div></div>
  <div class="card mt"><div class="card-h"><h2>${icon('download')} Exports</h2><span class="muted">CSV for your accountant or QuickBooks import</span></div><div class="card-b row">${['customers', 'jobs', 'visits', 'estimates', 'invoices', 'payments', 'time', 'expenses'].map(k => `<a class="btn sm" href="/api/export/${k}.csv">${icon('download')}${cap(k)}</a>`).join('')}</div></div>`;
  $$('[data-p]', view).forEach(b => b.onclick = () => { REP.period = b.dataset.p; router(); });
  const rf = $('#rFrom'); if (rf) { rf.onchange = () => { REP.from = rf.value; router(); }; $('#rTo').onchange = () => { REP.to = $('#rTo').value; router(); }; }
  $('#rPrint').onclick = () => window.print();
  $$('[data-jp]', view).forEach(tr => tr.onclick = () => (location.hash = '#/jobs/' + tr.dataset.jp));
  if (r.q.tab === 'ar') setTimeout(() => $('#ar').scrollIntoView(), 50);
};
const round2 = n => Math.round(n * 100) / 100;
const jobProfitTable = rows => rows.length ? `<div class="tbl-wrap"><table class="tbl compact"><thead><tr><th>Job</th><th class="num">Revenue</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead><tbody>${rows.map(j => `<tr class="click" data-jp="${j.id}"><td><span class="code">${e(j.number)}</span> ${e(j.title)}<div class="sub">${e(j.customer_name)}</div></td><td class="num">${fmt.money0(j.revenue)}</td><td class="num" style="color:${j.profit >= 0 ? 'var(--good-ink)' : 'var(--crit-ink)'}">${fmt.money0(j.profit)}</td><td class="num">${fmt.pct(j.margin_pct)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No completed jobs in this period.</div>';
