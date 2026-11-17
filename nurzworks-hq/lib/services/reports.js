'use strict';
// Dashboard, AI daily briefing, business reports, KPI snapshots and global search.
const { all, get, run, now, setting } = require('../db');
const { round2, round, addDays, zonedToUtc, monthKey, monthRange, prevMonth, daysBetween, fmtLocal, addressLine } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const { tz, today, n } = require('../config');
const J = require('./jobs');

// UTC bounds for local business dates (inclusive)
const bounds = (from, to) => ({ s: zonedToUtc(from, '00:00', tz()).toISOString(), e: zonedToUtc(addDays(to, 1), '00:00', tz()).toISOString() });
const pct = (a, b) => (b ? round(100 * a / b, 1) : null);

function summary(from, to) {
  const b = bounds(from, to);
  const p = { f: from, t: to, ...b };
  const inv = get("SELECT COUNT(*) n, COALESCE(SUM(subtotal - discount),0) net, COALESCE(SUM(total),0) gross, COALESCE(SUM(cost),0) cost FROM invoices WHERE status != 'void' AND status != 'draft' AND issue_date BETWEEN :f AND :t", p);
  const paid = get('SELECT COUNT(*) n, COALESCE(SUM(amount),0) v FROM payments WHERE received_on BETWEEN :f AND :t', p);
  const jobsDone = all("SELECT id, billing FROM jobs WHERE completed_at >= :s AND completed_at < :e AND status IN ('completed','invoiced')", p);
  const hours = get('SELECT COALESCE(SUM(hours),0) h, COALESCE(SUM(CASE WHEN billable=1 THEN hours ELSE 0 END),0) bh, COALESCE(SUM(hours*cost_rate),0) cost FROM time_entries WHERE work_date BETWEEN :f AND :t AND (ended_at IS NOT NULL OR started_at IS NULL)', p);
  const exp = get('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE expense_date BETWEEN :f AND :t', p).v;
  const est = get(`SELECT COUNT(*) n, COALESCE(SUM(total),0) v, SUM(CASE WHEN status IN ('approved','converted') THEN 1 ELSE 0 END) won, COALESCE(SUM(CASE WHEN status IN ('approved','converted') THEN total ELSE 0 END),0) won_v,
    SUM(CASE WHEN status='declined' THEN 1 ELSE 0 END) lost FROM estimates WHERE issue_date BETWEEN :f AND :t AND status != 'draft'`, p);
  const newCust = get('SELECT COUNT(*) n FROM customers WHERE created_at >= :s AND created_at < :e', p).n;
  const reqs = get('SELECT COUNT(*) n, SUM(CASE WHEN status IN (\'converted\',\'quoted\') THEN 1 ELSE 0 END) conv FROM requests WHERE created_at >= :s AND created_at < :e', p);
  const ar = get("SELECT COALESCE(SUM(balance),0) v, COALESCE(SUM(CASE WHEN due_date < :td THEN balance ELSE 0 END),0) overdue FROM invoices WHERE status IN ('sent','viewed','partial')", { td: today() });
  return {
    period: { from, to },
    revenue: round2(inv.net), invoiced_total: round2(inv.gross), invoices: inv.n, collected: round2(paid.v), payments: paid.n,
    outstanding: round2(ar.v), overdue: round2(ar.overdue),
    jobs_completed: jobsDone.length, avg_invoice: inv.n ? round2(inv.net / inv.n) : null,
    hours: round(hours.h, 1), billable_hours: round(hours.bh, 1), billable_pct: pct(hours.bh, hours.h), labor_cost: round2(hours.cost),
    expenses: round2(exp), materials_cost: round2(inv.cost), gross_profit: round2(inv.net - inv.cost - hours.cost - exp),
    estimates_sent: est.n, estimates_value: round2(est.v), estimates_won: est.won || 0, estimates_won_value: round2(est.won_v), estimates_lost: est.lost || 0,
    win_rate: pct(est.won || 0, (est.won || 0) + (est.lost || 0)), new_customers: newCust, new_requests: reqs.n, requests_converted: reqs.conv || 0
  };
}

function revenueTrend(months = 12) {
  const cur = monthKey(today()); const out = [];
  for (let k = months - 1; k >= 0; k--) {
    const per = prevMonth(cur, k); const r = monthRange(per);
    out.push({
      period: per,
      invoiced: round2(get("SELECT COALESCE(SUM(subtotal-discount),0) v FROM invoices WHERE status NOT IN ('void','draft') AND issue_date BETWEEN :f AND :t", { f: r.start, t: r.end }).v),
      collected: round2(get('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE received_on BETWEEN :f AND :t', { f: r.start, t: r.end }).v),
      expenses: round2(get('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE expense_date BETWEEN :f AND :t', { f: r.start, t: r.end }).v),
      labor_cost: round2(get('SELECT COALESCE(SUM(hours*cost_rate),0) v FROM time_entries WHERE work_date BETWEEN :f AND :t', { f: r.start, t: r.end }).v)
    });
  }
  return out;
}

function profitability(from, to) {
  const b = bounds(from, to);
  const jobs = all(`SELECT j.id FROM jobs j WHERE j.status IN ('completed','invoiced') AND j.completed_at >= :s AND j.completed_at < :e ORDER BY j.completed_at DESC LIMIT 500`, b);
  const rows = jobs.map(x => {
    const j = J.getJob(x.id); const f = j.financials;
    return { id: j.id, number: j.number, title: j.title, type: j.type, customer_name: j.customer_name, completed_at: j.completed_at, revenue: f.revenue, cost: f.total_cost, labor_hours: f.labor_hours, profit: f.profit, margin_pct: f.margin_pct };
  });
  const byType = {};
  for (const r of rows) { const t = byType[r.type] ||= { type: r.type, jobs: 0, revenue: 0, cost: 0, profit: 0 }; t.jobs++; t.revenue = round2(t.revenue + r.revenue); t.cost = round2(t.cost + r.cost); t.profit = round2(t.profit + r.profit); }
  const tot = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, cost: a.cost + r.cost }), { revenue: 0, cost: 0 });
  return { period: { from, to }, jobs: rows, by_type: Object.values(byType).map(t => ({ ...t, margin_pct: t.revenue ? round(100 * t.profit / t.revenue, 1) : null })),
    totals: { jobs: rows.length, revenue: round2(tot.revenue), cost: round2(tot.cost), profit: round2(tot.revenue - tot.cost), margin_pct: tot.revenue ? round(100 * (tot.revenue - tot.cost) / tot.revenue, 1) : null } };
}

function team(from, to) {
  const b = bounds(from, to);
  return all(`SELECT u.id, u.name, u.kind, u.role, u.title, u.color,
      (SELECT COALESCE(SUM(hours),0) FROM time_entries t WHERE t.user_id=u.id AND t.work_date BETWEEN :f AND :t) hours,
      (SELECT COALESCE(SUM(hours),0) FROM time_entries t WHERE t.user_id=u.id AND t.billable=1 AND t.work_date BETWEEN :f AND :t) billable_hours,
      (SELECT COALESCE(SUM(hours*bill_rate),0) FROM time_entries t WHERE t.user_id=u.id AND t.billable=1 AND t.work_date BETWEEN :f AND :t) billable_value,
      (SELECT COUNT(*) FROM visits v JOIN visit_assignees a ON a.visit_id=v.id WHERE a.user_id=u.id AND v.status='completed' AND v.completed_at >= :s AND v.completed_at < :e) visits_completed,
      (SELECT COUNT(*) FROM tasks k WHERE k.assigned_to=u.id AND k.status='done' AND k.completed_at >= :s AND k.completed_at < :e) tasks_done,
      (SELECT COUNT(*) FROM api_calls c WHERE c.user_id=u.id AND c.created_at >= :s AND c.created_at < :e) api_calls
    FROM users u WHERE u.active=1 ORDER BY u.kind, hours DESC, u.name`, { f: from, t: to, ...b })
    .map(r => ({ ...r, hours: round(r.hours, 1), billable_hours: round(r.billable_hours, 1), billable_value: round2(r.billable_value), billable_pct: pct(r.billable_hours, r.hours) }));
}

function customersReport(from, to) {
  const b = bounds(from, to);
  return {
    top: all(`SELECT c.id, c.name, c.number, COALESCE(SUM(i.subtotal - i.discount),0) revenue, COUNT(i.id) invoices,
        (SELECT COALESCE(SUM(balance),0) FROM invoices x WHERE x.customer_id=c.id AND x.status IN ('sent','viewed','partial')) balance
      FROM customers c JOIN invoices i ON i.customer_id=c.id AND i.status NOT IN ('void','draft') AND i.issue_date BETWEEN :f AND :t GROUP BY c.id ORDER BY revenue DESC LIMIT 25`, { f: from, t: to })
      .map(r => ({ ...r, revenue: round2(r.revenue), balance: round2(r.balance) })),
    sources: all("SELECT CASE source WHEN '' THEN 'unknown' ELSE source END source, COUNT(*) customers FROM customers WHERE created_at >= :s AND created_at < :e GROUP BY 1 ORDER BY 2 DESC", b),
    new_customers: get('SELECT COUNT(*) n FROM customers WHERE created_at >= :s AND created_at < :e', b).n
  };
}

function pipeline(from, to) {
  const b = bounds(from, to);
  const est = all(`SELECT status, COUNT(*) n, COALESCE(SUM(total),0) v FROM estimates WHERE issue_date BETWEEN :f AND :t GROUP BY status`, { f: from, t: to });
  const reqs = all(`SELECT source, COUNT(*) n, SUM(CASE WHEN status IN ('converted','quoted','scheduled') THEN 1 ELSE 0 END) converted FROM requests WHERE created_at >= :s AND created_at < :e GROUP BY source ORDER BY n DESC`, b);
  const won = est.filter(x => ['approved', 'converted'].includes(x.status)).reduce((s, x) => s + x.n, 0);
  const lost = est.filter(x => x.status === 'declined').reduce((s, x) => s + x.n, 0);
  const awaiting = all(`SELECT e.id, e.number, e.title, e.total, e.sent_at, e.viewed_at, e.expiry_date, c.name customer_name FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.status='sent' ORDER BY e.sent_at`);
  return { period: { from, to }, estimates_by_status: est.map(x => ({ ...x, v: round2(x.v) })), win_rate: pct(won, won + lost), requests_by_source: reqs, awaiting_response: awaiting };
}

// ---------------- monthly KPI snapshots (auto-generated like the CMMS) ----------------
function generateKpiSnapshots({ rebuild = false } = {}) {
  const first = get("SELECT MIN(d) d FROM (SELECT MIN(issue_date) d FROM invoices UNION ALL SELECT MIN(substr(created_at,1,10)) FROM jobs UNION ALL SELECT MIN(work_date) FROM time_entries)").d;
  if (!first) return [];
  const cur = monthKey(today()); let p = monthKey(first); const made = []; let guard = 0;
  while (p <= cur && guard++ < 240) {
    const exists = get('SELECT period FROM kpi_snapshots WHERE period=:p', { p });
    if (rebuild || !exists || p === cur) {
      const r = monthRange(p);
      const data = summary(r.start, p === cur ? today() : r.end);
      run('INSERT INTO kpi_snapshots(period,data,generated_at) VALUES(:p,:d,:t) ON CONFLICT(period) DO UPDATE SET data=excluded.data, generated_at=excluded.generated_at', { p, d: JSON.stringify(data), t: now() });
      if (!exists || rebuild) made.push(p);
    }
    p = prevMonth(p, -1);
  }
  return made;
}
function kpiTrend(months = 12) {
  const from = prevMonth(monthKey(today()), months - 1);
  return all('SELECT period, data, generated_at FROM kpi_snapshots WHERE period >= :f ORDER BY period', { f: from }).map(r => ({ ...JSON.parse(r.data), period: r.period, generated_at: r.generated_at }));
}

op({
  name: 'get_report', method: 'GET', path: '/api/reports/:kind', tags: ['Reports'], roles: R.BOOKS,
  title: 'Business report', description: 'Reports for a date range (default: this month). kind: summary (revenue, collections, hours, profit, win rate), revenue (monthly invoiced vs collected vs costs), profitability (per job and per job type), team (hours, billable %, visits, tasks done incl. AI staff), customers (top customers, lead sources), pipeline (estimates and request conversion), kpis (monthly snapshots).',
  input: S.obj({ kind: S.enum(['summary', 'revenue', 'profitability', 'team', 'customers', 'pipeline', 'kpis']), from: S.date, to: S.date, months: S.int('', { minimum: 1, maximum: 36 }) }, ['kind']),
  handler: i => {
    const to = i.to || today(); const from = i.from || today().slice(0, 8) + '01';
    switch (i.kind) {
      case 'summary': return summary(from, to);
      case 'revenue': return revenueTrend(i.months || 12);
      case 'profitability': return profitability(from, to);
      case 'team': return team(from, to);
      case 'customers': return customersReport(from, to);
      case 'pipeline': return pipeline(from, to);
      case 'kpis': return kpiTrend(i.months || 12);
    }
  }
});
op({
  name: 'rebuild_kpis', method: 'POST', path: '/api/kpis/rebuild', tags: ['Reports'], scope: 'admin', mcp: false,
  title: 'Rebuild KPI history', input: S.obj({}), handler: () => ({ generated: generateKpiSnapshots({ rebuild: true }) })
});

// ---------------- dashboard (web app) ----------------
op({
  name: 'get_dashboard', method: 'GET', path: '/api/dashboard', tags: ['Reports'], mcp: false,
  title: 'Dashboard data', input: S.obj({}),
  handler: (i, ctx) => {
    const t = today(); const cur = monthKey(t);
    const books = R.BOOKS.includes(ctx.user.role);
    const mtd = books ? summary(cur + '-01', t) : null;
    // compare month-to-date with the same days of last month (a partial month vs a full month always looks bad)
    const pm = monthRange(prevMonth(cur)); const sameDay = addDays(pm.start, Number(t.slice(8, 10)) - 1);
    const lm = books ? summary(pm.start, sameDay > pm.end ? pm.end : sameDay) : null;
    const field = ctx.user.role === 'field';
    const visitsToday = all(`${J.VISIT_SELECT} WHERE v.start_at < :e AND v.end_at > :s AND v.status != 'cancelled' ${field ? 'AND EXISTS (SELECT 1 FROM visit_assignees a WHERE a.visit_id=v.id AND a.user_id=:u)' : ''} ORDER BY v.start_at`,
      { ...bounds(t, t), u: ctx.user.id }).map(J.decorateVisit);
    const weeks = [];
    const dow = (new Date(t + 'T12:00:00Z').getUTCDay() + 6) % 7; const monday = addDays(t, -dow);
    for (let k = 11; k >= 0; k--) {
      const ws = addDays(monday, -7 * k); const b = bounds(ws, addDays(ws, 6));
      weeks.push({ week: ws, completed: get("SELECT COUNT(*) n FROM jobs WHERE completed_at >= :s AND completed_at < :e AND status IN ('completed','invoiced')", b).n,
        visits: get("SELECT COUNT(*) n FROM visits WHERE status='completed' AND completed_at >= :s AND completed_at < :e", b).n });
    }
    const out = {
      today: t, kpis: mtd, last_month: lm, visits_today: visitsToday, weeks,
      counts: {
        unscheduled: get("SELECT COUNT(*) n FROM jobs WHERE status='unscheduled'").n,
        in_progress: get("SELECT COUNT(*) n FROM jobs WHERE status='in_progress'").n,
        on_hold: get("SELECT COUNT(*) n FROM jobs WHERE status='on_hold'").n,
        to_invoice: get("SELECT COUNT(*) n FROM jobs WHERE status='completed' AND billing != 'no_charge'").n,
        new_requests: get("SELECT COUNT(*) n FROM requests WHERE status='new'").n,
        open_estimates: get("SELECT COUNT(*) n FROM estimates WHERE status='sent'").n,
        open_estimates_value: round2(get("SELECT COALESCE(SUM(total),0) v FROM estimates WHERE status='sent'").v),
        my_tasks: get("SELECT COUNT(*) n FROM tasks WHERE assigned_to=:u AND status IN ('open','in_progress','waiting')", { u: ctx.user.id }).n,
        overdue_invoices: get("SELECT COUNT(*) n FROM invoices WHERE status IN ('sent','viewed','partial') AND due_date < :t", { t }).n,
        active_plans: get("SELECT COUNT(*) n FROM plans WHERE status='active'").n
      },
      unscheduled: all(`${J.JOB_SELECT} WHERE j.status='unscheduled' ORDER BY CASE j.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, j.created_at LIMIT 8`).map(r => { delete r.checklist; return r; }),
      requests: all("SELECT id, number, name, service, source, priority, created_at FROM requests WHERE status IN ('new','contacted') ORDER BY id DESC LIMIT 6"),
      tasks: all(`SELECT t.*, u.name assignee, u.kind assignee_kind FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.status IN ('open','in_progress','waiting') ${field ? 'AND t.assigned_to=:u' : ''}
        ORDER BY CASE WHEN t.assigned_to=:u THEN 0 ELSE 1 END, COALESCE(t.due_date,'9999'), t.id LIMIT 8`, { u: ctx.user.id }),
      running_timers: all(`SELECT t.id, t.started_at, u.name user_name, u.color, j.number job_number, j.title job_title FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id WHERE t.started_at IS NOT NULL AND t.ended_at IS NULL ORDER BY t.started_at`)
    };
    if (books) {
      out.revenue = revenueTrend(6);
      out.overdue = all(`SELECT i.id, i.number, i.balance, i.due_date, c.name customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('sent','viewed','partial') AND i.due_date < :t ORDER BY i.due_date LIMIT 8`, { t })
        .map(r => ({ ...r, days_overdue: daysBetween(r.due_date, t) }));
      out.to_invoice = all(`${J.JOB_SELECT} WHERE j.status='completed' AND j.billing != 'no_charge' ORDER BY j.completed_at LIMIT 8`).map(r => { delete r.checklist; return r; });
      out.awaiting = all("SELECT e.id, e.number, e.title, e.total, e.sent_at, e.viewed_at, c.name customer_name FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.status='sent' ORDER BY e.sent_at LIMIT 6");
      out.payments = all('SELECT p.id, p.amount, p.method, p.received_on, i.number invoice_number, i.id invoice_id, c.name customer_name FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id JOIN customers c ON c.id=p.customer_id ORDER BY p.received_on DESC, p.id DESC LIMIT 6');
      const ar = get(`SELECT COALESCE(SUM(CASE WHEN due_date >= :t THEN balance END),0) cur, COALESCE(SUM(CASE WHEN due_date < :t AND julianday(:t)-julianday(due_date) <= 30 THEN balance END),0) d30,
        COALESCE(SUM(CASE WHEN julianday(:t)-julianday(due_date) BETWEEN 30.5 AND 60 THEN balance END),0) d60, COALESCE(SUM(CASE WHEN julianday(:t)-julianday(due_date) > 60 THEN balance END),0) d90
        FROM invoices WHERE status IN ('sent','viewed','partial')`, { t });
      out.aging = [['Current', ar.cur], ['1-30 days', ar.d30], ['31-60 days', ar.d60], ['60+ days', ar.d90]].map(([label, v]) => ({ label, v: round2(v) }));
    }
    out.last_kpi_run = setting('last_kpi_run');
    return out;
  }
});

// ---------------- AI daily briefing ----------------
op({
  name: 'get_briefing', method: 'GET', path: '/api/briefing', tags: ['Reports'], roles: R.BOOKS,
  title: 'Daily briefing for the office', description: 'Start here each day. Everything that needs attention: today\'s schedule by person, unscheduled jobs, completed jobs not invoiced, overdue invoices, estimates awaiting an answer, new requests, tasks due (yours and the team\'s), who is on the clock, today\'s Google Calendar, unread customer email - plus a prioritized list of suggested_actions with the tool to use for each.',
  input: S.obj({ date: S.date }),
  handler: (i, ctx) => briefing(i.date || today(), ctx)
});
function briefing(day, ctx) {
  const t = today(); const b = bounds(day, day);
  const visits = all(`${J.VISIT_SELECT} WHERE v.start_at < :e AND v.end_at > :s AND v.status != 'cancelled' ORDER BY v.start_at`, b).map(J.decorateVisit);
  const byPerson = {};
  for (const v of visits) for (const a of (v.assignees.length ? v.assignees : [{ id: 0, name: 'Unassigned' }])) (byPerson[a.name] ||= []).push(`${v.local.start}-${v.local.end} ${v.job_number} ${v.job_title} @ ${v.customer_name}${v.address ? ', ' + v.address : ''} [${v.status}]`);
  const unscheduled = all("SELECT j.id, j.number, j.title, j.priority, j.created_at, c.name customer_name FROM jobs j JOIN customers c ON c.id=j.customer_id WHERE j.status='unscheduled' ORDER BY CASE j.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, j.created_at");
  const toInvoice = all("SELECT j.id, j.number, j.title, j.completed_at, c.name customer_name FROM jobs j JOIN customers c ON c.id=j.customer_id WHERE j.status='completed' AND j.billing != 'no_charge' ORDER BY j.completed_at");
  const overdue = all("SELECT i.id, i.number, i.balance, i.due_date, i.reminder_count, i.last_reminder_at, c.name customer_name, c.email customer_email FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.status IN ('sent','viewed','partial') AND i.due_date < :t ORDER BY i.due_date", { t })
    .map(r => ({ ...r, days_overdue: daysBetween(r.due_date, t) }));
  const followDays = n('estimate_followup_days', 3);
  const awaiting = all("SELECT e.id, e.number, e.title, e.total, e.sent_at, e.viewed_at, e.expiry_date, c.name customer_name FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.status='sent' ORDER BY e.sent_at")
    .map(r => ({ ...r, days_since_sent: r.sent_at ? daysBetween(r.sent_at.slice(0, 10), t) : null }));
  const requests = all("SELECT id, number, name, company, service, source, priority, status, created_at FROM requests WHERE status IN ('new','contacted') ORDER BY id");
  const tasks = all(`SELECT t.id, t.title, t.priority, t.due_date, t.status, u.name assignee, u.kind assignee_kind, t.related_type, t.related_id FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to
    WHERE t.status IN ('open','in_progress','waiting') AND (t.due_date IS NULL OR t.due_date <= :wk) ORDER BY COALESCE(t.due_date,'9999')`, { wk: addDays(t, 2) });
  const mine = ctx && ctx.user && ctx.user.id ? tasks.filter(x => x.assignee === ctx.user.name) : [];
  const onClock = all("SELECT u.name, t.started_at, j.number job_number FROM time_entries t JOIN users u ON u.id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id WHERE t.started_at IS NOT NULL AND t.ended_at IS NULL");
  const calendar = all("SELECT summary, start_at, end_at, all_day, location FROM calendar_events WHERE visit_id IS NULL AND status != 'cancelled' AND start_at < :e AND end_at > :s ORDER BY start_at", b)
    .map(e => ({ ...e, when: e.all_day ? 'all day' : `${fmtLocal(e.start_at, tz(), { month: undefined, day: undefined })}-${fmtLocal(e.end_at, tz(), { month: undefined, day: undefined })}` }));
  const unread = all("SELECT thread_id, subject, from_name, from_email, last_date, customer_id FROM email_threads WHERE unread=1 AND labels LIKE '%INBOX%' ORDER BY last_date DESC LIMIT 20");
  const yb = bounds(addDays(day, -1), addDays(day, -1));
  const yesterday = {
    jobs_completed: all("SELECT number, title FROM jobs WHERE completed_at >= :s AND completed_at < :e", yb),
    payments: round2(get('SELECT COALESCE(SUM(amount),0) v FROM payments WHERE received_on=:d', { d: addDays(day, -1) }).v)
  };
  const actions = [];
  const add = (priority, text, tool, ref) => actions.push({ priority, text, tool, ref });
  for (const r of requests.filter(r => r.status === 'new')) add(r.priority === 'urgent' ? 1 : 2, `New request ${r.number} from ${r.name}${r.service ? ` (${r.service})` : ''} - contact them and convert it.`, 'convert_request', { request_id: r.id });
  for (const j of unscheduled.slice(0, 10)) add(j.priority === 'urgent' ? 1 : 3, `${j.number} ${j.title} for ${j.customer_name} is not scheduled.`, 'find_availability + schedule_visit', { job_id: j.id });
  for (const j of toInvoice) add(2, `${j.number} ${j.title} (${j.customer_name}) is complete but not invoiced.`, 'create_invoice(job_id) + send_invoice', { job_id: j.id });
  for (const o of overdue) if (!o.last_reminder_at || daysBetween(o.last_reminder_at.slice(0, 10), t) >= 7) add(o.days_overdue > 30 ? 1 : 2, `${o.number} for ${o.customer_name}: $${o.balance.toFixed(2)} is ${o.days_overdue} days overdue (${o.reminder_count} reminders sent).`, 'send_payment_reminder', { invoice_id: o.id });
  for (const e of awaiting) if (e.days_since_sent !== null && e.days_since_sent >= followDays) add(3, `Estimate ${e.number} ($${e.total.toFixed(2)}) for ${e.customer_name} sent ${e.days_since_sent} days ago${e.viewed_at ? ', viewed' : ', not opened yet'} - follow up.`, 'add_note / email_create_draft', { estimate_id: e.id });
  for (const x of tasks.filter(x => x.due_date && x.due_date < t)) add(2, `Overdue task: ${x.title} (${x.assignee || 'unassigned'}).`, 'update_task', { task_id: x.id });
  for (const v of visits.filter(v => !v.assignees.length)) add(1, `Today's visit ${v.local.start} for ${v.job_number} has no one assigned.`, 'update_visit', { visit_id: v.id });
  actions.sort((a, b2) => a.priority - b2.priority);
  return {
    date: day, time_zone: tz(), generated_at: now(),
    schedule: { visit_count: visits.length, by_person: byPerson, visits: visits.map(v => ({ id: v.id, job_id: v.job_id, job_number: v.job_number, title: v.job_title, customer: v.customer_name, address: v.address, start: v.local.start, end: v.local.end, status: v.status, crew: v.assignees.map(a => a.name), access_notes: v.access_notes || undefined })) },
    google_calendar_today: calendar, on_the_clock: onClock,
    unscheduled_jobs: unscheduled, jobs_to_invoice: toInvoice, overdue_invoices: overdue,
    receivables: get("SELECT COALESCE(SUM(balance),0) total, COUNT(*) invoices FROM invoices WHERE status IN ('sent','viewed','partial')"),
    estimates_awaiting_response: awaiting, open_requests: requests, tasks_due_soon: tasks, your_tasks: mine,
    unread_email: unread, yesterday, suggested_actions: actions.slice(0, 40)
  };
}

// ---------------- global search ----------------
op({
  name: 'search', method: 'GET', path: '/api/search', tags: ['Search'],
  title: 'Search everything', description: 'Search across customers, jobs, estimates, invoices, requests and tasks by number, name, title, email or phone.',
  input: S.obj({ q: S.str('', 200) }, ['q']),
  handler: (i, ctx) => {
    const q = i.q.trim(); if (q.length < 2) return [];
    const s = `%${q}%`; const d = q.replace(/\D/g, '');
    const books = R.BOOKS.includes(ctx.user.role);
    return [
      ...all(`SELECT 'customer' kind, id, number code, name label, trim(email || ' ' || phone) sub FROM customers WHERE name LIKE :s OR company LIKE :s OR email LIKE :s OR number LIKE :s
        OR (length(:d) >= 4 AND digits(phone) LIKE '%' || :d || '%') ORDER BY name LIMIT 6`, { s, d }),
      ...all(`SELECT 'job' kind, j.id, j.number code, j.title label, c.name || ' · ' || j.status sub FROM jobs j JOIN customers c ON c.id=j.customer_id WHERE j.number LIKE :s OR j.title LIKE :s OR c.name LIKE :s ORDER BY j.id DESC LIMIT 6`, { s }),
      ...(books ? all(`SELECT 'estimate' kind, e.id, e.number code, e.title label, c.name || ' · ' || e.status sub FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.number LIKE :s OR e.title LIKE :s OR c.name LIKE :s ORDER BY e.id DESC LIMIT 4`, { s }) : []),
      ...(books ? all(`SELECT 'invoice' kind, i.id, i.number code, COALESCE(NULLIF(i.title,''), c.name) label, c.name || ' · ' || i.status sub FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.number LIKE :s OR i.title LIKE :s OR c.name LIKE :s ORDER BY i.id DESC LIMIT 4`, { s }) : []),
      ...all(`SELECT 'request' kind, id, number code, name label, service || ' · ' || status sub FROM requests WHERE number LIKE :s OR name LIKE :s OR company LIKE :s OR email LIKE :s ORDER BY id DESC LIMIT 4`, { s }),
      ...all(`SELECT 'task' kind, id, 'TASK' code, title label, status sub FROM tasks WHERE title LIKE :s ORDER BY id DESC LIMIT 4`, { s })
    ];
  }
});

module.exports = { summary, revenueTrend, profitability, team, pipeline, briefing, generateKpiSnapshots, kpiTrend, bounds };
