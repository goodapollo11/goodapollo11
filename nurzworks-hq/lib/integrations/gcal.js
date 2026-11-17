'use strict';
// Google Calendar: every scheduled visit becomes an event on the business calendar (kept in sync on reschedule,
// reassign and cancel), and the calendar's other events are pulled in so the schedule and the availability finder
// see personal / meeting busy time.
const { all, get, run, update, now, setting, setSetting } = require('../db');
const { HttpError, bad, str, addressLine, addDays, zonedToUtc } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const G = require('./google');
const { tz, today, baseUrl, company } = require('../config');

const enabled = () => setting('gcal_enabled') !== '0';
const connected = () => G.connected() && enabled();
const calId = () => setting('gcal_calendar_id') || 'primary';
const enc = encodeURIComponent;

function eventBody(v) {
  const job = get('SELECT * FROM jobs WHERE id=:id', { id: v.job_id });
  const crew = all('SELECT u.name, u.email FROM visit_assignees a JOIN users u ON u.id=a.user_id WHERE a.visit_id=:v', { v: v.id });
  const cust = get('SELECT name, phone, email FROM customers WHERE id=:id', { id: job.customer_id });
  const loc = job.location_id ? get('SELECT * FROM locations WHERE id=:id', { id: job.location_id }) : null;
  const lines = [
    `${job.number} · ${job.title}`, `Customer: ${cust.name}${cust.phone ? ` · ${cust.phone}` : ''}`,
    crew.length ? `Crew: ${crew.map(c => c.name).join(', ')}` : 'Crew: unassigned',
    loc && loc.access_notes ? `Access: ${loc.access_notes}` : '', v.notes ? `Notes: ${v.notes}` : '', job.description ? `\n${job.description.slice(0, 1500)}` : '',
    `\nOpen in ${company().name} HQ: ${baseUrl()}/#/jobs/${job.id}`
  ].filter(Boolean);
  const body = {
    summary: `${job.number} · ${job.title} - ${cust.name}`, location: addressLine(loc), description: lines.join('\n'),
    start: { dateTime: v.start_at, timeZone: tz() }, end: { dateTime: v.end_at, timeZone: tz() },
    extendedProperties: { private: { nw_visit_id: String(v.id), nw_job_id: String(job.id) } },
    source: { title: `${company().name} HQ`, url: `${baseUrl()}/#/jobs/${job.id}` }
  };
  if (setting('gcal_invite_assignees') === '1') {
    const att = crew.map(c => c.email).filter(e => e && e !== setting('google_email'));
    if (att.length) body.attendees = att.map(email => ({ email }));
  }
  if (v.status === 'completed') body.colorId = '2';
  return body;
}
async function upsertVisit(visitId) {
  const v = get('SELECT * FROM visits WHERE id=:id', { id: visitId });
  if (!v) return { skipped: 'visit gone' };
  if (v.status === 'cancelled') { if (v.gcal_event_id) await deleteEvent(v.gcal_event_id); update('visits', v.id, { gcal_event_id: null, gcal_synced_at: now(), gcal_error: '' }); return { deleted: true }; }
  const body = eventBody(v);
  const q = { sendUpdates: setting('gcal_invite_assignees') === '1' ? 'all' : 'none' };
  let ev;
  if (v.gcal_event_id) {
    try { ev = await G.api(`/calendar/v3/calendars/${enc(calId())}/events/${enc(v.gcal_event_id)}`, { method: 'PATCH', query: q, body }); }
    catch (e) { if (e.googleStatus === 404 || e.googleStatus === 410) ev = null; else throw e; }
  }
  if (!ev) ev = await G.api(`/calendar/v3/calendars/${enc(calId())}/events`, { method: 'POST', query: q, body });
  update('visits', v.id, { gcal_event_id: ev.id, gcal_synced_at: now(), gcal_error: '' });
  run(`INSERT INTO calendar_events(id,calendar_id,summary,location,start_at,end_at,all_day,status,transparency,html_link,visit_id,updated_at) VALUES(:id,:c,:s,:l,:st,:en,0,'confirmed','',:h,:v,:t)
    ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, location=excluded.location, start_at=excluded.start_at, end_at=excluded.end_at, html_link=excluded.html_link, visit_id=excluded.visit_id, updated_at=excluded.updated_at`,
    { id: ev.id, c: calId(), s: body.summary, l: body.location || '', st: v.start_at, en: v.end_at, h: ev.htmlLink || '', v: v.id, t: now() });
  return { event_id: ev.id };
}
async function deleteEvent(eventId) {
  try { await G.api(`/calendar/v3/calendars/${enc(calId())}/events/${enc(eventId)}`, { method: 'DELETE', query: { sendUpdates: 'none' } }); }
  catch (e) { if (!(e.googleStatus === 404 || e.googleStatus === 410)) throw e; }
  run('DELETE FROM calendar_events WHERE id=:id', { id: eventId });
  return { deleted: eventId };
}
function toIso(t, allDayEnd = false) {
  if (t.dateTime) return new Date(t.dateTime).toISOString();
  return zonedToUtc(t.date, '00:00', tz()).toISOString(); // all-day: local midnight (end date is exclusive in Google)
}
async function pull({ daysBack = 7, daysAhead = 60 } = {}) {
  if (!connected()) return { skipped: true };
  const from = addDays(today(), -daysBack), to = addDays(today(), daysAhead);
  const timeMin = zonedToUtc(from, '00:00', tz()).toISOString(), timeMax = zonedToUtc(to, '00:00', tz()).toISOString();
  const seen = new Set(); let pageToken; let guard = 0;
  do {
    const r = await G.api(`/calendar/v3/calendars/${enc(calId())}/events`, { query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: 2500, pageToken, showDeleted: 'false' } });
    for (const e of r.items || []) {
      if (!e.start || e.status === 'cancelled') continue;
      const visitId = Number(e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.nw_visit_id) || null;
      seen.add(e.id);
      run(`INSERT INTO calendar_events(id,calendar_id,summary,location,start_at,end_at,all_day,status,transparency,html_link,visit_id,updated_at) VALUES(:id,:c,:s,:l,:st,:en,:ad,:status,:tr,:h,:v,:t)
        ON CONFLICT(id) DO UPDATE SET summary=excluded.summary, location=excluded.location, start_at=excluded.start_at, end_at=excluded.end_at, all_day=excluded.all_day, status=excluded.status,
        transparency=excluded.transparency, html_link=excluded.html_link, visit_id=excluded.visit_id, updated_at=excluded.updated_at`, {
        id: e.id, c: calId(), s: str(e.summary), l: str(e.location), st: toIso(e.start), en: toIso(e.end), ad: e.start.date ? 1 : 0, status: e.status || '', tr: e.transparency || '',
        h: e.htmlLink || '', v: visitId && get('SELECT id FROM visits WHERE id=:id', { id: visitId }) ? visitId : null, t: now()
      });
    }
    pageToken = r.nextPageToken;
  } while (pageToken && guard++ < 10);
  // drop cached events in the window that no longer exist
  for (const row of all('SELECT id FROM calendar_events WHERE start_at < :max AND end_at > :min', { min: timeMin, max: timeMax })) if (!seen.has(row.id)) run('DELETE FROM calendar_events WHERE id=:id', { id: row.id });
  setSetting('gcal_last_pull', now());
  return { events: seen.size };
}

op({
  name: 'calendar_list_events', method: 'GET', path: '/api/calendar/events', tags: ['Calendar'], roles: R.ALL,
  title: 'Google Calendar events', description: 'Events on the connected Google Calendar between two dates (business time zone), including personal/meeting busy time. Events created from visits have visit_id set. refresh=true pulls fresh data from Google first.',
  input: S.obj({ from: S.date, to: S.date, refresh: S.bool(), include_visits: S.bool('Include events that mirror HQ visits (default false)') }),
  handler: async i => {
    if (i.refresh && connected()) await pull();
    const from = i.from || today(), to = i.to || addDays(from, 7);
    const rows = all(`SELECT * FROM calendar_events WHERE start_at < :e AND end_at > :s ${i.include_visits ? '' : 'AND visit_id IS NULL'} ORDER BY start_at`,
      { s: zonedToUtc(from, '00:00', tz()).toISOString(), e: zonedToUtc(addDays(to, 1), '00:00', tz()).toISOString() });
    return { connected: connected(), calendar_id: calId(), last_pull: setting('gcal_last_pull'), events: rows };
  }
});
op({
  name: 'calendar_sync_now', method: 'POST', path: '/api/calendar/sync', tags: ['Calendar'],
  title: 'Sync Google Calendar now', description: 'Push any unsynced visits to Google Calendar and pull the latest calendar events.',
  input: S.obj({}),
  handler: async () => {
    if (!connected()) throw new HttpError(409, 'Google Calendar is not connected.');
    const pending = all("SELECT id FROM visits WHERE status != 'cancelled' AND (gcal_event_id IS NULL OR gcal_synced_at IS NULL OR gcal_synced_at < updated_at) AND end_at > :t LIMIT 200", { t: new Date(Date.now() - 7 * 864e5).toISOString() });
    let pushed = 0; const errors = [];
    for (const v of pending) { try { await upsertVisit(v.id); pushed++; } catch (e) { errors.push(`visit ${v.id}: ${e.message}`); update('visits', v.id, { gcal_error: e.message.slice(0, 300) }); } }
    const p = await pull();
    return { pushed, pulled: p.events || 0, errors };
  }
});
op({
  name: 'calendar_list_calendars', method: 'GET', path: '/api/integrations/calendar/calendars', tags: ['Calendar'], scope: 'admin', mcp: false,
  title: 'List Google calendars', input: S.obj({}),
  handler: async () => {
    const r = await G.api('/calendar/v3/users/me/calendarList', { query: { minAccessRole: 'writer' } });
    return (r.items || []).map(c => ({ id: c.id, summary: c.summaryOverride || c.summary, primary: !!c.primary, time_zone: c.timeZone, access: c.accessRole }));
  }
});

module.exports = { connected, enabled, upsertVisit, deleteEvent, pull, eventBody, calId };
