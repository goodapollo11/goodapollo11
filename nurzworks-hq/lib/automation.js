'use strict';
// Background automation: integration deliveries, Gmail + Calendar sync, service plan jobs, overdue invoices,
// estimate expiry & follow-ups, optional customer reminders, Slack morning digest and KPI snapshots.
const { all, get, run, update, now, setting, setSetting } = require('./db');
const { daysBetween, addDays, zonedToUtc } = require('./util');
const { tz, today, nowLocal, n, flag } = require('./config');
const { systemCtx } = require('./ops');
const { emit } = require('./events');
const A = require('./services/activity');
const I = require('./integrations');

const ctx = () => systemCtx('Automation');
const log = (...a) => { if (!process.env.NW_QUIET) console.log(new Date().toISOString().slice(11, 19), ...a); };
async function safe(name, fn) { try { return await fn(); } catch (e) { console.error(`[automation:${name}]`, e.message); return null; } }

function estimateHousekeeping() {
  const t = today(); let expired = 0, followups = 0;
  for (const e of all("SELECT * FROM estimates WHERE status='sent' AND expiry_date IS NOT NULL AND expiry_date < :t", { t })) {
    update('estimates', e.id, { status: 'expired', updated_at: now() });
    A.log('estimate', e.id, 'Estimate expired without a decision.', { ctx: ctx(), kind: 'status' }); expired++;
  }
  const days = n('estimate_followup_days', 3);
  if (days > 0) {
    const assignee = Number(setting('auto_task_assignee') || 0) || null;
    for (const e of all(`SELECT e.*, c.name customer_name FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.status='sent' AND e.sent_at < :cut
        AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.related_type='estimate' AND k.related_id=e.id)`, { cut: new Date(Date.now() - days * 864e5).toISOString() })) {
      require('./services/tasks').createTask({ title: `Follow up on estimate ${e.number} for ${e.customer_name}`, details: `${e.title} - $${e.total.toFixed(2)}. Sent ${e.sent_at.slice(0, 10)}${e.viewed_at ? ', customer has viewed it' : ', not opened yet'}. Ask if they have questions or want to schedule.`,
        related_type: 'estimate', related_id: e.id, due_date: t, assigned_to: assignee, priority: 'normal' }, ctx());
      followups++;
    }
  }
  return { expired, followups };
}

function overdueInvoices() {
  const rows = all("SELECT id FROM invoices WHERE status IN ('sent','viewed','partial') AND due_date < :t AND overdue_notified_at IS NULL", { t: today() });
  for (const r of rows) {
    update('invoices', r.id, { overdue_notified_at: now() });
    A.log('invoice', r.id, 'Invoice is now overdue.', { ctx: ctx(), kind: 'status' });
    emit('invoice.overdue', { id: r.id }, ctx());
  }
  return rows.length;
}

async function autoReminders() {
  if (!flag('auto_reminders') || !I.gmail.connected()) return 0;
  const lt = nowLocal(); if (lt.hour < 9 || lt.hour >= 17) return 0; // business hours only
  const schedule = String(setting('reminder_days') || '3,10,30').split(',').map(Number).filter(x => x > 0).sort((a, b) => a - b);
  let sent = 0;
  for (const inv of all("SELECT * FROM invoices WHERE status IN ('sent','viewed','partial') AND due_date < :t AND balance > 0", { t: today() })) {
    const late = daysBetween(inv.due_date, today());
    const next = schedule[inv.reminder_count];
    if (next === undefined || late < next) continue;
    if (inv.last_reminder_at && Date.now() - new Date(inv.last_reminder_at) < 3 * 864e5) continue;
    await safe('reminder', async () => { await require('./services/invoices').remind(inv.id, {}, ctx()); sent++; });
  }
  return sent;
}

async function visitReminders() {
  if (!flag('visit_reminders') || !I.gmail.connected()) return 0;
  const lt = nowLocal(); if (lt.hour < 8 || lt.hour >= 18) return 0;
  const tomorrow = addDays(today(), 1);
  const s = zonedToUtc(tomorrow, '00:00', tz()).toISOString(), e = zonedToUtc(addDays(tomorrow, 1), '00:00', tz()).toISOString();
  const J = require('./services/jobs'); const tpl = require('./templates');
  let sent = 0;
  for (const v of all(`${J.VISIT_SELECT} WHERE v.start_at >= :s AND v.start_at < :e AND v.status='scheduled' AND v.reminder_sent_at IS NULL AND c.email != ''`, { s, e }).map(J.decorateVisit)) {
    await safe('visit-reminder', async () => {
      const m = tpl.visitReminderEmail(v);
      await require('./integrations/mailer').send({ to: v.customer_email, subject: m.subject, text: m.text, html: m.html, ctx: ctx(), customerId: v.customer_id, entity: ['job', v.job_id] });
      update('visits', v.id, { reminder_sent_at: now() });
      A.log('job', v.job_id, `Visit reminder emailed to ${v.customer_email}.`, { ctx: ctx(), kind: 'email' });
      sent++;
    });
  }
  return sent;
}

async function slackDigest() {
  const at = setting('slack_digest_time');
  if (!at || !I.slack.configured()) return false;
  const lt = nowLocal();
  if (setting('slack_last_digest') === lt.date || lt.time < at.padStart(5, '0')) return false;
  const wd = lt.weekday; if ((wd === 'Sat' || wd === 'Sun') && setting('slack_digest_weekends') !== '1') return false;
  setSetting('slack_last_digest', lt.date);
  I.OB.enqueue('slack', { text: I.slack.digestText() });
  return true;
}

function prune() {
  require('./auth').pruneSessions();
  run('DELETE FROM api_calls WHERE created_at < :t', { t: new Date(Date.now() - 90 * 864e5).toISOString() });
  I.OB.prune();
}

let ticks = 0, timer = null;
async function tick() {
  ticks++;
  await safe('outbox', () => I.OB.processOutbox());
  const gmailEvery = Number(setting('gmail_poll_minutes') || 5);
  if (gmailEvery > 0 && ticks % gmailEvery === 1 % gmailEvery) await safe('gmail', () => I.gmail.poll());
  if (ticks % 10 === 1) await safe('calendar', () => I.gcal.pull());
  if (ticks % 5 === 1) {
    await safe('digest', () => slackDigest());
    await safe('reminders', () => autoReminders());
    await safe('visit-reminders', () => visitReminders());
  }
  if (ticks % 60 === 1) await hourly();
  await safe('outbox', () => I.OB.processOutbox());
}
async function hourly() {
  const created = await safe('plans', () => require('./services/plans').generate({}, systemCtx('Service plan scheduler')));
  if (created && created.length) { log(`[plans] generated ${created.length} job(s)`); setSetting('last_plan_run', now()); }
  await safe('overdue', () => overdueInvoices());
  await safe('estimates', () => estimateHousekeeping());
  await safe('kpis', () => { require('./services/reports').generateKpiSnapshots(); setSetting('last_kpi_run', now()); });
  await safe('prune', () => prune());
}
function start() {
  if (timer) return;
  setTimeout(() => tick(), 1500);
  timer = setInterval(() => tick(), 60e3);
  timer.unref && timer.unref();
}
function stop() { clearInterval(timer); timer = null; }

module.exports = { start, stop, tick, hourly, overdueInvoices, estimateHousekeeping, autoReminders, visitReminders, slackDigest };
