'use strict';
// Settings, app metadata, the AI staff playbook and the business profile AI staff read for context.
const { all, get, setting, setSetting, now } = require('../db');
const { bad, str, num, validTz, emailOk } = require('../util');
const { op, S } = require('../ops');
const AU = require('../auth');
const { R } = AU;
const { tz, today, company, baseUrl } = require('../config');

const VERSION = require('../../package.json').version;
const THEMES = ['nurzworks', 'forest', 'forest-night'];

const DEFAULT_PLAYBOOK = `# Office playbook for AI staff

You are part of the office team at this mobile service and consulting business. The owner runs the field work;
you keep the office running: customers, scheduling, estimates, invoicing, email and follow-ups. Everything you do
is recorded under your own name, so work like a careful, friendly office manager.

## Start of every session
1. Call **get_me** to see your role and standing instructions, then **get_briefing** for today's priorities.
2. Work your own queue: **list_tasks** with assigned_to="me". Mark each task in_progress, do it, then
   **update_task** status="done" with a short result. If blocked, set status="waiting" and explain why.
3. Work the briefing's suggested_actions from the top.

## Ground rules
- Never delete records. Never change price book prices, tax rates or settings unless the owner asked you to.
- Look before you create: search customers (list_customers with q = name, email or phone) before creating one.
  create_customer reports possible_duplicates - use the existing record instead of making a new one.
- Customer email: write in a warm, plain, professional voice and sign as the business. Unless your instructions
  say you may send directly, use **email_create_draft** so the owner can review and send it.
- Money: never promise discounts, refunds or price changes. Quote from the price book (list_pricebook).
- Log what matters: add_note on the customer or job for calls, promises and decisions.
- When you are unsure, create a task for the owner (assigned to the owner) or post in Slack with **slack_post**.

## Leads and requests
- New request: check for an existing customer, then convert_request to a job (clear repair/service work) or an
  estimate (anything that needs a price first). Reply to the customer the same day.

## Scheduling
- Use **find_availability** before **schedule_visit**. Respect working hours and Google Calendar busy time.
- schedule_visit returns conflicts - resolve them instead of double-booking.
- Urgent jobs: offer the earliest slot and tell the owner in Slack.

## Estimates
- Build from the price book. Include a trip charge for field visits. Put scope and assumptions in the message.
- Follow up on estimates that were sent 3+ days ago without an answer.

## Invoicing and collections
- Invoice completed jobs promptly: **create_invoice** with job_id pulls in the job's items, billable time and
  expenses. Review, then send_invoice (or leave as draft if anything looks off and create a task).
- Overdue invoices: send_payment_reminder at most once a week. Over 60 days late: create a task for the owner.

## Customer details to always capture
Name, best phone, email, service address, access notes (gate codes, pets, parking), and how they found us.
`;

const EDITABLE = {
  company_name: 'str', company_tagline: 'str', company_email: 'email', company_phone: 'str', company_address: 'text', company_website: 'str',
  timezone: 'tz', currency: ['USD', 'CAD', 'EUR', 'GBP', 'AUD'], tax_rate: 'num', default_terms_days: 'int', default_bill_rate: 'num', default_cost_rate: 'num', mileage_rate: 'num',
  estimate_valid_days: 'int', estimate_terms: 'text', estimate_message: 'text', invoice_terms: 'text', invoice_message: 'text', payment_instructions: 'text',
  workday_start: 'time', workday_end: 'time', default_visit_minutes: 'int', auto_job_on_approval: 'bool', auto_reminders: 'bool', reminder_days: 'str',
  estimate_followup_days: 'int', visit_reminders: 'bool', track_travel: 'bool', theme_default: THEMES, base_url: 'url', cmms_url: 'url', service_area: 'text', business_hours: 'text'
};
function readSettings() { return Object.fromEntries(Object.keys(EDITABLE).map(k => [k, setting(k) ?? ''])); }

op({
  name: 'get_meta', method: 'GET', path: '/api/meta', tags: ['App'], mcp: false, title: 'App metadata', input: S.obj({}),
  handler: (i, ctx) => {
    const I = require('../integrations');
    const u = ctx.user;
    return {
      version: VERSION, company: company(), timezone: tz(), today: today(), currency: setting('currency') || 'USD', theme_default: setting('theme_default') || 'nurzworks',
      me: { ...AU.publicUser(get('SELECT * FROM users WHERE id=:id', { id: u.id }) || u), scopes: ctx.scopes },
      team: all("SELECT id, name, role, kind, color, title, email, phone FROM users WHERE active=1 ORDER BY kind, name"),
      settings: Object.fromEntries(['tax_rate', 'workday_start', 'workday_end', 'default_visit_minutes', 'mileage_rate', 'default_terms_days', 'default_bill_rate', 'cmms_url', 'base_url', 'estimate_valid_days']
        .map(k => [k, setting(k)])),
      integrations: { google_configured: I.G.configured(), gmail: I.gmail.connected(), gcal: I.gcal.connected(), slack: I.slack.configured(), stripe: I.stripe.enabled(), google_error: setting('google_error') || '' },
      badges: {
        requests: get("SELECT COUNT(*) n FROM requests WHERE status='new'").n,
        unscheduled: get("SELECT COUNT(*) n FROM jobs WHERE status='unscheduled'").n,
        to_invoice: get("SELECT COUNT(*) n FROM jobs WHERE status='completed' AND billing != 'no_charge'").n,
        overdue_invoices: get("SELECT COUNT(*) n FROM invoices WHERE status IN ('sent','viewed','partial') AND due_date < :t", { t: today() }).n,
        my_tasks: get("SELECT COUNT(*) n FROM tasks WHERE assigned_to=:u AND status IN ('open','in_progress','waiting')", { u: u.id }).n,
        unread_email: get("SELECT COUNT(*) n FROM email_threads WHERE unread=1 AND labels LIKE '%INBOX%'").n
      },
      has_demo: !!get('SELECT id FROM customers WHERE is_demo=1 LIMIT 1'),
      is_empty: !get('SELECT id FROM customers LIMIT 1')
    };
  }
});

op({ name: 'get_settings', method: 'GET', path: '/api/settings', tags: ['App'], scope: 'admin', mcp: false, title: 'Settings', input: S.obj({}),
  handler: () => ({ ...readSettings(), db_path: require('../db').DB_PATH, version: VERSION, detected_base_url: baseUrl(),
    counts: Object.fromEntries(['customers', 'jobs', 'visits', 'estimates', 'invoices', 'payments', 'time_entries', 'tasks', 'users'].map(t => [t, get(`SELECT COUNT(*) n FROM ${t}`).n])),
    has_demo: !!get('SELECT id FROM customers WHERE is_demo=1 LIMIT 1'), last_kpi_run: setting('last_kpi_run'), last_plan_run: setting('last_plan_run') }) });
op({
  name: 'update_settings', method: 'PUT', path: '/api/settings', tags: ['App'], scope: 'admin', mcp: false, title: 'Update settings', input: { type: 'object' },
  handler: i => {
    for (const [k, type] of Object.entries(EDITABLE)) {
      if (i[k] === undefined) continue;
      let v = i[k];
      if (Array.isArray(type)) { if (!type.includes(v)) bad(`${k} must be one of ${type.join(', ')}`); }
      else if (type === 'num' || type === 'int') { v = num(v, NaN); if (!isFinite(v) || v < 0) bad(`${k} must be a positive number.`); if (type === 'int') v = Math.round(v); }
      else if (type === 'bool') v = v === true || v === '1' || v === 1 || v === 'true' ? '1' : '0';
      else if (type === 'tz') { v = str(v); if (!validTz(v)) bad(`${v} is not a valid time zone (try America/Chicago).`); }
      else if (type === 'time') { v = str(v); if (!/^\d{1,2}:\d{2}$/.test(v)) bad(`${k} must look like 08:00.`); v = v.padStart(5, '0'); }
      else if (type === 'email') { v = str(v).toLowerCase(); if (v && !emailOk(v)) bad(`${k} must be an email address.`); }
      else if (type === 'url') { v = str(v).replace(/\/+$/, ''); if (v && !/^https?:\/\/[^\s]+$/.test(v)) bad(`${k} must start with http:// or https://`); }
      else v = type === 'text' ? String(v ?? '') : str(v);
      setSetting(k, v);
    }
    if (setting('workday_start') >= setting('workday_end')) bad('The workday must end after it starts.');
    return readSettings();
  }
});

op({
  name: 'get_business_profile', method: 'GET', path: '/api/business', tags: ['App'],
  title: 'Business profile', description: 'Who the business is: name, contact info, time zone, working hours, service area, tax and payment terms, services and prices (price book summary), team roster and the office playbook. Read this once per session for context.',
  input: S.obj({}),
  handler: () => ({
    company: company(), time_zone: tz(), today: today(), currency: setting('currency'), working_hours: `${setting('workday_start')}-${setting('workday_end')}`,
    business_hours: setting('business_hours') || '', service_area: setting('service_area') || '', tax_rate_pct: Number(setting('tax_rate') || 0),
    payment_terms_days: Number(setting('default_terms_days') || 14), default_bill_rate: Number(setting('default_bill_rate') || 0), payment_instructions: setting('payment_instructions') || '',
    services: all("SELECT id, code, name, kind, unit, price, category FROM pricebook WHERE active=1 ORDER BY category, name"),
    team: all("SELECT id, name, role, kind, title FROM users WHERE active=1 ORDER BY kind, name"),
    links: { app: baseUrl(), request_form: `${baseUrl()}/request` },
    playbook: setting('ai_playbook') || DEFAULT_PLAYBOOK
  })
});
op({
  name: 'get_playbook', method: 'GET', path: '/api/playbook', tags: ['App'],
  title: 'Office playbook', description: 'The owner\'s standing instructions and procedures for AI office staff (markdown). Follow it.',
  input: S.obj({}), handler: () => ({ playbook: setting('ai_playbook') || DEFAULT_PLAYBOOK, customized: !!setting('ai_playbook'), updated_at: setting('ai_playbook_updated_at') })
});
op({
  name: 'update_playbook', method: 'PUT', path: '/api/playbook', tags: ['App'], scope: 'admin', mcp: false, title: 'Edit playbook',
  input: S.obj({ playbook: S.str('', 100000), reset: S.bool() }),
  handler: i => {
    if (i.reset) setSetting('ai_playbook', null); else setSetting('ai_playbook', String(i.playbook || ''));
    setSetting('ai_playbook_updated_at', now());
    return { playbook: setting('ai_playbook') || DEFAULT_PLAYBOOK, customized: !!setting('ai_playbook') };
  }
});

// ---------------- customer-facing pages ----------------
op({
  name: 'public_info', method: 'GET', path: '/public/info', public: true, mcp: false, tags: ['Customer portal'], title: 'Public business info', input: S.obj({}),
  handler: () => ({ company: company(), theme: setting('theme_default') || 'nurzworks', service_area: setting('service_area') || '', business_hours: setting('business_hours') || '',
    services: all("SELECT DISTINCT name FROM pricebook WHERE active=1 AND kind='service' ORDER BY name LIMIT 30").map(r => r.name) })
});
op({
  name: 'public_customer_hub', method: 'GET', path: '/public/customers/:token', public: true, mcp: false, tags: ['Customer portal'], title: 'Customer hub', input: S.obj({ token: S.str() }, ['token']),
  handler: i => {
    const c = get('SELECT id, name FROM customers WHERE portal_token=:t', { t: i.token });
    if (!c) { const { notFound } = require('../util'); notFound('Page'); }
    return {
      customer: { name: c.name }, company: company(), theme: setting('theme_default') || 'nurzworks',
      estimates: all("SELECT number, title, total, status, issue_date, expiry_date, public_token FROM estimates WHERE customer_id=:c AND status IN ('sent','approved','converted') ORDER BY id DESC LIMIT 20", { c: c.id }),
      invoices: all("SELECT number, title, total, balance, status, issue_date, due_date, public_token FROM invoices WHERE customer_id=:c AND status NOT IN ('draft','void') ORDER BY id DESC LIMIT 30", { c: c.id }),
      visits: all("SELECT v.start_at, v.end_at, v.status, j.title FROM visits v JOIN jobs j ON j.id=v.job_id WHERE j.customer_id=:c AND v.status IN ('scheduled','en_route','on_site') AND v.end_at > :t ORDER BY v.start_at LIMIT 10", { c: c.id, t: now() }),
      time_zone: tz()
    };
  }
});

op({ name: 'load_demo', method: 'POST', path: '/api/demo/load', tags: ['App'], scope: 'admin', mcp: false, title: 'Load sample data', input: S.obj({}),
  handler: (i, ctx) => require('../seed').loadDemo(ctx) });
op({ name: 'remove_demo', method: 'POST', path: '/api/demo/remove', tags: ['App'], scope: 'admin', mcp: false, title: 'Remove sample data', input: S.obj({}),
  handler: () => require('../seed').removeDemo() });

module.exports = { DEFAULT_PLAYBOOK, VERSION, THEMES, readSettings };
