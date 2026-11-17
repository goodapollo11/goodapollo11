'use strict';
// Wires business events to integrations and exposes the Integrations admin page operations.
const { all, get, setting, setSetting } = require('../db');
const { bad, str } = require('../util');
const { op, S } = require('../ops');
const { getSecret, setSecret } = require('../auth');
const { on } = require('../events');
const { baseUrl } = require('../config');
const OB = require('./outbox');
const G = require('./google');
const gmail = require('./gmail');
const gcal = require('./gcal');
const slack = require('./slack');
const WH = require('./webhooks');
const stripe = require('./stripe');

// ---------------- delivery handlers ----------------
OB.register('slack', p => slack.post(p));
OB.register('webhook', p => WH.deliver(p));
OB.register('gcal', async p => {
  if (!gcal.connected()) return; // disconnected since queued: drop silently
  if (p.op === 'delete') return gcal.deleteEvent(p.event_id);
  return gcal.upsertVisit(p.visit_id);
});

// ---------------- event routing (runs inside the business transaction; only enqueues) ----------------
on((event, data, ctx) => {
  if (gcal.connected()) {
    if (['visit.scheduled', 'visit.updated', 'visit.status_changed', 'visit.cancelled'].includes(event)) OB.enqueue('gcal', { op: 'upsert', visit_id: data.id });
    if (event === 'visit.deleted' && data.gcal_event_id) OB.enqueue('gcal', { op: 'delete', event_id: data.gcal_event_id });
  }
  if (slack.shouldNotify(event)) {
    const text = slack.format(event, data, ctx);
    if (text) OB.enqueue('slack', { text });
  }
  WH.enqueueFor(event, data, OB.enqueue);
});

// ---------------- Integrations page ----------------
const ADMIN = { scope: 'admin', mcp: false, tags: ['Integrations'] };
op({
  ...ADMIN, name: 'get_integrations', method: 'GET', path: '/api/integrations', title: 'Integration status', input: S.obj({}),
  handler: () => ({
    base_url: baseUrl(),
    google: G.status(),
    gmail: { enabled: gmail.enabled(), connected: gmail.connected(), last_sync: setting('gmail_last_sync'), poll_minutes: Number(setting('gmail_poll_minutes') || 5) },
    calendar: { enabled: gcal.enabled(), connected: gcal.connected(), calendar_id: gcal.calId(), owner_user_id: Number(setting('gcal_owner_user_id') || 0) || null,
      invite_assignees: setting('gcal_invite_assignees') === '1', last_pull: setting('gcal_last_pull'),
      unsynced: get("SELECT COUNT(*) n FROM visits WHERE status != 'cancelled' AND end_at > :t AND (gcal_event_id IS NULL OR gcal_synced_at < updated_at)", { t: new Date().toISOString() }).n },
    slack: slack.status(),
    stripe: { enabled: stripe.enabled(), has_webhook_secret: !!getSecret('stripe_webhook_secret'), webhook_url: `${baseUrl()}/integrations/stripe/webhook` },
    webhooks: get('SELECT COUNT(*) n FROM webhooks WHERE active=1').n,
    lead_hook_url: WH.leadHookUrl(),
    mcp: { url: `${baseUrl()}/mcp`, openapi: `${baseUrl()}/api/openapi.json`, llms_txt: `${baseUrl()}/llms.txt` },
    outbox: OB.stats()
  })
});
op({
  ...ADMIN, name: 'save_google_credentials', method: 'PUT', path: '/api/integrations/google', title: 'Save Google OAuth client',
  input: S.obj({ client_id: S.str('', 300), client_secret: S.str('', 300) }),
  handler: i => {
    if (i.client_id && !/\.apps\.googleusercontent\.com$/.test(i.client_id.trim())) bad('The client ID should end with .apps.googleusercontent.com');
    G.saveCredentials(i); return G.status();
  }
});
op({ ...ADMIN, name: 'disconnect_google', method: 'POST', path: '/api/integrations/google/disconnect', title: 'Disconnect Google', input: S.obj({}), handler: async () => { await G.disconnect(); return G.status(); } });
op({
  ...ADMIN, name: 'save_calendar_settings', method: 'PUT', path: '/api/integrations/calendar', title: 'Calendar settings',
  input: S.obj({ enabled: S.bool(), calendar_id: S.str('', 300), owner_user_id: S.idOpt, invite_assignees: S.bool() }),
  handler: i => {
    if (i.enabled !== undefined) setSetting('gcal_enabled', i.enabled ? '1' : '0');
    if (i.calendar_id !== undefined) { setSetting('gcal_calendar_id', str(i.calendar_id) || 'primary'); require('../db').run('DELETE FROM calendar_events WHERE visit_id IS NULL'); }
    if (i.owner_user_id !== undefined) setSetting('gcal_owner_user_id', i.owner_user_id || null);
    if (i.invite_assignees !== undefined) setSetting('gcal_invite_assignees', i.invite_assignees ? '1' : '0');
    return { ok: true };
  }
});
op({
  ...ADMIN, name: 'save_gmail_settings', method: 'PUT', path: '/api/integrations/gmail', title: 'Gmail settings',
  input: S.obj({ enabled: S.bool(), poll_minutes: S.int('', { minimum: 0, maximum: 120 }) }),
  handler: i => { if (i.enabled !== undefined) setSetting('gmail_enabled', i.enabled ? '1' : '0'); if (i.poll_minutes !== undefined) setSetting('gmail_poll_minutes', i.poll_minutes); return { ok: true }; }
});
op({
  ...ADMIN, name: 'save_slack_settings', method: 'PUT', path: '/api/integrations/slack', title: 'Slack settings',
  input: S.obj({ webhook_url: S.str('', 500), bot_token: S.str('', 300), channel: S.str('', 100), signing_secret: S.str('', 200), events: { type: 'object' }, digest_time: S.str('', 10), email_all: S.bool() }),
  handler: i => { slack.save(i); return slack.status(); }
});
op({ ...ADMIN, name: 'test_slack', method: 'POST', path: '/api/integrations/slack/test', title: 'Send a Slack test message', input: S.obj({ digest: S.bool() }),
  handler: async i => slack.post({ text: i.digest ? slack.digestText() : ':wave: NurzWorks HQ is connected to this channel.' }) });
op({
  ...ADMIN, name: 'save_stripe_settings', method: 'PUT', path: '/api/integrations/stripe', title: 'Stripe settings',
  input: S.obj({ secret_key: S.str('', 300), webhook_secret: S.str('', 300) }),
  handler: i => {
    if (i.secret_key !== undefined) { if (i.secret_key && !/^(sk|rk)_(live|test)_/.test(i.secret_key)) bad('Stripe secret keys start with sk_live_ or sk_test_ (or a restricted rk_ key).'); setSecret('stripe_secret_key', str(i.secret_key)); }
    if (i.webhook_secret !== undefined) setSecret('stripe_webhook_secret', str(i.webhook_secret));
    return { enabled: stripe.enabled() };
  }
});
op({ ...ADMIN, name: 'list_outbox', method: 'GET', path: '/api/integrations/outbox', title: 'Integration deliveries', input: S.obj({ status: S.enum(['pending', 'failed', 'done']) }),
  handler: i => all(`SELECT id, channel, status, attempts, last_error, next_at, created_at, updated_at, substr(payload,1,300) payload FROM outbox ${i.status ? 'WHERE status=:s' : ''} ORDER BY id DESC LIMIT 100`, { s: i.status }) });
op({ ...ADMIN, name: 'retry_outbox', method: 'POST', path: '/api/integrations/outbox/:id/retry', title: 'Retry a delivery', input: S.obj({ id: S.id }, ['id']),
  handler: async i => { OB.retry(i.id); return OB.processOutbox(); } });

module.exports = { OB, G, gmail, gcal, slack, WH, stripe };
