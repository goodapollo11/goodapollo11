'use strict';
// Slack: team notifications (new leads, approvals, completed jobs, payments, AI staff task updates, customer email),
// a morning digest, and a /nurz slash command for lookups and quick entry from Slack.
const crypto = require('crypto');
const { all, get, setting, setSetting } = require('../db');
const { getSecret, setSecret } = require('../auth');
const { HttpError, bad, str, fmtMoney, fmtDate, fmtLocal, addDays, zonedToUtc } = require('../util');
const { op, S, execute, BY_NAME } = require('../ops');
const { tz, today, baseUrl, currency, company } = require('../config');

const API = () => (process.env.NW_SLACK_API_BASE || 'https://slack.com/api').replace(/\/$/, '');
const EVENTS = {
  'request.created': ['New service requests / leads', true],
  'estimate.approved': ['Estimate approved', true],
  'estimate.declined': ['Estimate declined', true],
  'estimate.viewed': ['Customer opened an estimate', false],
  'job.created': ['Job created', false],
  'job.completed': ['Job completed', true],
  'visit.scheduled': ['Visit scheduled', false],
  'visit.en_route': ['Tech on the way', false],
  'visit.on_site': ['Tech arrived on site', false],
  'visit.completed': ['Visit completed', true],
  'invoice.paid': ['Invoice paid in full', true],
  'payment.recorded': ['Partial payment received', true],
  'invoice.overdue': ['Invoice became overdue', true],
  'task.created': ['Task assigned to someone', true],
  'task.completed': ['Task completed (incl. AI staff)', true],
  'email.received': ['New email from a customer', true]
};
function enabledEvents() {
  let saved = null; try { saved = JSON.parse(setting('slack_events') || 'null'); } catch (_) { /* default */ }
  return Object.fromEntries(Object.entries(EVENTS).map(([k, [, d]]) => [k, saved && k in saved ? !!saved[k] : d]));
}
const webhookUrl = () => getSecret('slack_webhook_url') || '';
const botToken = () => getSecret('slack_bot_token') || '';
const channel = () => setting('slack_channel') || '';
const configured = () => !!(webhookUrl() || (botToken() && channel()));
const money = v => fmtMoney(v, currency());
const link = (path, text) => `<${baseUrl()}/#${path}|${String(text).replace(/[<>|]/g, '')}>`;

// ---------------- notifications ----------------
function format(event, data, ctx) {
  const who = ctx && ctx.actor ? ctx.actor : 'Someone';
  switch (event) {
    case 'request.created': {
      const r = get('SELECT * FROM requests WHERE id=:id', { id: data.id }); if (!r) return null;
      return `:inbox_tray: New request ${link('/requests/' + r.id, r.number)} from *${r.name}*${r.company ? ` (${r.company})` : ''} via ${r.source}${r.service ? ` - ${r.service}` : ''}${r.priority === 'urgent' ? ' :rotating_light: *URGENT*' : ''}\n>${(r.details || '').slice(0, 280).replace(/\n/g, '\n>')}`;
    }
    case 'estimate.approved': case 'estimate.declined': case 'estimate.viewed': {
      const e = get('SELECT e.*, c.name customer_name FROM estimates e JOIN customers c ON c.id=e.customer_id WHERE e.id=:id', { id: data.id }); if (!e) return null;
      if (event === 'estimate.viewed') return `:eyes: ${e.customer_name} opened estimate ${link('/estimates/' + e.id, e.number)} (${money(e.total)})`;
      return event === 'estimate.approved'
        ? `:white_check_mark: Estimate ${link('/estimates/' + e.id, e.number)} *approved* by ${data.by || e.approved_name || e.customer_name} - ${e.title} - *${money(e.total)}*`
        : `:x: Estimate ${link('/estimates/' + e.id, e.number)} declined by ${e.customer_name} - ${e.title} (${money(e.total)})${data.reason ? `\n>${data.reason}` : ''}`;
    }
    case 'job.created': case 'job.completed': {
      const j = get('SELECT j.*, c.name customer_name FROM jobs j JOIN customers c ON c.id=j.customer_id WHERE j.id=:id', { id: data.id }); if (!j) return null;
      return event === 'job.created' ? `:clipboard: New job ${link('/jobs/' + j.id, j.number)} ${j.title} for ${j.customer_name}` : `:tada: ${link('/jobs/' + j.id, j.number)} *${j.title}* for ${j.customer_name} completed by ${who}. Ready to invoice.`;
    }
    case 'visit.scheduled': case 'visit.status_changed': {
      const v = get('SELECT v.*, j.number, j.title, j.id job_id, c.name customer_name FROM visits v JOIN jobs j ON j.id=v.job_id JOIN customers c ON c.id=j.customer_id WHERE v.id=:id', { id: data.id }); if (!v) return null;
      const key = event === 'visit.scheduled' ? 'visit.scheduled' : `visit.${data.status}`;
      if (!enabledEvents()[key]) return null;
      const when = fmtLocal(v.start_at, tz(), { weekday: 'short' });
      return {
        'visit.scheduled': `:calendar: Visit booked ${when} - ${link('/jobs/' + v.job_id, v.number)} ${v.title} (${v.customer_name})`,
        'visit.en_route': `:truck: ${who} is on the way to ${v.customer_name} - ${link('/jobs/' + v.job_id, v.number)} ${v.title}`,
        'visit.on_site': `:round_pushpin: ${who} arrived at ${v.customer_name} - ${link('/jobs/' + v.job_id, v.number)}`,
        'visit.completed': `:heavy_check_mark: ${who} finished the visit at ${v.customer_name} - ${link('/jobs/' + v.job_id, v.number)} ${v.title}${v.completion_notes ? `\n>${v.completion_notes.slice(0, 280)}` : ''}`
      }[key] || null;
    }
    case 'invoice.paid': case 'invoice.overdue': {
      const i = get('SELECT i.*, c.name customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=:id', { id: data.id }); if (!i) return null;
      return event === 'invoice.paid' ? `:moneybag: ${link('/invoices/' + i.id, i.number)} *paid in full* - ${money(i.total)} from ${i.customer_name}`
        : `:warning: ${link('/invoices/' + i.id, i.number)} for ${i.customer_name} is now *overdue* - ${money(i.balance)} was due ${fmtDate(i.due_date)}`;
    }
    case 'payment.recorded': {
      const i = get('SELECT i.*, c.name customer_name FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=:id', { id: data.invoice_id }); if (!i || i.status === 'paid') return null;
      return `:dollar: Payment ${money(data.amount)} received from ${i.customer_name} on ${link('/invoices/' + i.id, i.number)} - ${money(i.balance)} still due`;
    }
    case 'task.created': case 'task.completed': {
      const t = get('SELECT t.*, u.name assignee, u.kind FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.id=:id', { id: data.id }); if (!t) return null;
      if (event === 'task.created') { if (!t.assigned_to || (ctx && ctx.user && ctx.user.id === t.assigned_to)) return null; return `:memo: New task for *${t.assignee}*${t.kind === 'ai' ? ' (AI)' : ''}: ${link('/tasks?id=' + t.id, t.title)}${t.due_date ? ` - due ${fmtDate(t.due_date)}` : ''} (from ${t.created_by})`; }
      return `:ballot_box_with_check: *${t.assignee || who}* completed: ${link('/tasks?id=' + t.id, t.title)}${t.result ? `\n>${t.result.slice(0, 400).replace(/\n/g, '\n>')}` : ''}`;
    }
    case 'email.received':
      if (!data.customer_id && setting('slack_email_all') !== '1') return null;
      return `:email: New email from *${data.from_name || data.from_email}*${data.customer_name ? ` (customer: ${data.customer_name})` : ''}: "${data.subject}"\n>${(data.snippet || '').slice(0, 200)}`;
    default: return null;
  }
}
function shouldNotify(event) {
  if (!configured()) return false;
  if (event === 'visit.status_changed' || event === 'visit.scheduled') return true; // filtered per status inside format()
  return !!enabledEvents()[event];
}

async function post({ text, blocks }) {
  if (botToken() && channel()) {
    const res = await fetch(`${API()}/chat.postMessage`, { method: 'POST', headers: { Authorization: `Bearer ${botToken()}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ channel: channel(), text, blocks, unfurl_links: false, unfurl_media: false }) });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new HttpError(502, `Slack: ${data.error || res.status}`);
    return { ok: true, ts: data.ts };
  }
  if (webhookUrl()) {
    const res = await fetch(webhookUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, blocks }) });
    if (!res.ok) throw new HttpError(502, `Slack webhook: ${res.status} ${await res.text().catch(() => '')}`);
    return { ok: true };
  }
  throw new HttpError(409, 'Slack is not connected.');
}

// ---------------- morning digest ----------------
function digestText() {
  const b = require('../services/reports').briefing(today(), null);
  const lines = [`:sunrise: *${company().name} - ${fmtDate(today(), { weekday: 'long', month: 'long', day: 'numeric' })}*`];
  const people = Object.entries(b.schedule.by_person);
  lines.push(people.length ? `*Today's schedule (${b.schedule.visit_count} visits)*\n` + people.map(([n, v]) => `• *${n}*: ${v.length} - ${v.map(x => x.split(' @ ')[0]).join('; ')}`).join('\n') : '*Today\'s schedule:* nothing booked.');
  if (b.google_calendar_today.length) lines.push(`*Calendar*: ${b.google_calendar_today.map(e => `${e.when} ${e.summary}`).join('; ')}`);
  const stats = [
    b.open_requests.filter(r => r.status === 'new').length && `${b.open_requests.filter(r => r.status === 'new').length} new request(s)`,
    b.unscheduled_jobs.length && `${b.unscheduled_jobs.length} job(s) to schedule`,
    b.jobs_to_invoice.length && `${b.jobs_to_invoice.length} job(s) to invoice`,
    b.overdue_invoices.length && `${b.overdue_invoices.length} overdue invoice(s) (${money(b.overdue_invoices.reduce((s, x) => s + x.balance, 0))})`,
    b.estimates_awaiting_response.length && `${b.estimates_awaiting_response.length} estimate(s) awaiting an answer`,
    b.tasks_due_soon.length && `${b.tasks_due_soon.length} task(s) due`
  ].filter(Boolean);
  lines.push(stats.length ? '*Needs attention:* ' + stats.join(' · ') : ':white_check_mark: Nothing urgent in the office queue.');
  if (b.yesterday.payments) lines.push(`Yesterday: ${money(b.yesterday.payments)} collected, ${b.yesterday.jobs_completed.length} job(s) completed.`);
  lines.push(link('/dashboard', 'Open HQ'));
  return lines.join('\n');
}

// ---------------- slash command ----------------
function verify(raw, headers) {
  const secret = getSecret('slack_signing_secret');
  if (!secret) return false;
  const ts = Number(headers['x-slack-request-timestamp']);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const sig = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex');
  const got = String(headers['x-slack-signature'] || '');
  return got.length === sig.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(sig));
}
function slackCtx(p) {
  const name = `${p.user_name || p.user_id || 'slack'} (Slack)`;
  return { user: { id: null, name, role: 'office', kind: 'system', active: 1 }, key: null, scopes: ['read', 'write'], via: 'slack', actor: name };
}
const run2 = (name, input, ctx) => execute(BY_NAME.get(name), input, ctx);
async function command(p) {
  const ctx = slackCtx(p);
  const text = str(p.text);
  const [sub, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ').trim();
  const cmd = (sub || 'help').toLowerCase();
  const say = t => ({ response_type: 'ephemeral', text: t });
  const visitLine = v => `• ${v.local.start.split(', ').pop()} - ${link('/jobs/' + v.job_id, v.job_number)} ${v.job_title} @ ${v.customer_name}${v.assignees.length ? ` (${v.assignees.map(a => a.name).join(', ')})` : ' (unassigned)'}`;
  switch (cmd) {
    case 'today': case 'tomorrow': case 'week': {
      const from = cmd === 'tomorrow' ? addDays(today(), 1) : today();
      const to = cmd === 'week' ? addDays(from, 6) : from;
      const vs = await run2('list_visits', { from, to }, ctx);
      return say(vs.length ? `*Schedule ${cmd}* (${vs.length})\n${vs.map(visitLine).join('\n')}` : `Nothing scheduled ${cmd}.`);
    }
    case 'job': {
      if (!arg) return say('Usage: `/nurz job JOB-00012` or `/nurz job <search>`');
      const rows = await run2('list_jobs', { q: arg, status: 'all', limit: 5 }, ctx);
      if (!rows.length) return say(`No job matches "${arg}".`);
      const j = await run2('get_job', { id: rows[0].id }, ctx);
      return say(`*${link('/jobs/' + j.id, j.number)} ${j.title}* - ${j.status_label}\nCustomer: ${j.customer_name}${j.customer_phone ? ' · ' + j.customer_phone : ''}\n${j.address ? 'Address: ' + j.address + '\n' : ''}${j.next_visit ? 'Next visit: ' + fmtLocal(j.next_visit, tz(), { weekday: 'short' }) + '\n' : ''}Job value ${money(j.financials.revenue)} · cost ${money(j.financials.total_cost)}${rows.length > 1 ? `\n_Also matched: ${rows.slice(1).map(r => r.number).join(', ')}_` : ''}`);
    }
    case 'customer': case 'cust': {
      if (!arg) return say('Usage: `/nurz customer <name, phone or email>`');
      const rows = await run2('list_customers', { q: arg, limit: 5 }, ctx);
      if (!rows.length) return say(`No customer matches "${arg}".`);
      return say(rows.map(c => `*${link('/customers/' + c.id, c.name)}* (${c.number}) ${c.phone || ''} ${c.email || ''}\n   ${c.address || 'no address'} · ${c.open_jobs} open job(s) · balance ${money(c.balance)}`).join('\n'));
    }
    case 'invoice': case 'inv': {
      const rows = await run2('list_invoices', { q: arg, status: 'all', limit: 1 }, ctx);
      if (!rows.length) return say(`No invoice matches "${arg}".`);
      const i = rows[0];
      return say(`*${link('/invoices/' + i.id, i.number)}* ${i.customer_name} - ${i.status}${i.is_overdue ? ' (OVERDUE)' : ''}\nTotal ${money(i.total)} · balance ${money(i.balance)} · due ${fmtDate(i.due_date)}`);
    }
    case 'unpaid': case 'ar': {
      const a = await run2('get_ar_aging', {}, ctx);
      return say(`*Receivables ${money(a.totals.total)}* (current ${money(a.totals.current)}, 1-30 ${money(a.totals.d1_30)}, 31-60 ${money(a.totals.d31_60)}, 61-90 ${money(a.totals.d61_90)}, 90+ ${money(a.totals.d90_plus)})\n` +
        a.customers.slice(0, 10).map(c => `• ${c.customer_name}: ${money(c.total)} (${c.invoices.map(x => x.number).join(', ')})`).join('\n'));
    }
    case 'unscheduled': {
      const rows = await run2('list_jobs', { status: 'unscheduled', limit: 15 }, ctx);
      return say(rows.length ? `*Jobs to schedule (${rows.length})*\n${rows.map(j => `• ${link('/jobs/' + j.id, j.number)} ${j.title} - ${j.customer_name} (${j.priority})`).join('\n')}` : 'Every job is scheduled. :tada:');
    }
    case 'briefing': case 'digest': return say(digestText());
    case 'task': {
      if (!arg) return say('Usage: `/nurz task Call Jane about the quote due:2026-11-20`');
      const due = (arg.match(/due:(\d{4}-\d{2}-\d{2})/) || [])[1];
      const t = await run2('create_task', { title: arg.replace(/due:\S+/, '').trim(), due_date: due }, ctx);
      return say(`:memo: Task created: ${link('/tasks?id=' + t.id, t.title)}${due ? ` (due ${fmtDate(due)})` : ''}`);
    }
    case 'lead': {
      const parts = arg.split('|').map(x => x.trim());
      if (!parts[0]) return say('Usage: `/nurz lead Jane Smith | 262-555-0101 or jane@x.com | Furnace not heating`');
      const contact = parts[1] || '';
      const r = await run2('create_request', { name: parts[0], email: contact.includes('@') ? contact : '', phone: contact.includes('@') ? '' : contact, details: parts.slice(2).join(' | '), source: 'slack' }, ctx);
      return say(`:inbox_tray: Lead ${link('/requests/' + r.id, r.number)} created for ${r.name}.`);
    }
    case 'note': {
      const m = arg.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m) return say('Usage: `/nurz note JOB-00012 Customer asked for a morning slot`');
      const j = get('SELECT id, number FROM jobs WHERE number=:n COLLATE NOCASE', { n: m[1] });
      if (!j) return say(`No job ${m[1]}.`);
      await run2('add_note', { entity_type: 'job', entity_id: j.id, body: m[2] }, ctx);
      return say(`:pencil: Note added to ${link('/jobs/' + j.id, j.number)}.`);
    }
    default:
      return say(['*NurzWorks HQ commands*', '`/nurz today` · `tomorrow` · `week` - schedule', '`/nurz job JOB-00012` (or search)', '`/nurz customer <name/phone/email>`',
        '`/nurz invoice INV-00012`', '`/nurz unpaid` - receivables', '`/nurz unscheduled` - jobs to book', '`/nurz briefing` - daily summary',
        '`/nurz task <text> due:YYYY-MM-DD`', '`/nurz lead Name | phone or email | details`', '`/nurz note JOB-00012 <text>`'].join('\n'));
  }
}

function status() {
  return {
    configured: configured(), mode: botToken() && channel() ? 'bot' : webhookUrl() ? 'webhook' : 'none', channel: channel(), has_webhook: !!webhookUrl(), has_bot_token: !!botToken(),
    has_signing_secret: !!getSecret('slack_signing_secret'), events: enabledEvents(), event_labels: Object.fromEntries(Object.entries(EVENTS).map(([k, [l]]) => [k, l])),
    digest_time: setting('slack_digest_time') || '', email_all: setting('slack_email_all') === '1', command_url: `${baseUrl()}/integrations/slack/commands`, last_digest: setting('slack_last_digest') || ''
  };
}
function save(i) {
  if (i.webhook_url !== undefined) { if (i.webhook_url && !/^https:\/\/hooks\.slack\.com\//.test(i.webhook_url) && !process.env.NW_SLACK_API_BASE) bad('Incoming webhook URLs start with https://hooks.slack.com/'); setSecret('slack_webhook_url', str(i.webhook_url)); }
  if (i.bot_token !== undefined) { if (i.bot_token && !/^xox[bp]-/.test(i.bot_token)) bad('Bot tokens start with xoxb-'); setSecret('slack_bot_token', str(i.bot_token)); }
  if (i.signing_secret !== undefined) setSecret('slack_signing_secret', str(i.signing_secret));
  if (i.channel !== undefined) setSetting('slack_channel', str(i.channel).replace(/^#/, ''));
  if (i.events) setSetting('slack_events', JSON.stringify(i.events));
  if (i.digest_time !== undefined) { if (i.digest_time && !/^\d{1,2}:\d{2}$/.test(i.digest_time)) bad('digest_time must look like 07:00'); setSetting('slack_digest_time', i.digest_time); }
  if (i.email_all !== undefined) setSetting('slack_email_all', i.email_all ? '1' : '0');
}

op({
  name: 'slack_post', method: 'POST', path: '/api/slack/post', tags: ['Slack'],
  title: 'Post to the team Slack channel', description: 'Post a message to the business Slack channel, e.g. to report finished work or ask the owner a question. Slack mrkdwn formatting is supported.',
  input: S.obj({ text: S.str('', 4000) }, ['text']),
  handler: async (i, ctx) => post({ text: `${i.text}\n_- ${ctx.actor}_` })
});

module.exports = { configured, format, shouldNotify, post, digestText, verify, command, status, save, EVENTS };
