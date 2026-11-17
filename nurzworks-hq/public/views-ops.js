/* NurzWorks HQ - operations: dashboard, schedule, my day (field), jobs, visits, requests, service plans */
'use strict';

// ======================= DASHBOARD =======================
VIEWS.dashboard = async view => {
  const d = await api('/api/dashboard');
  const k = d.kpis, lm = d.last_month, C = CH(), c = d.counts;
  const h = parts(new Date().toISOString()).h;
  const hello = `${h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${e(S.me.name.split(' ')[0])}`;
  const delta = (cur, prev, goodUp = true, money = true) => {
    if (cur == null || prev == null || !prev) return '<span class="delta flat">vs last month: —</span>';
    const diff = cur - prev; if (Math.abs(diff) < 0.5) return '<span class="delta flat">same as last month</span>';
    const good = goodUp ? diff > 0 : diff < 0;
    return `<span class="delta ${good ? 'good' : 'bad'}">${diff > 0 ? '▲' : '▼'} ${money ? fmt.money0(Math.abs(diff)) : fmt.num(Math.abs(diff), 1)}</span><span>vs same days last month</span>`;
  };
  const kpi = (lbl, val, foot, { href, bar, meter } = {}) => `<div class="kpi ${href ? 'link' : ''}" ${href ? `data-href="${href}"` : ''}>${bar ? `<span class="bar" style="background:${bar}"></span>` : ''}
    <div class="lbl">${lbl}</div><div class="val">${val}</div>${meter !== undefined ? `<div class="meter"><span style="width:${Math.min(100, meter || 0)}%;background:${(meter || 0) >= 70 ? 'var(--good)' : (meter || 0) >= 50 ? 'var(--warn)' : 'var(--crit)'}"></span></div>` : ''}<div class="foot">${foot}</div></div>`;
  const notice = S.meta.is_empty && can('admin') ? `<div class="notice">${icon('database')}<span>Your HQ is empty. Load realistic sample data to explore every feature, then remove it in one click from Settings - or start by adding your first customer.</span><button class="btn sm" id="loadDemo">Load sample data</button><button class="btn sm" id="firstCust">Add a customer</button></div>` : '';
  const gerr = S.meta.integrations.google_error && can('admin') ? `<div class="notice warn">${icon('alert')}<span>${e(S.meta.integrations.google_error)}</span><a class="btn sm" href="#/integrations">Fix</a></div>` : '';
  const visitRow = v => `<li class="click" data-visit="${v.id}"><span class="time">${fmt.time(v.start_at).replace(' ', ' ')}</span><div class="grow"><div class="t">${e(v.job_title)}</div><div class="s">${e(v.customer_name)}${v.city ? ' · ' + e(v.city) : ''} · ${v.assignees.map(a => e(a.name.split(' ')[0])).join(', ') || 'Unassigned'}</div></div>${pill('visit', v.status)}</li>`;
  const jobRow = j => `<li class="click" data-href="#/jobs/${j.id}"><div class="grow"><div class="t">${e(j.title)}</div><div class="s">${e(j.number)} · ${e(j.customer_name)}${j.city ? ' · ' + e(j.city) : ''}</div></div>${priPill(j.priority)}</li>`;
  view.innerHTML = `
  <div class="page-head"><div><h1>${hello}</h1><div class="sub">${fmt.dateLong(d.today)} · ${e(S.meta.company.name)}</div></div>
    <div class="actions">${can('office') ? `<button class="btn" id="dNewJob">${icon('plus')}New job</button>` : ''}<a class="btn" href="#/schedule">${icon('cal')}Schedule</a>${can('books') ? `<a class="btn" href="#/reports">${icon('chart')}Reports</a>` : ''}</div></div>
  ${gerr}${notice}
  ${k ? `<div class="kpis">
    ${kpi('Revenue (MTD)', fmt.money0(k.revenue), delta(k.revenue, lm.revenue), { href: '#/reports', bar: 'var(--primary)' })}
    ${kpi('Collected (MTD)', fmt.money0(k.collected), delta(k.collected, lm.collected), { href: '#/invoices?tab=payments', bar: 'var(--good)' })}
    ${kpi('Receivables', fmt.money0(k.outstanding), k.overdue ? `<span class="delta bad">${fmt.money0(k.overdue)} overdue</span>` : '<span class="delta good">nothing overdue</span>', { href: '#/invoices?tab=unpaid', bar: k.overdue ? 'var(--crit)' : 'var(--good)' })}
    ${kpi("Today's visits", fmt.num(d.visits_today.length), `${c.in_progress} job${c.in_progress === 1 ? '' : 's'} in progress`, { href: '#/schedule?view=day' })}
    ${kpi('Needs scheduling', fmt.num(c.unscheduled), c.unscheduled ? '<span class="delta bad">jobs waiting</span>' : '<span class="delta good">all booked</span>', { href: '#/jobs?tab=unscheduled', bar: c.unscheduled ? 'var(--warn)' : '' })}
    ${kpi('Ready to invoice', fmt.num(c.to_invoice), c.to_invoice ? 'completed jobs' : 'all billed', { href: '#/jobs?tab=to_invoice', bar: c.to_invoice ? 'var(--warn)' : '' })}
    ${kpi('Open estimates', fmt.money0(c.open_estimates_value), `${c.open_estimates} awaiting an answer`, { href: '#/estimates?tab=sent' })}
    ${kpi('Billable hours (MTD)', fmt.num(k.billable_hours, 1) + '<small>h</small>', `${fmt.pct(k.billable_pct)} of ${fmt.num(k.hours, 1)} h logged`, { meter: k.billable_pct, href: '#/time' })}
    ${kpi('Jobs completed (MTD)', fmt.num(k.jobs_completed), k.avg_invoice ? `avg invoice ${fmt.money0(k.avg_invoice)}` : 'this month', { href: '#/jobs?tab=completed' })}
    ${kpi('New requests', fmt.num(c.new_requests), c.new_requests ? '<span class="delta bad">respond today</span>' : 'inbox clear', { href: '#/requests', bar: c.new_requests ? 'var(--warn)' : '' })}
  </div>` : ''}
  <div class="grid g-main">
    <div class="card"><div class="card-h"><h2>${icon('today')} Today's schedule</h2><span class="muted">${d.visits_today.length} visit${d.visits_today.length === 1 ? '' : 's'}</span><a class="right small" href="#/schedule?view=day">Open schedule</a></div>
      <div class="card-b flush">${d.visits_today.length ? `<ul class="list">${d.visits_today.map(visitRow).join('')}</ul>` : '<div class="empty">Nothing booked today.</div>'}
      ${d.running_timers.length ? `<div class="tbl-foot">${icon('clock')} On the clock: ${d.running_timers.map(t => `<b>${e(t.user_name)}</b> ${t.job_number ? e(t.job_number) : ''} (${fmt.dur(Date.now() - new Date(t.started_at))})`).join(' · ')}</div>` : ''}</div></div>
    ${d.revenue ? `<div class="card"><div class="card-h"><h2>Revenue</h2><span class="muted">last 6 months</span></div><div class="card-b">${groupedBars(d.revenue.map(r => ({ label: fmt.month(r.period), values: [r.invoiced, r.collected] })), [{ name: 'Invoiced', color: C.s1 }, { name: 'Collected', color: C.s3 }], { fmtV: v => fmt.money0(v), fmtAxis: kfmt, height: 230, w: 380 })}</div></div>`
      : `<div class="card"><div class="card-h"><h2>${icon('task')} My tasks</h2><a class="right small" href="#/tasks">All tasks</a></div><div class="card-b flush">${taskMini(d.tasks)}</div></div>`}
  </div>
  <div class="grid g3 mt">
    <div class="card"><div class="card-h"><h2>${icon('alert')} Needs scheduling</h2><a class="right small" href="#/schedule">Schedule</a></div><div class="card-b flush">${d.unscheduled.length ? `<ul class="list">${d.unscheduled.map(jobRow).join('')}</ul>` : '<div class="empty">Every job is scheduled.</div>'}</div></div>
    ${d.to_invoice ? `<div class="card"><div class="card-h"><h2>${icon('inv')} Ready to invoice</h2><a class="right small" href="#/jobs?tab=to_invoice">View all</a></div><div class="card-b flush">${d.to_invoice.length ? `<ul class="list">${d.to_invoice.map(j => `<li class="click" data-href="#/jobs/${j.id}"><div class="grow"><div class="t">${e(j.title)}</div><div class="s">${e(j.number)} · ${e(j.customer_name)} · done ${fmt.rel(j.completed_at)}</div></div><b>${fmt.money0(j.items_total)}</b></li>`).join('')}</ul>` : '<div class="empty">All completed work is billed.</div>'}</div></div>` : ''}
    ${d.overdue ? `<div class="card"><div class="card-h"><h2>${icon('flag')} Overdue invoices</h2><a class="right small" href="#/invoices?tab=overdue">View all</a></div><div class="card-b flush">${d.overdue.length ? `<ul class="list">${d.overdue.map(i => `<li class="click" data-href="#/invoices/${i.id}"><div class="grow"><div class="t">${e(i.customer_name)}</div><div class="s">${e(i.number)} · ${i.days_overdue} days late</div></div><b class="overdue-flag">${fmt.money0(i.balance)}</b></li>`).join('')}</ul>` : '<div class="empty">Nothing overdue. Nice.</div>'}</div></div>`
      : `<div class="card"><div class="card-h"><h2>${icon('inbox')} New requests</h2></div><div class="card-b flush">${reqMini(d.requests)}</div></div>`}
  </div>
  ${d.revenue ? `<div class="grid g3 mt">
    <div class="card"><div class="card-h"><h2>${icon('task')} Tasks</h2><span class="muted">yours first</span><a class="right small" href="#/tasks">All tasks</a></div><div class="card-b flush">${taskMini(d.tasks)}</div></div>
    <div class="card"><div class="card-h"><h2>${icon('inbox')} New requests</h2><a class="right small" href="#/requests">Review</a></div><div class="card-b flush">${reqMini(d.requests)}</div></div>
    <div class="card"><div class="card-h"><h2>${icon('est')} Estimates awaiting answer</h2><a class="right small" href="#/estimates?tab=sent">All</a></div><div class="card-b flush">${d.awaiting.length ? `<ul class="list">${d.awaiting.map(x => `<li class="click" data-href="#/estimates/${x.id}"><div class="grow"><div class="t">${e(x.title)}</div><div class="s">${e(x.number)} · ${e(x.customer_name)} · sent ${fmt.rel(x.sent_at)}${x.viewed_at ? ' · viewed' : ''}</div></div><b>${fmt.money0(x.total)}</b></li>`).join('')}</ul>` : '<div class="empty">No estimates waiting.</div>'}</div></div>
  </div>
  <div class="grid g-main mt">
    <div class="card"><div class="card-h"><h2>Jobs completed per week</h2><span class="muted">last 12 weeks</span></div><div class="card-b">${groupedBars(d.weeks.map(w => ({ label: fmt.date(w.week).replace(/, \d{4}/, ''), tip: 'Week of ' + fmt.date(w.week), values: [w.completed, w.visits] })), [{ name: 'Jobs completed', color: C.s1 }, { name: 'Visits completed', color: C.s2 }], { height: 190 })}</div></div>
    <div class="card"><div class="card-h"><h2>Receivables aging</h2><a class="right small" href="#/reports?tab=ar">Details</a></div><div class="card-b">${hBars(d.aging.map((a, i) => ({ label: a.label, n: a.v, color: [C.s3, C.warn, C.s2, C.crit][i], href: '#/invoices?tab=unpaid' })), { fmtV: v => fmt.money0(v) })}
      ${d.payments.length ? `<div class="k-label mt">Recent payments</div><ul class="list" style="margin:4px -16px -14px">${d.payments.map(p => `<li class="click" data-href="#/invoices/${p.invoice_id}"><div class="grow"><div class="t">${e(p.customer_name)}</div><div class="s">${e(p.invoice_number || '')} · ${e(p.method)} · ${fmt.date(p.received_on)}</div></div><b style="color:var(--good-ink)">${fmt.money(p.amount)}</b></li>`).join('')}</ul>` : ''}</div></div>
  </div>` : ''}
  <div class="muted small mt">KPIs refresh after every change. Service plans generate jobs automatically; Gmail, Calendar and Slack sync in the background.</div>`;
  bindVisitClicks(view);
  const ld = $('#loadDemo'); if (ld) ld.onclick = async () => { ld.disabled = true; ld.textContent = 'Loading…'; await POST('/api/demo/load'); invalidateCustomers(); toast('Sample data loaded'); refresh(); };
  const fc = $('#firstCust'); if (fc) fc.onclick = () => customerForm();
  const nj = $('#dNewJob'); if (nj) nj.onclick = () => jobForm();
};
const taskMini = rows => rows.length ? `<ul class="list">${rows.map(t => `<li class="click" data-href="#/tasks?id=${t.id}">${avatar(userById(t.assigned_to)) || `<span class="avatar sm" style="background:var(--muted-soft);color:var(--ink-3)">?</span>`}<div class="grow"><div class="t">${e(t.title)}</div><div class="s">${e(t.assignee || 'Unassigned')}${t.due_date ? ' · due ' + fmt.dueIn(t.due_date) : ''}</div></div>${t.due_date && t.due_date < todayStr() ? `<span class="overdue-flag">${icon('alert')}</span>` : priPill(t.priority)}</li>`).join('')}</ul>` : '<div class="empty">No open tasks.</div>';
const reqMini = rows => rows.length ? `<ul class="list">${rows.map(r => `<li class="click" data-href="#/requests/${r.id}"><div class="grow"><div class="t">${e(r.name)}${r.service ? ' - ' + e(r.service) : ''}</div><div class="s">${e(r.number)} · via ${e(r.source)} · ${fmt.rel(r.created_at)}</div></div>${priPill(r.priority)}</li>`).join('')}</ul>` : '<div class="empty">No new requests.</div>';
function bindVisitClicks(root) { $$('[data-visit]', root).forEach(el => el.addEventListener('click', ev => { if (ev.target.closest('a,button')) return; visitModal(+el.dataset.visit); })); }

// ======================= SCHEDULE =======================
const SCH = (() => { let s = {}; try { s = JSON.parse(localStorage.getItem('nw_sched') || '{}'); } catch (_) { /* default */ } return { view: s.view || 'week', user: s.user || '', gcal: s.gcal !== false, date: null }; })();
const saveSch = () => { try { localStorage.setItem('nw_sched', JSON.stringify({ view: SCH.view, user: SCH.user, gcal: SCH.gcal })); } catch (_) { /* ignore */ } };
const fieldTeam = () => S.meta.team.filter(u => u.kind === 'human' && u.role !== 'viewer');
const mondayOf = d => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
VIEWS.schedule = async (view, r) => {
  if (r.q.view) SCH.view = r.q.view;
  if (r.q.date) SCH.date = r.q.date;
  if (!SCH.date) SCH.date = todayStr();
  if (window.innerWidth < 700 && SCH.view === 'week' && !r.q.view) SCH.view = 'day';
  const v = SCH.view; const d = SCH.date;
  let from = d, to = d;
  if (v === 'week') { from = mondayOf(d); to = addDays(from, 6); }
  if (v === 'month') { const first = d.slice(0, 8) + '01'; from = mondayOf(first); to = addDays(from, 41); }
  if (v === 'list') { to = addDays(d, 13); }
  const userQ = S.me.role === 'field' && !SCH.user ? S.me.id : SCH.user;
  const [visits, cal, uns] = await Promise.all([
    api('/api/visits' + qs({ from, to, user_id: userQ })),
    S.meta.integrations.gcal && SCH.gcal ? api('/api/calendar/events' + qs({ from, to })).catch(() => ({ events: [] })) : { events: [] },
    can('office') ? api('/api/jobs?status=unscheduled&sort=priority') : []
  ]);
  const title = v === 'day' ? fmt.dateLong(d) : v === 'week' ? `${fmt.date(from)} - ${fmt.date(to)}` : v === 'month' ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : `${fmt.date(from)} - ${fmt.date(to)}`;
  const step = v === 'day' ? 1 : v === 'week' ? 7 : v === 'list' ? 14 : 0;
  view.innerHTML = `
  <div class="page-head"><div><h1>Schedule</h1><div class="sub">${visits.length} visit${visits.length === 1 ? '' : 's'}${S.meta.integrations.gcal ? ' · Google Calendar synced' : ''}</div></div>
    <div class="actions">${can('office') ? `<button class="btn primary" id="sNew">${icon('plus')}Schedule visit</button>` : ''}</div></div>
  <div class="cal-wrap">
    <div class="card">
      <div class="cal-tools">
        <button class="icon-btn" id="sPrev" aria-label="Previous">${icon('chevL')}</button><button class="btn sm" id="sToday">Today</button><button class="icon-btn" id="sNext" aria-label="Next">${icon('chevron')}</button>
        <span class="date">${e(title)}</span><span style="flex:1"></span>
        ${S.me.role !== 'field' ? `<select class="inp" id="sUser" style="width:auto;height:30px">${opt([['', 'Whole crew'], ...fieldTeam().map(u => [u.id, u.name])], SCH.user)}</select>` : ''}
        ${S.meta.integrations.gcal ? `<label class="check small"><input type="checkbox" id="sG" ${SCH.gcal ? 'checked' : ''}>Google busy</label>` : ''}
        <div class="seg">${[['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['list', 'List']].map(([k, l]) => `<button data-v="${k}" class="${v === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div id="calBody">${v === 'month' ? monthGrid(from, d, visits) : v === 'list' ? agenda(from, to, visits, cal.events) : timeGrid(v, from, to, visits, cal.events)}</div>
    </div>
    ${can('office') ? `<div class="card"><div class="card-h"><h2>${icon('alert')} To schedule</h2><span class="muted">${uns.length}</span></div><div class="unsched">${uns.length ? uns.map(j => `<div class="job" data-sched-job="${j.id}"><div class="t">${e(j.title)}</div><div class="small muted">${e(j.number)} · ${e(j.customer_name)}${j.city ? ' · ' + e(j.city) : ''}</div><div class="row mt-s">${priPill(j.priority)}<span class="small muted">${fmt.rel(j.created_at)}</span></div></div>`).join('') : '<div class="empty">Nothing waiting.</div>'}</div></div>` : ''}
  </div>`;
  const go = nd => { SCH.date = nd; location.hash = '#/schedule?date=' + nd + '&view=' + SCH.view; };
  $('#sPrev').onclick = () => go(v === 'month' ? addMonths(d, -1) : addDays(d, -step));
  $('#sNext').onclick = () => go(v === 'month' ? addMonths(d, 1) : addDays(d, step));
  $('#sToday').onclick = () => go(todayStr());
  $$('.seg [data-v]', view).forEach(b => b.onclick = () => { SCH.view = b.dataset.v; saveSch(); location.hash = '#/schedule?date=' + d + '&view=' + SCH.view; });
  const su = $('#sUser'); if (su) su.onchange = () => { SCH.user = su.value; saveSch(); router(); };
  const sg = $('#sG'); if (sg) sg.onchange = () => { SCH.gcal = sg.checked; saveSch(); router(); };
  const sn = $('#sNew'); if (sn) sn.onclick = () => scheduleVisitForm(null, { date: d });
  $$('[data-sched-job]', view).forEach(el => el.onclick = async () => scheduleVisitForm(await api('/api/jobs/' + el.dataset.schedJob)));
  $$('[data-day]', view).forEach(el => el.onclick = ev => { if (ev.target.closest('.mev')) return; SCH.view = 'day'; go(el.dataset.day); });
  bindVisitClicks(view);
  bindGrid(view);
};
const addMonths = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const visitColor = v => (v.assignees[0] && v.assignees[0].color) || 'var(--ink-3)';
const VS_ICON = { en_route: '🚚', on_site: '📍', completed: '✓' };
function timeGrid(mode, from, to, visits, gevents) {
  const ws = S.meta.settings.workday_start || '08:00', we = S.meta.settings.workday_end || '17:00';
  const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  let startM = toMin(ws) - 60, endM = toMin(we) + 60;
  for (const x of visits) { const a = parts(x.start_at), b = parts(x.end_at); if (a.date >= from) startM = Math.min(startM, a.min - 30); if (b.date <= to) endM = Math.max(endM, (b.min || 1440) + 30); }
  startM = Math.max(0, Math.floor(startM / 60) * 60); endM = Math.min(1440, Math.ceil(endM / 60) * 60);
  const ppm = 0.9, H = (endM - startM) * ppm, today = todayStr();
  let cols;
  if (mode === 'day') {
    const team = SCH.user ? fieldTeam().filter(u => String(u.id) === String(SCH.user)) : fieldTeam();
    cols = team.map(u => ({ key: 'u' + u.id, label: `${avatar(u)} ${e(u.name.split(' ')[0])}`, date: from, user: u.id, today: from === today }));
    if (visits.some(x => !x.assignees.length)) cols.push({ key: 'none', label: 'Unassigned', date: from, user: null, today: from === today });
  } else {
    cols = []; for (let i = 0; i < 7; i++) { const dd = addDays(from, i); cols.push({ key: dd, label: `${weekday(dd)} ${+dd.slice(8)}`, date: dd, user: null, today: dd === today }); }
  }
  const colFor = (x, dd) => mode === 'day' ? cols.filter(c => (c.user ? x.assignees.some(a => a.id === c.user) : !x.assignees.length)) : cols.filter(c => c.date === dd);
  const blocks = Object.fromEntries(cols.map(c => [c.key, []]));
  for (const x of visits) {
    const a = parts(x.start_at), b = parts(x.end_at);
    for (let dd = a.date; dd <= b.date && dd <= to; dd = addDays(dd, 1)) {
      if (dd < from) continue;
      const s = dd === a.date ? a.min : 0, en = dd === b.date ? b.min : 1440;
      for (const c of colFor(x, dd)) blocks[c.key].push({ x, s, en, kind: 'visit' });
    }
  }
  const owner = S.meta.team.find(u => u.role === 'owner');
  for (const g of gevents || []) {
    if (g.all_day) continue;
    const a = parts(g.start_at), b = parts(g.end_at);
    const targets = mode === 'day' ? cols.filter(c => owner && c.user === owner.id) : cols.filter(c => c.date === a.date);
    for (const c of targets) blocks[c.key].push({ g, s: a.min, en: a.date === b.date ? b.min : 1440, kind: 'busy' });
  }
  const tmpl = `56px repeat(${cols.length}, minmax(${mode === 'day' ? 140 : 100}px, 1fr))`;
  const nowP = parts(new Date().toISOString());
  let html = `<div class="cal"><div class="cal-head" style="grid-template-columns:${tmpl}"><div></div>${cols.map(c => `<div class="${c.today ? 'today' : ''}">${c.label}</div>`).join('')}</div>
    <div class="cal-body" data-start="${startM}" style="grid-template-columns:${tmpl};height:${H}px"><div class="cal-times">${Array.from({ length: (endM - startM) / 60 - 1 }, (_, i) => `<span style="top:${(i + 1) * 60 * ppm}px">${fmtHour(startM / 60 + i + 1)}</span>`).join('')}</div>`;
  for (const c of cols) {
    html += `<div class="cal-col ${c.today ? 'today' : ''}" data-col-date="${c.date}" data-col-user="${c.user || ''}" style="height:${H}px">`;
    for (let m = startM; m < endM; m += 30) html += `<div class="slot ${m % 60 ? 'half' : ''}" style="top:${(m - startM) * ppm}px"></div>`;
    html += `<div class="off" style="top:0;height:${Math.max(0, (toMin(ws) - startM) * ppm)}px"></div><div class="off" style="top:${(toMin(we) - startM) * ppm}px;bottom:0"></div>`;
    if (c.today && nowP.min >= startM && nowP.min <= endM) html += `<div class="cal-now" style="top:${(nowP.min - startM) * ppm}px"></div>`;
    const items = blocks[c.key].sort((p, q) => p.s - q.s);
    const lanes = []; // overlap layout
    for (const it of items) { let li = lanes.findIndex(end => end <= it.s); if (li < 0) { li = lanes.length; lanes.push(0); } lanes[li] = it.en; it.lane = li; }
    for (const it of items) {
      const group = items.filter(o => o.s < it.en && o.en > it.s); const n = Math.max(...group.map(o => o.lane)) + 1;
      const top = (Math.max(it.s, startM) - startM) * ppm, h = Math.max(20, (Math.min(it.en, endM) - Math.max(it.s, startM)) * ppm - 2);
      const left = `calc(${(100 / n) * it.lane}% + 2px)`, width = `calc(${100 / n}% - 4px)`;
      if (it.kind === 'busy') html += `<div class="ev busy" style="top:${top}px;height:${h}px;left:${left};width:${width}" data-tip="${e(`<b>Google Calendar</b><div>${e(it.g.summary || 'Busy')}</div><div>${fmt.time(it.g.start_at)} - ${fmt.time(it.g.end_at)}</div>`)}"><b>${e(it.g.summary || 'Busy')}</b><span class="s">Google Calendar</span></div>`;
      else {
        const x = it.x;
        html += `<div class="ev st-${x.status}" data-visit="${x.id}" data-drag="${can('office') && !['completed', 'cancelled'].includes(x.status) ? 1 : 0}" data-dur="${(new Date(x.end_at) - new Date(x.start_at)) / 60000}" style="top:${top}px;height:${h}px;left:${left};width:${width};background:${visitColor(x)}"
          data-tip="${e(`<b>${e(x.job_number)} ${e(x.job_title)}</b><div>${e(x.customer_name)}</div><div>${fmt.time(x.start_at)} - ${fmt.time(x.end_at)}</div><div>${e(x.address || '')}</div><div>${x.assignees.map(a => e(a.name)).join(', ') || 'Unassigned'} · ${e(LABELS.visit[x.status])}</div>`)}">
          ${VS_ICON[x.status] ? `<span class="st-ico">${VS_ICON[x.status]}</span>` : ''}<b>${fmt.time(x.start_at)} ${e(x.customer_name)}</b><span class="s">${e(x.job_title)}</span>${h > 50 ? `<span class="s">${e(x.city || '')}${mode !== 'day' && x.assignees.length ? ' · ' + x.assignees.map(a => e(a.name.split(' ')[0])).join(', ') : ''}</span>` : ''}</div>`;
      }
    }
    html += '</div>';
  }
  return html + '</div></div>';
}
const fmtHour = h => h === 0 || h === 24 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`;
// drag to reschedule (desktop & touch); click empty space to book
function bindGrid(root) {
  const body = $('.cal-body', root); if (!body) return;
  const ppm = 0.9;
  const gridStart = Number(body.dataset.start || 0);
  const minsAt = (col, clientY) => Math.round((gridStart + (clientY - col.getBoundingClientRect().top) / ppm) / 15) * 15;
  const hm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  $$('.cal-col', root).forEach(col => col.addEventListener('click', ev => {
    if (ev.target.closest('.ev') || !can('office')) return;
    const m = Math.floor(minsAt(col, ev.clientY) / 30) * 30;
    scheduleVisitForm(null, { date: col.dataset.colDate, time: hm(m), user: col.dataset.colUser });
  }));
  $$('.ev[data-drag="1"]', root).forEach(ev0 => {
    ev0.addEventListener('pointerdown', down => {
      if (down.button !== 0) return;
      const startY = down.clientY, startX = down.clientX; let moved = false; const origTop = parseFloat(ev0.style.top);
      const move = mv => {
        if (!moved && Math.abs(mv.clientY - startY) + Math.abs(mv.clientX - startX) < 6) return;
        moved = true; ev0.classList.add('dragging'); ev0.style.top = (origTop + mv.clientY - startY) + 'px'; ev0.style.transform = `translateX(${mv.clientX - startX}px)`;
      };
      const up = async upEv => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
        if (!moved) return; // treated as click
        upEv.preventDefault();
        const col = document.elementsFromPoint(upEv.clientX, upEv.clientY).map(x => x.closest && x.closest('.cal-col')).find(Boolean);
        if (!col) return rerender();
        const top = parseFloat(ev0.style.top);
        const m = Math.round((gridStart + top / ppm) / 15) * 15;
        const dur = +ev0.dataset.dur;
        const body2 = { start: `${col.dataset.colDate}T${hm(Math.max(0, m))}`, duration_minutes: dur };
        if (col.dataset.colUser) body2.assignees = [Number(col.dataset.colUser)];
        try { const r = await PUT('/api/visits/' + ev0.dataset.visit, body2); toast(r.conflicts && r.conflicts.length ? `Moved - heads up: ${r.conflicts[0].message}` : `Moved to ${fmt.dt(r.start_at)}`, r.conflicts && r.conflicts.length ? 'error' : ''); } catch (err) { toast(err.message, 'error'); }
        rerender();
      };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
      ev0.addEventListener('click', ce => { if (moved) { ce.stopPropagation(); ce.preventDefault(); } }, { capture: true, once: true });
    });
  });
}
function monthGrid(from, cur, visits) {
  const month = cur.slice(0, 7), today = todayStr(); const by = {};
  for (const x of visits) (by[parts(x.start_at).date] ||= []).push(x);
  let html = `<div class="month">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dh">${d}</div>`).join('')}`;
  for (let i = 0; i < 42; i++) {
    const dd = addDays(from, i); const list = by[dd] || [];
    html += `<div class="day ${dd.slice(0, 7) !== month ? 'other' : ''} ${dd === today ? 'today' : ''}" data-day="${dd}"><span class="dn">${+dd.slice(8)}</span>
      ${list.slice(0, 4).map(x => `<div class="mev" data-visit="${x.id}"><i style="background:${visitColor(x)}"></i>${fmt.time(x.start_at).replace(':00', '').replace(' ', '')} ${e(x.customer_name)}</div>`).join('')}${list.length > 4 ? `<div class="muted">+${list.length - 4} more</div>` : ''}</div>`;
  }
  return html + '</div>';
}
function agenda(from, to, visits, gevents) {
  const by = {};
  for (const x of visits) (by[parts(x.start_at).date] ||= []).push({ t: x.start_at, html: `<li class="click" data-visit="${x.id}"><span class="time">${fmt.time(x.start_at)}</span><span class="swatch" style="background:${visitColor(x)}"></span><div class="grow"><div class="t">${e(x.job_number)} · ${e(x.job_title)}</div><div class="s">${e(x.customer_name)} · ${e(x.address || 'no address')} · ${x.assignees.map(a => e(a.name)).join(', ') || 'Unassigned'}</div></div>${pill('visit', x.status)}</li>` });
  for (const g of gevents || []) (by[parts(g.start_at).date] ||= []).push({ t: g.start_at, html: `<li><span class="time muted">${g.all_day ? 'All day' : fmt.time(g.start_at)}</span><span class="swatch" style="background:var(--line-strong)"></span><div class="grow"><div class="t muted">${e(g.summary || 'Busy')}</div><div class="s">Google Calendar</div></div></li>` });
  let html = ''; for (let dd = from; dd <= to; dd = addDays(dd, 1)) {
    const list = (by[dd] || []).sort((a, b) => a.t.localeCompare(b.t));
    if (!list.length) continue;
    html += `<div class="card-h" style="background:var(--card-3)"><h3>${fmt.dateLong(dd)}</h3></div><ul class="list">${list.map(x => x.html).join('')}</ul>`;
  }
  return html || '<div class="empty">Nothing scheduled in this period.</div>';
}

// ======================= SCHEDULE / VISIT FORMS =======================
async function scheduleVisitForm(job, preset = {}) {
  const team = fieldTeam();
  let jobs = job ? [job] : await api('/api/jobs?status=open&sort=priority');
  if (!job && !jobs.length) return toast('Create a job first - visits are scheduled for jobs.', 'error');
  const dur = Number(S.meta.settings.default_visit_minutes || 60);
  const assignee = preset.user || (job && job.assigned_to) || '';
  const res = await formModal({
    title: job ? `Schedule ${job.number}` : 'Schedule a visit', okLabel: 'Schedule',
    fields: [
      job ? { type: 'html', full: 1, html: `<div class="callout info">${icon('wo')}<div><b>${e(job.title)}</b><br>${e(job.customer_name)}${job.address ? ' · ' + e(job.address) : ''}</div></div>` }
        : { name: 'job_id', label: 'Job', type: 'select', options: jobs.map(j => [j.id, `${j.number} · ${j.title} - ${j.customer_name}`]), full: 1, required: 1 },
      { name: 'start', label: 'Start', type: 'datetime-local', value: `${preset.date || todayStr()}T${preset.time || '09:00'}`, required: 1 },
      { name: 'duration_minutes', label: 'Length', type: 'select', options: [[30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours'], [360, '6 hours'], [480, 'Full day (8 h)']], value: dur },
      { name: 'assignees', label: 'Crew', type: 'html', full: 1, html: `<div class="row">${team.map(u => `<label class="chip ${String(u.id) === String(assignee) ? 'on' : ''}"><input type="checkbox" data-crew value="${u.id}" ${String(u.id) === String(assignee) ? 'checked' : ''} hidden>${avatar(u)} ${e(u.name)}</label>`).join('')}</div>` },
      { name: 'notes', label: 'Notes for the crew', type: 'textarea', rows: 2, full: 1 },
      { type: 'html', full: 1, html: `<button class="btn sm" type="button" id="findSlot">${icon('search')}Find open slots</button><div id="slots" class="mt-s"></div>` }
    ],
    onMount: ctx => {
      $$('[data-crew]', ctx.el).forEach(c => c.closest('label').onclick = ev => { ev.preventDefault(); c.checked = !c.checked; c.closest('label').classList.toggle('on', c.checked); });
      $('#findSlot', ctx.el).onclick = async () => {
        const crew = $$('[data-crew]:checked', ctx.el).map(c => +c.value);
        const r = await api('/api/availability' + qs({ date_from: ($('[name=start]', ctx.el).value || '').slice(0, 10) || todayStr(), duration_minutes: $('[name=duration_minutes]', ctx.el).value, user_ids: crew.join(','), limit: 12 }));
        $('#slots', ctx.el).innerHTML = r.slots.length ? `<div class="row">${r.slots.map(s => `<button type="button" class="chip" data-slot="${e(localInput(s.start))}" data-u="${s.user_id}">${e(s.user_name.split(' ')[0])} · ${e(s.label)}</button>`).join('')}</div>` : '<span class="muted small">No open slots in the next week.</span>';
        $$('[data-slot]', ctx.el).forEach(b => b.onclick = () => { $('[name=start]', ctx.el).value = b.dataset.slot; $$('[data-crew]', ctx.el).forEach(c => { c.checked = c.value === b.dataset.u; c.closest('label').classList.toggle('on', c.checked); }); });
      };
    },
    save: async (v, ctx) => {
      const crew = $$('[data-crew]:checked', ctx.el).map(c => +c.value);
      const r = await POST(`/api/jobs/${job ? job.id : v.job_id}/visits`, { start: v.start, duration_minutes: +v.duration_minutes, assignees: crew, notes: v.notes });
      return r;
    }
  });
  if (res) { toast(res.conflicts && res.conflicts.length ? `Scheduled - conflict: ${res.conflicts[0].message}` : `Scheduled for ${fmt.dt(res.start_at)}`, res.conflicts && res.conflicts.length ? 'error' : ''); rerender(); }
}

async function visitModal(id) {
  const v = await api('/api/visits/' + id);
  const office = can('office'); const mine = v.assignees.some(a => a.id === S.me.id);
  const fieldOk = can('write') && (mine || office);
  const actions = [];
  if (fieldOk && v.status === 'scheduled') actions.push(`<button class="btn" data-vs="en_route">${icon('truck')}On my way</button>`);
  if (fieldOk && ['scheduled', 'en_route'].includes(v.status)) actions.push(`<button class="btn primary" data-vs="on_site">${icon('pin')}Arrived</button>`);
  if (fieldOk && ['en_route', 'on_site', 'scheduled'].includes(v.status)) actions.push(`<button class="btn good" data-vs="completed">${icon('check')}Complete</button>`);
  if (fieldOk && ['completed', 'cancelled'].includes(v.status)) actions.push(`<button class="btn" data-vs="scheduled">${icon('undo')}Reopen</button>`);
  const body = `
    <div class="row" style="margin-bottom:10px">${pill('visit', v.status)}<span class="muted">${fmt.dt(v.start_at)} - ${fmt.time(v.end_at)}</span></div>
    <div class="dl two">
      <div><div class="k">Job</div><div class="v"><a href="#/jobs/${v.job_id}" data-x>${e(v.job_number)} · ${e(v.job_title)}</a></div></div>
      <div><div class="k">Customer</div><div class="v"><a href="#/customers/${v.customer_id}" data-x>${e(v.customer_name)}</a></div></div>
      <div><div class="k">Address</div><div class="v">${v.address ? `<a href="${mapsUrl(v.address)}" target="_blank" rel="noopener">${icon('nav')} ${e(v.address)}</a>` : '—'}</div></div>
      <div><div class="k">Phone</div><div class="v">${v.customer_phone ? `<a href="${telUrl(v.customer_phone)}">${icon('phone')} ${e(v.customer_phone)}</a>` : '—'}</div></div>
      <div><div class="k">Crew</div><div class="v">${v.assignees.map(a => `${avatar(a)} ${e(a.name)}`).join('<br>') || 'Unassigned'}</div></div>
      <div><div class="k">Arrived / done</div><div class="v">${v.arrived_at ? fmt.time(v.arrived_at) : '—'} / ${v.completed_at ? fmt.time(v.completed_at) : '—'}</div></div>
    </div>
    ${v.access_notes ? `<div class="callout mt">${icon('key')}<div><b>Access:</b> ${e(v.access_notes)}</div></div>` : ''}
    ${v.notes ? `<div class="callout info mt">${icon('wo')}<div>${e(v.notes)}</div></div>` : ''}
    ${v.job_description ? `<div class="mt"><div class="k-label">Scope</div><div class="desc">${e(v.job_description)}</div></div>` : ''}
    ${v.completion_notes ? `<div class="callout good mt">${icon('check')}<div>${e(v.completion_notes)}</div></div>` : ''}
    ${v.checklist.length ? `<div class="mt"><div class="k-label">Checklist</div><ul class="checklist">${v.checklist.map((c, i) => `<li class="${c.done ? 'done' : ''}"><input type="checkbox" data-ck="${i}" ${c.done ? 'checked' : ''} ${fieldOk ? '' : 'disabled'}><span>${e(c.text)}</span></li>`).join('')}</ul></div>` : ''}
    <div class="mt"><div class="row"><span class="k-label">Photos & files</span>${fieldOk ? `<label class="btn sm" style="margin-left:auto">${icon('camera')}Add photo<input type="file" accept="image/*" capture="environment" multiple hidden id="vPhoto"></label>` : ''}</div><div class="mt-s" id="vPhotos">${photoGrid(v.attachments)}</div></div>
    ${v.customer_phone && fieldOk && v.status === 'scheduled' ? `<div class="mt"><a class="btn sm" href="${smsUrl(v.customer_phone, `Hi, this is ${S.me.name.split(' ')[0]} from ${S.meta.company.name}. I'm on my way and should arrive in about 20 minutes.`)}">${icon('sms')}Text "on my way"</a></div>` : ''}`;
  await modal({
    title: `Visit · ${v.job_number}`, size: 'wide', body,
    foot: `${office ? `<button class="btn left" id="vEdit">${icon('edit')}Reschedule</button><button class="btn danger" id="vCancel">${icon('ban')}Cancel visit</button>` : ''}${actions.join('')}<button class="btn" data-x>Close</button>`,
    onMount: ctx => {
      $$('[data-vs]', ctx.el).forEach(b => b.onclick = async () => {
        const st = b.dataset.vs;
        if (st === 'completed') { ctx.close(); return completeVisit(v); }
        b.disabled = true; const pos = st === 'on_site' || st === 'en_route' ? await getPos() : {};
        try { await POST(`/api/visits/${v.id}/status`, { status: st, ...pos }); toast(LABELS.visit[st]); ctx.close(); loadTimer(); rerender(); } catch (err) { toast(err.message, 'error'); b.disabled = false; }
      });
      $$('[data-ck]', ctx.el).forEach(c => c.onchange = () => POST(`/api/jobs/${v.job_id}/checklist`, { index: +c.dataset.ck, done: c.checked }).then(() => c.closest('li').classList.toggle('done', c.checked)));
      const ph = $('#vPhoto', ctx.el); if (ph) ph.onchange = async () => { for (const f of ph.files) { try { await upload('visit', v.id, f, { kind: 'photo' }); } catch (err) { toast(err.message, 'error'); } } const r = await api('/api/visits/' + v.id); $('#vPhotos', ctx.el).innerHTML = photoGrid(r.attachments); toast('Photo added'); };
      const ed = $('#vEdit', ctx.el); if (ed) ed.onclick = async () => { ctx.close(); editVisitForm(v); };
      const cn = $('#vCancel', ctx.el); if (cn) cn.onclick = async () => { if (await confirmBox('Cancel visit', 'Cancel this visit? It is removed from Google Calendar too.', 'Cancel visit', true)) { await POST(`/api/visits/${v.id}/status`, { status: 'cancelled' }); ctx.close(); toast('Visit cancelled'); rerender(); } };
    }
  });
}
async function editVisitForm(v) {
  const team = fieldTeam(); const ids = v.assignees.map(a => a.id);
  const r = await formModal({
    title: `Reschedule · ${v.job_number}`, okLabel: 'Save', size: 'narrow',
    fields: [{ name: 'start', label: 'Start', type: 'datetime-local', value: localInput(v.start_at), full: 1 }, { name: 'end', label: 'End', type: 'datetime-local', value: localInput(v.end_at), full: 1 },
      { name: 'crew', label: 'Crew', type: 'html', full: 1, html: team.map(u => `<label class="check"><input type="checkbox" data-crew value="${u.id}" ${ids.includes(u.id) ? 'checked' : ''}>${e(u.name)}</label>`).join('') },
      { name: 'notes', label: 'Notes for the crew', type: 'textarea', rows: 2, value: v.notes, full: 1 }],
    save: (vals, ctx) => PUT('/api/visits/' + v.id, { start: vals.start, end: vals.end, notes: vals.notes, assignees: $$('[data-crew]:checked', ctx.el).map(c => +c.value) })
  });
  if (r) { toast(r.conflicts && r.conflicts.length ? `Saved - conflict: ${r.conflicts[0].message}` : 'Visit updated', r.conflicts && r.conflicts.length ? 'error' : ''); rerender(); }
}
async function completeVisit(v) {
  const others = (await api('/api/visits?job_id=' + v.job_id + '&status=open')).filter(x => x.id !== v.id).length;
  await modal({
    title: `Complete visit · ${v.job_number}`, size: 'wide',
    body: `<form class="form" onsubmit="return false">
      <div class="field full"><label>What was done</label><textarea name="notes" rows="4" placeholder="Work performed, parts used, findings, follow-up needed…"></textarea></div>
      <div class="field full"><label>Photos</label><label class="btn sm">${icon('camera')}Add photos<input type="file" accept="image/*" capture="environment" multiple hidden id="cPhotos"></label> <span class="muted small" id="cPhotoN"></span></div>
      <div class="field full"><label>Customer signature (optional)</label><canvas class="sig-pad" id="sig" width="600" height="180"></canvas><div class="row mt-s"><input class="inp" name="signer" placeholder="Signer's name" style="max-width:260px"><button type="button" class="btn sm ghost" id="sigClear">Clear</button></div></div>
      <div class="field full"><label class="check"><input type="checkbox" name="complete_job" ${others ? '' : 'checked'}> Also mark the job completed${others ? ` (it has ${others} other open visit${others > 1 ? 's' : ''})` : ''}</label></div>
    </form>`,
    foot: `<button class="btn" data-x>Cancel</button><button class="btn good" id="cGo">${icon('check')}Complete visit</button>`,
    onMount: ctx => {
      const cv = $('#sig', ctx.el); const g = cv.getContext('2d'); let drawing = false, inked = false;
      g.lineWidth = 2.4; g.lineCap = 'round'; g.strokeStyle = '#15202b';
      const pt = ev => { const r = cv.getBoundingClientRect(); return [(ev.clientX - r.left) * cv.width / r.width, (ev.clientY - r.top) * cv.height / r.height]; };
      cv.addEventListener('pointerdown', ev => { drawing = true; inked = true; cv.setPointerCapture(ev.pointerId); g.beginPath(); g.moveTo(...pt(ev)); });
      cv.addEventListener('pointermove', ev => { if (!drawing) return; g.lineTo(...pt(ev)); g.stroke(); });
      cv.addEventListener('pointerup', () => { drawing = false; });
      $('#sigClear', ctx.el).onclick = () => { g.clearRect(0, 0, cv.width, cv.height); inked = false; };
      const photos = $('#cPhotos', ctx.el); photos.onchange = () => { $('#cPhotoN', ctx.el).textContent = `${photos.files.length} photo(s) ready`; };
      $('#cGo', ctx.el).onclick = async () => {
        const btn = $('#cGo', ctx.el); btn.disabled = true; btn.textContent = 'Saving…';
        const f = readForm(ctx.el);
        try {
          for (const p of photos.files) await upload('visit', v.id, p, { kind: 'photo' });
          if (inked) { const blob = await new Promise(r => cv.toBlob(r, 'image/png')); await upload('visit', v.id, new File([blob], 'signature.png', { type: 'image/png' }), { kind: 'signature', caption: f.signer ? `Signed by ${f.signer}` : 'Customer signature' }); }
          const pos = await getPos(4000);
          await POST(`/api/visits/${v.id}/status`, { status: 'completed', notes: f.notes, complete_job: f.complete_job, ...pos });
          toast('Visit completed'); ctx.close(); loadTimer(); rerender();
        } catch (err) { ctx.error(err.message); btn.disabled = false; btn.innerHTML = icon('check') + 'Complete visit'; }
      };
    }
  });
}

// ======================= MY DAY (field) =======================
let mydayDate = null, mydayUser = null;
VIEWS.myday = async (view, r) => {
  if (r.q.date) mydayDate = r.q.date;
  const date = mydayDate || todayStr();
  const uid = mydayUser || S.me.id;
  const [visits, timers] = await Promise.all([api('/api/visits' + qs({ from: date, to: date, user_id: uid })), api('/api/time/running' + qs({ user_id: uid }))]);
  const me = uid === S.me.id; const who = userById(uid) || S.me; const t = timers[0];
  view.innerHTML = `
  <div class="page-head"><div><h1>${me ? 'My Day' : e(who.name) + "'s day"}</h1><div class="sub">${fmt.dateLong(date)}</div></div>
    <div class="actions">${can('office') ? `<select class="inp" id="mdUser" style="width:auto">${opt(fieldTeam().map(u => [u.id, u.name]), uid)}</select>` : ''}</div></div>
  <div class="day-nav"><button class="btn sm" id="mdPrev">${icon('chevL')}</button><button class="btn sm" id="mdToday">Today</button><button class="btn sm" id="mdNext">${icon('chevron')}</button>
    <span class="muted small">${visits.length} visit${visits.length === 1 ? '' : 's'}${visits.length ? ` · ${visits.filter(x => x.status === 'completed').length} done` : ''}</span></div>
  ${me && S.me.kind === 'human' ? `<div class="card clock-card">${t ? `<div><div class="k-label">On the clock since ${fmt.time(t.started_at)}</div><div class="big" id="mdClock">${fmt.dur(Date.now() - new Date(t.started_at))}</div><div class="small muted">${t.job_number ? `${e(t.job_number)} · ${e(t.job_title)}` : e(t.description || 'General time')}</div></div><button class="btn danger lg" id="mdStop" style="margin-left:auto">${icon('stop')}Clock out</button>`
    : `<div><div class="k-label">Not clocked in</div><div class="small muted">Arriving at a visit clocks you in automatically.</div></div><button class="btn lg" id="mdStart" style="margin-left:auto">${icon('play')}Clock in</button>`}</div>` : ''}
  ${visits.length ? visits.map(v => visitCard(v)).join('') : `<div class="card"><div class="empty">${icon('today')}No visits ${date === todayStr() ? 'today' : 'this day'}.${can('office') ? ' <a href="#/schedule">Open the schedule</a>' : ''}</div></div>`}`;
  $('#mdPrev').onclick = () => { mydayDate = addDays(date, -1); router(); };
  $('#mdNext').onclick = () => { mydayDate = addDays(date, 1); router(); };
  $('#mdToday').onclick = () => { mydayDate = null; router(); };
  const mu = $('#mdUser'); if (mu) mu.onchange = () => { mydayUser = +mu.value; router(); };
  const st = $('#mdStart'); if (st) st.onclick = async () => { const pos = await getPos(4000); await POST('/api/time/start', { description: 'General time', ...pos }); toast('Clocked in'); await loadTimer(); router(); };
  const sp = $('#mdStop'); if (sp) sp.onclick = async () => { const pos = await getPos(4000); await POST('/api/time/stop', { id: t.id, ...pos }); toast('Clocked out'); await loadTimer(); router(); };
  $$('[data-vact]', view).forEach(b => b.onclick = async () => {
    const [act, id] = b.dataset.vact.split(':'); const v = visits.find(x => x.id === +id);
    if (act === 'open') return visitModal(v.id);
    if (act === 'completed') return completeVisit(v);
    b.disabled = true; const pos = await getPos();
    try { await POST(`/api/visits/${v.id}/status`, { status: act, ...pos }); toast(LABELS.visit[act]); await loadTimer(); router(); } catch (err) { toast(err.message, 'error'); b.disabled = false; }
  });
};
function visitCard(v) {
  const done = ['completed', 'cancelled'].includes(v.status);
  const next = v.status === 'scheduled' ? ['en_route', 'truck', 'On my way'] : v.status === 'en_route' ? ['on_site', 'pin', 'Arrived'] : v.status === 'on_site' ? ['completed', 'check', 'Complete'] : null;
  return `<div class="card visit-card"><div class="stripe" style="background:${visitColor(v)}"></div>
    <div class="vc-h"><div class="when">${fmt.time(v.start_at)}<small>to ${fmt.time(v.end_at)}</small></div>
      <div class="grow"><div class="vc-t">${e(v.customer_name)}</div><div class="small muted">${e(v.job_number)} · ${e(v.job_title)}</div></div>${pill('visit', v.status)}</div>
    <div class="vc-b">
      ${v.address ? `<a href="${mapsUrl(v.address)}" target="_blank" rel="noopener">${icon('pin')}${e(v.address)}</a>` : '<span class="muted">No address on file</span>'}
      ${v.access_notes ? `<div class="callout">${icon('key')}<div>${e(v.access_notes)}</div></div>` : ''}
      ${v.notes ? `<div class="callout info">${icon('wo')}<div>${e(v.notes)}</div></div>` : ''}
    </div>
    <div class="vc-a">
      <a class="btn" href="${v.address ? mapsUrl(v.address) : '#'}" target="_blank" rel="noopener">${icon('nav')}Navigate</a>
      <a class="btn" href="${v.customer_phone ? telUrl(v.customer_phone) : '#'}">${icon('phone')}Call</a>
      ${!done && next ? `<button class="btn ${next[0] === 'completed' ? 'good' : 'primary'}" data-vact="${next[0]}:${v.id}">${icon(next[1])}${next[2]}</button>` : `<button class="btn" disabled>${icon('check')}${LABELS.visit[v.status]}</button>`}
      <button class="btn" data-vact="open:${v.id}">${icon('more')}Details</button>
    </div></div>`;
}

// ======================= JOBS =======================
const JOB_TABS = [['open', 'Open'], ['unscheduled', 'Unscheduled'], ['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['on_hold', 'On hold'], ['to_invoice', 'To invoice'], ['completed', 'Completed'], ['all', 'All']];
const JOB_TYPES = ['service', 'repair', 'installation', 'maintenance', 'inspection', 'consulting', 'project', 'emergency', 'other'];
const jobsState = { sort: 'number' };
VIEWS.jobs = async (view, r) => {
  if (r.id) return jobDetail(view, r.id);
  const q = r.q; const tab = q.tab || 'open';
  const rows = await api('/api/jobs' + qs({ status: tab, q: q.q, type: q.type, priority: q.priority, assigned_to: q.assigned, customer_id: q.customer, sort: jobsState.sort, limit: 500 }));
  const setQ = patch => { const nq = { ...q, ...patch }; Object.keys(nq).forEach(k => (nq[k] === '' || nq[k] == null) && delete nq[k]); location.hash = '#/jobs' + qs(nq); };
  view.innerHTML = `
  <div class="page-head"><div><h1>Jobs</h1><div class="sub">${rows.length} shown · ${fmt.money0(rows.reduce((s, j) => s + (j.items_total || 0), 0))} in line items</div></div>
    <div class="actions">${can('books') ? `<a class="btn" href="/api/export/jobs.csv">${icon('download')}CSV</a>` : ''}${can('office') ? `<button class="btn primary" id="jNew">${icon('plus')}New job</button>` : ''}</div></div>
  <div class="card">
    <div class="tabs">${JOB_TABS.map(([k, l]) => `<a data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div class="filters"><input type="search" id="jq" placeholder="Search number, title, customer, address…" value="${e(q.q || '')}">
      <select id="jType">${opt(JOB_TYPES.map(t => [t, cap(t)]), q.type, 'Any type')}</select>
      <select id="jPri">${opt(['urgent', 'high', 'normal', 'low'].map(p => [p, cap(p)]), q.priority, 'Any priority')}</select>
      <select id="jAss">${opt([['me', 'Me'], ['none', 'Unassigned'], ...S.meta.team.filter(u => u.kind === 'human').map(u => [u.id, u.name])], q.assigned, 'Anyone')}</select>
      <span class="spacer"></span><select id="jSort">${opt([['number', 'Newest'], ['next_visit', 'Next visit'], ['priority', 'Priority'], ['customer', 'Customer']], jobsState.sort)}</select></div>
    <div id="jTbl">${table(rows, [
      { label: 'Job', render: j => `<span class="code">${e(j.number)}</span>` },
      { label: 'Title', cls: 'title-cell', render: j => `<div>${e(j.title)}</div><div class="sub">${e(j.customer_name)}${j.city ? ' · ' + e(j.city) : ''}</div>` },
      { label: 'Type', hideM: 1, render: j => `<span class="tag">${e(j.type)}</span>` },
      { label: 'Priority', hideM: 1, render: j => priPill(j.priority) },
      { label: 'Status', render: j => pill('job', j.status) },
      { label: 'Next visit', hideM: 1, render: j => j.next_visit ? `<span class="nowrap">${fmt.dt(j.next_visit)}</span>` : '<span class="muted">—</span>' },
      { label: 'Owner', hideM: 1, render: j => j.assignee ? e(j.assignee) : '<span class="muted">—</span>' },
      { label: 'Value', num: 1, hideM: 1, render: j => j.items_total ? fmt.money0(j.items_total) : '<span class="muted">—</span>' }
    ], { onRow: 1, empty: 'No jobs match.', emptyIcon: 'wo' })}</div></div>`;
  $$('[data-tab]', view).forEach(a => a.onclick = () => setQ({ tab: a.dataset.tab }));
  let st; $('#jq').oninput = ev => { clearTimeout(st); st = setTimeout(() => setQ({ q: ev.target.value }), 350); };
  $('#jType').onchange = ev => setQ({ type: ev.target.value }); $('#jPri').onchange = ev => setQ({ priority: ev.target.value }); $('#jAss').onchange = ev => setQ({ assigned: ev.target.value });
  $('#jSort').onchange = ev => { jobsState.sort = ev.target.value; router(); };
  bindTable($('#jTbl'), rows, { onRow: j => (location.hash = '#/jobs/' + j.id) });
  const jn = $('#jNew'); if (jn) jn.onclick = () => jobForm(null, q.customer ? { customer_id: q.customer } : {});
};

async function jobForm(job = null, preset = {}) {
  const team = S.meta.team.filter(u => u.kind === 'human');
  const v = job || { type: 'service', priority: 'normal', billing: 'fixed', ...preset };
  let locs = [];
  if (v.customer_id) locs = ((await customers()).find(c => c.id === Number(v.customer_id)) || { locations: [] }).locations;
  const res = await formModal({
    title: job ? `Edit ${job.number}` : 'New job', size: 'wide', cols: 'g3f', okLabel: job ? 'Save changes' : 'Create job',
    fields: [
      ...(job ? [] : [{ name: 'customer_id', label: 'Customer', type: 'customer', value: v.customer_id, full: 1, required: 1 }]),
      { name: 'location_id', label: 'Service location', type: 'select', options: locs.map(l => [l.id, `${l.name ? l.name + ' - ' : ''}${l.address || ''}`]), value: v.location_id || (locs[0] && locs[0].id), blank: 'Customer primary address', full: 1 },
      { name: 'title', label: 'Title', required: 1, value: v.title, full: 1, placeholder: 'What needs to be done?' },
      { name: 'description', label: 'Description / scope', type: 'textarea', rows: 3, value: v.description, full: 1, placeholder: 'Problem details, equipment, safety notes…' },
      { name: 'type', label: 'Type', type: 'select', options: JOB_TYPES.map(t => [t, cap(t)]), value: v.type },
      { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map(p => [p, cap(p)]), value: v.priority },
      { name: 'billing', label: 'Billing', type: 'select', options: [['fixed', 'Fixed price (line items)'], ['hourly', 'Hourly (time & materials)'], ['no_charge', 'No charge / warranty']], value: v.billing },
      { name: 'assigned_to', label: 'Job owner', type: 'select', options: team.map(u => [u.id, u.name]), value: v.assigned_to, blank: 'Unassigned' },
      { name: 'due_date', label: 'Target date', type: 'date', value: v.due_date },
      { name: 'customer_po', label: 'Customer PO #', value: v.customer_po },
      { name: 'budget_hours', label: 'Hour budget', type: 'number', step: '0.5', min: 0, value: v.budget_hours || '' },
      { name: 'budget_amount', label: 'Not-to-exceed $', type: 'number', step: '1', min: 0, value: v.budget_amount || '' },
      ...(job ? [] : [{ name: 'checklist', label: 'Checklist (one step per line)', type: 'textarea', rows: 2, full: 1 }, { name: 'schedule_now', label: 'Schedule the first visit after creating', type: 'checkbox', value: 1, full: 1 }])
    ],
    onMount: ctx => {
      const hid = $('input[name=customer_id]', ctx.el);
      if (hid) hid.addEventListener('change', async () => {
        const c = (await customers()).find(x => x.id === Number(hid.value));
        $('[name=location_id]', ctx.el).innerHTML = opt((c ? c.locations : []).map(l => [l.id, `${l.name ? l.name + ' - ' : ''}${l.address || ''}`]), c && c.locations[0] && c.locations[0].id, 'Customer primary address');
      });
      const ty = $('[name=type]', ctx.el); ty.onchange = () => { if (ty.value === 'consulting') $('[name=billing]', ctx.el).value = 'hourly'; };
    },
    save: async vals => {
      const body = { ...vals }; schedNow = !!body.schedule_now; delete body.schedule_now;
      if (job) return PUT('/api/jobs/' + job.id, body);
      return POST('/api/jobs', body);
    }
  });
  if (res) {
    toast(job ? 'Job saved' : `${res.number} created`);
    if (!job) { await loadMeta(); location.hash = '#/jobs/' + res.id; if (schedNow) setTimeout(() => scheduleVisitForm(res), 400); }
    else rerender();
  }
}
let schedNow = false;

async function jobDetail(view, id) {
  const j = await api('/api/jobs/' + id);
  const f = j.financials; const office = can('office'), books = can('books');
  const closed = ['completed', 'invoiced', 'cancelled'].includes(j.status);
  const acts = [];
  if (office && !closed) acts.push(`<button class="btn primary" id="jSched">${icon('cal')}Schedule visit</button>`);
  if (can('write') && ['unscheduled', 'scheduled', 'on_hold'].includes(j.status)) acts.push(`<button class="btn" data-js="in_progress">${icon('play')}${j.status === 'on_hold' ? 'Resume' : 'Start'}</button>`);
  if (can('write') && ['scheduled', 'in_progress', 'unscheduled'].includes(j.status)) acts.push(`<button class="btn" data-js="on_hold">${icon('pause')}Hold</button>`);
  if (can('write') && !closed) acts.push(`<button class="btn good" data-js="completed">${icon('check')}Complete</button>`);
  if (books && office && (j.status === 'completed' || f.uninvoiced_items > 0 || f.unbilled_hours > 0) && j.billing !== 'no_charge' && j.status !== 'cancelled') acts.push(`<button class="btn ${j.status === 'completed' ? 'primary' : ''}" id="jInvoice">${icon('inv')}Invoice</button>`);
  if (office && ['completed', 'cancelled'].includes(j.status)) acts.push(`<button class="btn" data-js="in_progress">${icon('undo')}Reopen</button>`);
  const done = j.checklist.filter(c => c.done).length;
  view.innerHTML = `
  <div class="crumb"><a href="#/jobs">Jobs</a> / ${e(j.number)}</div>
  <div class="detail-head"><div><h1>${e(j.title)}</h1>
    <div class="meta"><span class="code" style="font-weight:700;color:var(--primary)">${e(j.number)}</span>${pill('job', j.status)}${priPill(j.priority)}<span class="tag">${e(j.type)}</span><span class="tag">${e(j.billing.replace('_', ' '))}</span>
      ${j.plan ? `<a class="small" href="#/plans?id=${j.plan.id}">${icon('repeat')} ${e(j.plan.name)}</a>` : ''}${j.estimate ? `<a class="small" href="#/estimates/${j.estimate.id}">${icon('est')} ${e(j.estimate.number)}</a>` : ''}${j.request ? `<a class="small" href="#/requests/${j.request.id}">${icon('inbox')} ${e(j.request.number)}</a>` : ''}</div></div>
    <div class="actions">${acts.join('')}${office ? `<button class="btn" id="jEdit">${icon('edit')}Edit</button>` : ''}<button class="btn" id="jNote">${icon('pen')}Note</button>${can('admin') ? `<button class="btn danger" id="jDel" title="Delete">${icon('trash')}</button>` : ''}</div></div>
  ${j.status === 'on_hold' && j.hold_reason ? `<div class="notice warn">${icon('pause')}<span><b>On hold:</b> ${e(j.hold_reason)}</span></div>` : ''}
  <div class="grid g-main">
    <div>
      <div class="card"><div class="card-h"><h2>Details</h2></div><div class="card-b">
        <div class="dl">
          <div><div class="k">Customer</div><div class="v"><a href="#/customers/${j.customer_id}">${e(j.customer_name)}</a></div></div>
          <div><div class="k">Phone</div><div class="v">${j.customer_phone ? `<a href="${telUrl(j.customer_phone)}">${e(j.customer_phone)}</a>` : '—'}</div></div>
          <div><div class="k">Email</div><div class="v">${j.customer_email ? e(j.customer_email) : '—'}</div></div>
          <div><div class="k">Address</div><div class="v">${j.address ? `<a href="${mapsUrl(j.address)}" target="_blank" rel="noopener">${e(j.address)}</a>` : '—'}</div></div>
          <div><div class="k">Owner</div><div class="v">${e(j.assignee || 'Unassigned')}</div></div>
          <div><div class="k">Target date</div><div class="v">${j.due_date ? `${fmt.date(j.due_date)} <span class="muted small">(${fmt.dueIn(j.due_date)})</span>` : '—'}</div></div>
          <div><div class="k">Customer PO</div><div class="v">${e(j.customer_po || '—')}</div></div>
          <div><div class="k">Created</div><div class="v">${fmt.dt(j.created_at)}</div></div>
          <div><div class="k">Completed</div><div class="v">${fmt.dt(j.completed_at)}</div></div>
        </div>
        ${j.access_notes ? `<div class="callout mt">${icon('key')}<div><b>Access:</b> ${e(j.access_notes)}</div></div>` : ''}
        ${j.description ? `<div class="mt"><div class="k-label">Scope</div><div class="desc">${e(j.description)}</div></div>` : ''}
        ${j.completion_notes ? `<div class="callout good mt">${icon('check')}<div><b>Completion:</b> ${e(j.completion_notes)}</div></div>` : ''}
      </div></div>

      <div class="card mt"><div class="card-h"><h2>${icon('cal')} Visits</h2><span class="muted">${j.visits.length}</span>${office && !closed ? `<div class="right"><button class="btn sm" id="jSched2">${icon('plus')}Schedule</button></div>` : ''}</div>
        <div class="card-b flush">${j.visits.length ? `<ul class="list">${j.visits.map(v => `<li class="click" data-visit="${v.id}"><div class="grow"><div class="t">${fmt.dt(v.start_at)} - ${fmt.time(v.end_at)}</div><div class="s">${v.assignees.map(a => e(a.name)).join(', ') || 'Unassigned'}${v.arrived_at ? ` · arrived ${fmt.time(v.arrived_at)}` : ''}${v.completed_at ? ` · done ${fmt.time(v.completed_at)}` : ''}${v.gcal_event_id ? ' · on Google Calendar' : ''}</div></div>${pill('visit', v.status)}</li>`).join('')}</ul>` : '<div class="empty">Not scheduled yet.</div>'}</div></div>

      <div class="card mt"><div class="card-h"><h2>${icon('list')} Line items</h2><span class="muted">${fmt.money(f.items_total)}</span>${can('write') ? `<div class="right"><button class="btn sm" id="jItems">${icon('plus')}Add items</button></div>` : ''}</div>
        <div class="card-b flush">${table(j.items, [
          { label: 'Item', render: l => `<div style="font-weight:550">${e(l.name)}</div>${l.description ? `<div class="sub">${e(l.description)}</div>` : ''}` },
          { label: 'Qty', num: 1, render: l => fmt.num(l.qty, 2) + (l.unit ? ' ' + e(l.unit) : '') },
          { label: 'Price', num: 1, render: l => fmt.money(l.unit_price) },
          { label: 'Total', num: 1, render: l => fmt.money(l.total) },
          { label: '', render: l => l.invoice_id ? '<span class="tag">invoiced</span>' : can('write') ? `<button class="icon-btn" data-rmitem="${l.id}" title="Remove">${icon('trash')}</button>` : '' }
        ], { compact: 1, empty: j.billing === 'hourly' ? 'Hourly job: billable time is added to the invoice automatically.' : 'No line items yet.' })}</div></div>

      <div class="card mt"><div class="card-h"><h2>${icon('task')} Checklist</h2><span class="muted">${j.checklist.length ? `${done} of ${j.checklist.length} done` : ''}</span>${can('write') ? `<div class="right"><button class="btn sm" id="jAddStep">${icon('plus')}Add step</button></div>` : ''}</div>
        <div class="card-b" style="padding-top:4px;padding-bottom:4px">${j.checklist.length ? `<ul class="checklist">${j.checklist.map((c, i) => `<li class="${c.done ? 'done' : ''}"><input type="checkbox" data-ck="${i}" ${c.done ? 'checked' : ''} ${can('write') ? '' : 'disabled'}><span style="flex:1">${e(c.text)}</span></li>`).join('')}</ul>` : '<div class="empty" style="padding:12px">No checklist.</div>'}</div></div>

      <div class="card mt"><div class="card-h"><h2>${icon('clock')} Time</h2><span class="muted">${fmt.hours(f.labor_hours)}${books ? ` · cost ${fmt.money(f.labor_cost)}` : ''}${f.unbilled_hours ? ` · ${fmt.hours(f.unbilled_hours)} unbilled` : ''}</span>${can('write') ? `<div class="right"><button class="btn sm" id="jTime">${icon('plus')}Log time</button></div>` : ''}</div>
        <div class="card-b flush">${table(j.time, [
          { label: 'Date', render: t => fmt.date(t.work_date) }, { label: 'Person', render: t => e(t.user_name) },
          { label: 'Hours', num: 1, render: t => t.ended_at === null && t.started_at ? '<span class="pill st-on_site">running</span>' : fmt.num(t.hours, 2) },
          { label: 'Billable', hideM: 1, render: t => t.billable ? (t.invoice_id ? `<span class="tag">${e(t.invoice_number)}</span>` : `<span class="tag">${fmt.money(t.bill_rate)}/h</span>`) : '<span class="muted">no</span>' },
          { label: 'Notes', hideM: 1, render: t => `<span class="muted">${e(t.description)}</span>` }
        ], { compact: 1, empty: 'No time logged yet.' })}</div></div>

      <div class="card mt"><div class="card-h"><h2>${icon('dollar')} Expenses</h2><span class="muted">${fmt.money(f.expense_cost)}</span>${can('write') ? `<div class="right"><button class="btn sm" id="jExp">${icon('plus')}Add expense</button></div>` : ''}</div>
        <div class="card-b flush">${table(j.expenses, [
          { label: 'Date', render: x => fmt.date(x.expense_date) }, { label: 'Category', render: x => `<span class="tag">${e(x.category)}</span>` },
          { label: 'Vendor / note', render: x => `${e(x.vendor)}<div class="sub">${e(x.description)}</div>` }, { label: 'Amount', num: 1, render: x => fmt.money(x.amount) },
          { label: 'Billable', hideM: 1, render: x => x.billable ? (x.invoice_id ? `<span class="tag">${e(x.invoice_number)}</span>` : 'yes') : '<span class="muted">no</span>' }
        ], { compact: 1, empty: 'No expenses.' })}</div></div>

      <div class="card mt"><div class="card-h"><h2>${icon('camera')} Photos & files</h2>${can('write') ? `<div class="right"><label class="btn sm">${icon('upload')}Upload<input type="file" multiple hidden id="jFiles" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"></label></div>` : ''}</div>
        <div class="card-b">${photoGrid([...j.attachments, ...j.visits.flatMap(v => v.attachments || [])])}<div id="visitPhotos"></div></div></div>
    </div>
    <div>
      ${books ? `<div class="card"><div class="card-h"><h2>${icon('dollar')} Job costing</h2><span class="muted small">${f.revenue_basis === 'invoiced' ? 'invoiced' : 'estimated'}</span></div><div class="card-b">
        <div class="cost-row"><span>Revenue</span><b>${fmt.money(f.revenue)}</b></div>
        <div class="cost-row"><span>Materials</span><span>${fmt.money(f.materials_cost)}</span></div>
        <div class="cost-row"><span>Labor (${fmt.hours(f.labor_hours)})</span><span>${fmt.money(f.labor_cost)}</span></div>
        <div class="cost-row"><span>Expenses</span><span>${fmt.money(f.expense_cost)}</span></div>
        <div class="cost-row total"><span>Profit</span><span style="color:${f.profit >= 0 ? 'var(--good-ink)' : 'var(--crit-ink)'}">${fmt.money(f.profit)}${f.margin_pct != null ? ` <small class="muted">(${f.margin_pct}%)</small>` : ''}</span></div>
        ${j.budget_hours ? `<div class="small muted mt">${fmt.num(f.labor_hours, 1)} of ${fmt.num(j.budget_hours, 1)} budgeted hours</div><div class="meter"><span style="width:${Math.min(100, f.budget_hours_used_pct)}%;background:${f.budget_hours_used_pct > 100 ? 'var(--crit)' : f.budget_hours_used_pct > 80 ? 'var(--warn)' : 'var(--primary)'}"></span></div>` : ''}
        ${f.uninvoiced_items || f.unbilled_time_amount || f.unbilled_expenses ? `<div class="callout info mt">${icon('inv')}<div>Not yet invoiced: ${fmt.money(f.uninvoiced_items + f.unbilled_time_amount + f.unbilled_expenses)}</div></div>` : ''}
        ${j.invoices.length ? `<div class="k-label mt">Invoices</div>${j.invoices.map(i => `<div class="cost-row"><a href="#/invoices/${i.id}">${e(i.number)}</a><span>${pill('invoice', i.status)} ${fmt.money(i.total)}</span></div>`).join('')}` : ''}
      </div></div>` : ''}
      <div class="card ${books ? 'mt' : ''}"><div class="card-h"><h2>Activity</h2></div><div class="card-b">
        <div class="field"><textarea id="jComment" rows="2" placeholder="Add a note or update…"></textarea></div>
        <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm primary" id="jPost">${icon('send')}Post</button></div>
        <div class="mt">${timeline(j.activity)}</div></div></div>
    </div>
  </div>`;
  bindVisitClicks(view);
  const reload = () => rerender();
  const sched = () => scheduleVisitForm(j);
  for (const id2 of ['jSched', 'jSched2']) { const b = $('#' + id2); if (b) b.onclick = sched; }
  const ed = $('#jEdit'); if (ed) ed.onclick = () => jobForm(j);
  $('#jNote').onclick = () => noteDialog('job', j.id);
  const del = $('#jDel'); if (del) del.onclick = async () => { if (await confirmBox('Delete job', `Delete <b>${e(j.number)}</b> with its visits, time links and history? Prefer "Cancelled" to keep records.`, 'Delete', true)) { await DEL('/api/jobs/' + j.id); toast('Job deleted'); location.hash = '#/jobs'; } };
  $$('[data-js]', view).forEach(b => b.onclick = async () => {
    const st = b.dataset.js;
    if (st === 'on_hold') {
      const r2 = await formModal({ title: 'Put job on hold', size: 'narrow', okLabel: 'Put on hold', fields: [{ name: 'reason', label: 'Reason', type: 'select', options: ['Waiting on parts', 'Waiting on customer', 'Waiting on approval', 'Weather', 'Access / shutdown needed', 'Other'].map(x => [x, x]), full: 1 }, { name: 'note', label: 'Note', full: 1 }],
        save: v => POST(`/api/jobs/${j.id}/status`, { status: 'on_hold', reason: v.reason + (v.note ? ' - ' + v.note : '') }) });
      if (r2) { toast('Job on hold'); reload(); } return;
    }
    if (st === 'completed') {
      const r2 = await formModal({ title: `Complete ${j.number}`, size: 'narrow', okLabel: 'Mark complete', fields: [{ name: 'notes', label: 'Completion notes', type: 'textarea', rows: 4, full: 1, value: j.completion_notes }],
        save: v => POST(`/api/jobs/${j.id}/status`, { status: 'completed', notes: v.notes }) });
      if (r2) { toast('Job completed'); reload(); } return;
    }
    await POST(`/api/jobs/${j.id}/status`, { status: st }); toast(LABELS.job[st]); reload();
  });
  const inv = $('#jInvoice'); if (inv) inv.onclick = async () => { const r2 = await POST('/api/invoices', { job_id: j.id }).catch(err => toast(err.message, 'error')); if (r2) { toast(`${r2.number} created`); location.hash = '#/invoices/' + r2.id; } };
  const it = $('#jItems'); if (it) it.onclick = () => addItemsDialog(j);
  $$('[data-rmitem]', view).forEach(b => b.onclick = async () => { await DEL('/api/job-items/' + b.dataset.rmitem); reload(); });
  $$('[data-ck]', view).forEach(c => c.onchange = () => POST(`/api/jobs/${j.id}/checklist`, { index: +c.dataset.ck, done: c.checked }).then(reload));
  const as = $('#jAddStep'); if (as) as.onclick = async () => { const r2 = await formModal({ title: 'Add checklist step', size: 'narrow', okLabel: 'Add', fields: [{ name: 'add_text', label: 'Step', full: 1, required: 1 }], save: v => POST(`/api/jobs/${j.id}/checklist`, v) }); if (r2) reload(); };
  const tm = $('#jTime'); if (tm) tm.onclick = () => timeForm({ job_id: j.id, billable: j.billing === 'hourly' });
  const ex = $('#jExp'); if (ex) ex.onclick = () => expenseForm({ job_id: j.id });
  const fl = $('#jFiles'); if (fl) fl.onchange = async () => { for (const file of fl.files) { try { await upload('job', j.id, file); } catch (err) { toast(err.message, 'error'); } } toast('Uploaded'); reload(); };
  $('#jPost').onclick = async () => { const body = $('#jComment').value.trim(); if (!body) return; await POST('/api/notes', { entity_type: 'job', entity_id: j.id, body }); reload(); };
  // visit photos are attached to visits; show them on the job too
  Promise.all(j.visits.map(v => api('/api/attachments?entity_type=visit&entity_id=' + v.id).catch(() => []))).then(lists => { const all = lists.flat(); if (all.length) $('#visitPhotos').innerHTML = `<div class="k-label mt">From visits</div><div class="mt-s">${photoGrid(all)}</div>`; });
}
async function addItemsDialog(j) {
  const pb = await api('/api/pricebook');
  let editor;
  const r = await modal({ title: `Add items · ${j.number}`, size: 'wide', body: '<div id="liEd"></div>',
    foot: `<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Add to job</button>`,
    onMount: ctx => {
      editor = linesEditor($('#liEd', ctx.el), [], pb, { totals: false });
      $('[data-ok]', ctx.el).onclick = async () => { const items = editor.get(); if (!items.length) return ctx.error('Add at least one item.'); try { await POST(`/api/jobs/${j.id}/items`, { items }); ctx.close(true); } catch (err) { ctx.error(err.message); } };
    } });
  if (r) { toast('Items added'); rerender(); }
}

// ======================= REQUESTS / LEADS =======================
VIEWS.requests = async (view, r) => {
  if (r.id) return requestDetail(view, r.id);
  const tab = r.q.tab || 'open';
  const rows = await api('/api/requests' + qs({ status: tab, q: r.q.q }));
  view.innerHTML = `
  <div class="page-head"><div><h1>Requests & leads</h1><div class="sub">From your request page, website, email, phone, Slack and AI staff</div></div>
    <div class="actions"><a class="btn" href="/request" target="_blank" rel="noopener">${icon('ext')}Request page</a>${can('write') ? `<button class="btn primary" id="rNew">${icon('plus')}Log request</button>` : ''}</div></div>
  <div class="card"><div class="tabs">${[['open', 'Open'], ['quoted', 'Quoted'], ['converted', 'Converted'], ['declined', 'Declined'], ['all', 'All']].map(([k, l]) => `<a href="#/requests?tab=${k}" class="${tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="rTbl">${table(rows, [
      { label: 'Request', render: x => `<span class="code">${e(x.number)}</span>` },
      { label: 'Contact', cls: 'title-cell', render: x => `<div>${e(x.name)}${x.company ? ` <span class="muted">(${e(x.company)})</span>` : ''}</div><div class="sub">${e([x.phone, x.email].filter(Boolean).join(' · '))}</div>` },
      { label: 'Wants', render: x => `<div>${e(x.service || '—')}</div><div class="sub ellipsis" style="max-width:280px">${e(x.details)}</div>` },
      { label: 'Source', hideM: 1, render: x => `<span class="tag">${e(x.source)}</span>` }, { label: 'Priority', hideM: 1, render: x => priPill(x.priority) },
      { label: 'Status', render: x => pill('request', x.status) }, { label: 'Received', hideM: 1, render: x => `<span class="muted nowrap">${fmt.rel(x.created_at)}</span>` }
    ], { onRow: 1, empty: 'No requests here.', emptyIcon: 'inbox' })}</div></div>`;
  bindTable($('#rTbl'), rows, { onRow: x => (location.hash = '#/requests/' + x.id) });
  const rn = $('#rNew'); if (rn) rn.onclick = () => requestForm();
};
async function requestDetail(view, id) {
  const x = await api('/api/requests/' + id);
  const open = !['converted', 'declined'].includes(x.status);
  view.innerHTML = `
  <div class="crumb"><a href="#/requests">Requests</a> / ${e(x.number)}</div>
  <div class="detail-head"><div><h1>${e(x.name)}${x.company ? ` · ${e(x.company)}` : ''}</h1><div class="meta">${pill('request', x.status)}${priPill(x.priority)}<span class="tag">via ${e(x.source)}</span><span class="muted small">${fmt.dt(x.created_at)}</span></div></div>
    <div class="actions">${open && can('office') ? `<button class="btn primary" data-conv="job">${icon('wo')}Create job</button><button class="btn" data-conv="estimate">${icon('est')}Create estimate</button>${x.status === 'new' ? `<button class="btn" id="rContacted">${icon('phone')}Mark contacted</button>` : ''}<button class="btn danger" id="rDecline">${icon('ban')}Decline</button>` : ''}<button class="btn" id="rNote">${icon('pen')}Note</button></div></div>
  <div class="grid g-main"><div>
    <div class="card"><div class="card-h"><h2>Request</h2></div><div class="card-b"><div class="dl">
      <div><div class="k">Phone</div><div class="v">${x.phone ? `<a href="${telUrl(x.phone)}">${e(x.phone)}</a>` : '—'}</div></div>
      <div><div class="k">Email</div><div class="v">${x.email ? `<a href="mailto:${e(x.email)}">${e(x.email)}</a>` : '—'}</div></div>
      <div><div class="k">Address</div><div class="v">${x.address ? `<a href="${mapsUrl(x.address)}" target="_blank" rel="noopener">${e(x.address)}</a>` : '—'}</div></div>
      <div><div class="k">Service</div><div class="v">${e(x.service || '—')}</div></div>
      <div><div class="k">Preferred</div><div class="v">${e([x.preferred_date && fmt.date(x.preferred_date), x.preferred_time].filter(Boolean).join(' · ') || '—')}</div></div>
      <div><div class="k">Linked</div><div class="v">${x.customer_id ? `<a href="#/customers/${x.customer_id}">${e(x.customer_name)}</a>` : '—'}${x.job_id ? ` · <a href="#/jobs/${x.job_id}">${e(x.job_number)}</a>` : ''}${x.estimate_id ? ` · <a href="#/estimates/${x.estimate_id}">${e(x.estimate_number)}</a>` : ''}</div></div>
    </div>${x.details ? `<div class="mt"><div class="k-label">Details</div><div class="desc">${e(x.details)}</div></div>` : ''}</div></div>
    ${x.matches.length && open ? `<div class="card mt"><div class="card-h"><h2>${icon('users')} Possible existing customers</h2></div><div class="card-b flush"><ul class="list">${x.matches.map(m => `<li><div class="grow"><div class="t">${e(m.name)}</div><div class="s">${e(m.number)} · ${e(m.why)} · ${e(m.email || '')} ${e(m.phone || '')}</div></div><button class="btn sm" data-link="${m.id}">Use this customer</button></li>`).join('')}</ul></div></div>` : ''}
  </div><div><div class="card"><div class="card-h"><h2>Activity</h2></div><div class="card-b">${timeline(x.activity)}</div></div></div></div>`;
  let linkTo = x.customer_id || null;
  $$('[data-link]', view).forEach(b => b.onclick = () => { linkTo = +b.dataset.link; $$('[data-link]', view).forEach(o => o.classList.toggle('primary', o === b)); toast('Will use that customer'); });
  $$('[data-conv]', view).forEach(b => b.onclick = async () => {
    try { const r2 = await POST(`/api/requests/${x.id}/convert`, { to: b.dataset.conv, customer_id: linkTo }); invalidateCustomers(); toast(r2.customer_created ? 'Customer created' : 'Linked to customer');
      location.hash = r2.job_id ? '#/jobs/' + r2.job_id : '#/estimates/' + r2.estimate_id; } catch (err) { toast(err.message, 'error'); }
  });
  const rc = $('#rContacted'); if (rc) rc.onclick = async () => { await PUT('/api/requests/' + x.id, { status: 'contacted' }); rerender(); };
  const rd = $('#rDecline'); if (rd) rd.onclick = async () => { if (await confirmBox('Decline request', 'Mark this request as declined?', 'Decline', true)) { await PUT('/api/requests/' + x.id, { status: 'declined' }); rerender(); } };
  $('#rNote').onclick = () => noteDialog('request', x.id);
}
async function requestForm() {
  const r = await formModal({ title: 'Log a request / lead', okLabel: 'Save request',
    fields: [{ name: 'name', label: 'Name', required: 1 }, { name: 'company', label: 'Company' }, { name: 'phone', label: 'Phone', type: 'tel' }, { name: 'email', label: 'Email', type: 'email' },
      { name: 'address', label: 'Service address', full: 1 }, { name: 'service', label: 'Service wanted' }, { name: 'source', label: 'Came in via', type: 'select', options: [['phone', 'Phone call'], ['email', 'Email'], ['referral', 'Referral'], ['website', 'Website'], ['walk_in', 'Walk-in'], ['manual', 'Other']], value: 'phone' },
      { name: 'details', label: 'Details', type: 'textarea', rows: 3, full: 1 }, { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high', 'urgent'].map(p => [p, cap(p)]), value: 'normal' }, { name: 'preferred_date', label: 'Preferred date', type: 'date' }],
    save: v => POST('/api/requests', v) });
  if (r) { toast(`${r.number} saved`); location.hash = '#/requests/' + r.id; }
}

// ======================= SERVICE PLANS =======================
VIEWS.plans = async (view, r) => {
  const rows = await api('/api/plans' + qs({ status: r.q.status || 'all' }));
  const active = rows.filter(p => p.status === 'active');
  view.innerHTML = `
  <div class="page-head"><div><h1>Service plans</h1><div class="sub">${active.length} active · ${fmt.money0(active.reduce((s, p) => s + p.annual_value, 0))}/year recurring · jobs are created automatically before each due date</div></div>
    <div class="actions">${can('office') ? `<button class="btn primary" id="pNew">${icon('plus')}New plan</button>` : ''}</div></div>
  <div class="card"><div id="pTbl">${table(rows, [
    { label: 'Plan', render: p => `<span class="code">${e(p.number)}</span>` }, { label: 'Name', cls: 'title-cell', render: p => `<div>${e(p.name)}</div><div class="sub">${e(p.customer_name)}${p.city ? ' · ' + e(p.city) : ''}</div>` },
    { label: 'Every', render: p => `${p.interval_value} ${p.interval_unit}${p.interval_value > 1 ? 's' : ''}` }, { label: 'Next due', render: p => `${fmt.date(p.next_due)} <span class="sub">${fmt.dueIn(p.next_due)}</span>` },
    { label: 'Tech', hideM: 1, render: p => e(p.assignee || '—') }, { label: 'Per visit', num: 1, hideM: 1, render: p => fmt.money0(p.price) }, { label: 'Yearly', num: 1, render: p => fmt.money0(p.annual_value) },
    { label: 'Jobs', num: 1, hideM: 1, render: p => `${p.jobs_done}/${p.jobs_generated}` }, { label: 'Status', render: p => pill('plan', p.status) }
  ], { onRow: 1, empty: 'No service plans yet. Set up recurring maintenance for your regular customers.', emptyIcon: 'repeat' })}</div></div>`;
  bindTable($('#pTbl'), rows, { onRow: p => planForm(p) });
  const pn = $('#pNew'); if (pn) pn.onclick = () => planForm();
  if (r.q.id) { const p = rows.find(x => x.id === +r.q.id); if (p) planForm(p); }
};
async function planForm(p = null) {
  const team = S.meta.team.filter(u => u.kind === 'human');
  const v = p || { interval_value: 3, interval_unit: 'month', lead_days: 14, visit_time: '09:00', duration_minutes: 120, auto_schedule: 1, job_type: 'maintenance', status: 'active', next_due: addDays(todayStr(), 30) };
  const res = await formModal({
    title: p ? `${p.number} · ${p.name}` : 'New service plan', size: 'wide', cols: 'g3f', okLabel: p ? 'Save plan' : 'Create plan',
    extraFoot: p && can('office') ? `<button class="btn left" id="plGen">${icon('refresh')}Create next job now</button>` : '',
    fields: [
      ...(p ? [{ type: 'html', full: 1, html: `<div class="callout info">${icon('users')}<div><a href="#/customers/${p.customer_id}" data-x>${e(p.customer_name)}</a> · ${p.jobs_generated} job(s) generated · ${fmt.money0(p.annual_value || 0)}/year</div></div>` }] : [{ name: 'customer_id', label: 'Customer', type: 'customer', full: 1, required: 1 }]),
      { name: 'name', label: 'Plan name', value: v.name, full: 1, required: 1, placeholder: 'Quarterly controls PM' },
      { name: 'interval_value', label: 'Every', type: 'number', min: 1, value: v.interval_value }, { name: 'interval_unit', label: 'Unit', type: 'select', options: [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months'], ['year', 'Years']], value: v.interval_unit },
      { name: 'next_due', label: 'Next due', type: 'date', value: v.next_due, required: 1 },
      { name: 'price', label: 'Price per visit', type: 'number', step: '0.01', min: 0, value: v.price || '' }, { name: 'assigned_to', label: 'Technician', type: 'select', options: team.map(u => [u.id, u.name]), value: v.assigned_to, blank: 'Unassigned' },
      { name: 'job_type', label: 'Job type', type: 'select', options: JOB_TYPES.map(t => [t, cap(t)]), value: v.job_type },
      { name: 'lead_days', label: 'Create job days ahead', type: 'number', min: 0, value: v.lead_days }, { name: 'visit_time', label: 'Visit time', type: 'time', value: v.visit_time }, { name: 'duration_minutes', label: 'Visit minutes', type: 'number', min: 15, step: 15, value: v.duration_minutes },
      { name: 'auto_schedule', label: 'Book the visit automatically', type: 'checkbox', value: v.auto_schedule }, { name: 'status', label: 'Status', type: 'select', options: [['active', 'Active'], ['paused', 'Paused'], ['ended', 'Ended']], value: v.status }, { name: 'end_date', label: 'Ends (optional)', type: 'date', value: v.end_date },
      { name: 'description', label: 'Scope of each visit', type: 'textarea', rows: 2, full: 1, value: v.description }, { name: 'checklist', label: 'Checklist (one per line)', type: 'textarea', rows: 3, full: 1, value: v.checklist }
    ],
    onMount: ctx => { const g = $('#plGen', ctx.el); if (g) g.onclick = async () => { const r2 = await POST(`/api/plans/${p.id}/generate`); toast(r2.created.length ? 'Job created' : 'Nothing to create'); ctx.close(true); }; },
    save: vals => p ? PUT('/api/plans/' + p.id, vals) : POST('/api/plans', vals)
  });
  if (res) { toast('Plan saved'); rerender(); }
}
