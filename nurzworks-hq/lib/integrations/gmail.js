'use strict';
// Gmail: business inbox inside HQ. Threads are matched to customers by email address, can be linked to jobs,
// replied to, drafted (for review) or sent. Outgoing estimate/invoice emails use the same account.
const crypto = require('crypto');
const { all, get, run, insert, now, setting, setSetting } = require('../db');
const { HttpError, bad, str, normEmail, emailOk, escHtml } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');
const G = require('./google');
const { company } = require('../config');
const A = require('../services/activity');

const enabled = () => setting('gmail_enabled') !== '0';
const connected = () => G.connected() && enabled();
const me = () => normEmail(setting('google_email'));

// ---------------- MIME helpers ----------------
const oneLine = s => str(s).replace(/[\r\n]+/g, ' ');
const encWord = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
function addrList(v) {
  const list = oneLine(v).split(/[,;]/).map(x => x.trim()).filter(Boolean);
  for (const a of list) { const e = (a.match(/<([^>]+)>/) || [, a])[1].trim(); if (!emailOk(e)) bad(`"${a}" is not a valid email address.`); }
  return list.join(', ');
}
function textToHtml(t) { return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.5">${escHtml(t).replace(/\n/g, '<br>')}</div>`; }
function htmlToText(h) {
  return String(h || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}
function buildMime({ to, cc, bcc, subject, text, html, inReplyTo, references }) {
  const boundary = 'nw_' + crypto.randomBytes(12).toString('hex');
  const name = company().name;
  const from = me() ? `${encWord(name)} <${me()}>` : undefined;
  const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  const head = [from && `From: ${from}`, `To: ${addrList(to)}`, cc && `Cc: ${addrList(cc)}`, bcc && `Bcc: ${addrList(bcc)}`, `Subject: ${encWord(oneLine(subject))}`,
    'MIME-Version: 1.0', inReplyTo && `In-Reply-To: ${oneLine(inReplyTo)}`, references && `References: ${oneLine(references)}`, `Content-Type: multipart/alternative; boundary="${boundary}"`].filter(Boolean);
  const plain = text || htmlToText(html);
  return [...head, '', `--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(plain),
    `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(html || textToHtml(plain)), `--${boundary}--`, ''].join('\r\n');
}
function decodeWords(v) {
  return String(v || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (m, cs, enc, data) => {
    try {
      const buf = enc.toUpperCase() === 'B' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), 'latin1');
      return new TextDecoder(cs.toLowerCase()).decode(buf);
    } catch (_) { return m; }
  });
}
const header = (m, name) => { const h = ((m.payload && m.payload.headers) || []).find(x => x.name.toLowerCase() === name.toLowerCase()); return h ? decodeWords(h.value) : ''; };
function parseAddr(v) {
  const m = String(v || '').match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  return m ? { name: m[1].trim(), email: normEmail(m[2]) } : { name: '', email: normEmail(v) };
}
const allAddrs = v => String(v || '').split(',').map(parseAddr).filter(a => a.email);
function partText(p) {
  const ct = ((p.headers || []).find(h => h.name.toLowerCase() === 'content-type') || {}).value || '';
  const cs = (ct.match(/charset="?([\w-]+)"?/i) || [, 'utf-8'])[1].toLowerCase();
  const buf = Buffer.from(p.body.data, 'base64url');
  try { return new TextDecoder(cs).decode(buf); } catch (_) { return buf.toString('utf8'); }
}
function walk(p, out) {
  if (!p) return out;
  if (p.parts && p.parts.length) p.parts.forEach(x => walk(x, out));
  else if (p.filename && p.body && p.body.attachmentId) out.attachments.push({ filename: p.filename, mime: p.mimeType, size: p.body.size, attachment_id: p.body.attachmentId });
  else if (p.mimeType === 'text/plain' && p.body && p.body.data && !out.text) out.text = partText(p);
  else if (p.mimeType === 'text/html' && p.body && p.body.data && !out.html) out.html = partText(p);
  return out;
}

// ---------------- cache + customer matching ----------------
function matchCustomer(emails) {
  for (const e of emails) {
    if (!e || e === me()) continue;
    const c = get('SELECT id FROM customers WHERE lower(email)=:e', { e }) || get('SELECT customer_id id FROM contacts WHERE lower(email)=:e', { e });
    if (c) return c.id;
  }
  return null;
}
function cacheThread(t) {
  const msgs = t.messages || [];
  const last = msgs[msgs.length - 1] || {};
  const first = msgs[0] || {};
  const labels = [...new Set(msgs.flatMap(m => m.labelIds || []))];
  const people = [...new Set(msgs.flatMap(m => [...allAddrs(header(m, 'From')), ...allAddrs(header(m, 'To')), ...allAddrs(header(m, 'Cc'))].map(a => a.email)))];
  const lastFromOther = [...msgs].reverse().find(m => parseAddr(header(m, 'From')).email !== me()) || last;
  const from = parseAddr(header(lastFromOther, 'From'));
  const cur = get('SELECT * FROM email_threads WHERE thread_id=:id', { id: t.id });
  const row = {
    thread_id: t.id, history_id: String(t.historyId || ''), subject: header(first, 'Subject') || '(no subject)', snippet: decodeWords(last.snippet || t.snippet || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
    from_name: from.name, from_email: from.email, participants: people.join(','), last_date: last.internalDate ? new Date(Number(last.internalDate)).toISOString() : now(),
    message_count: msgs.length, unread: msgs.some(m => (m.labelIds || []).includes('UNREAD')) ? 1 : 0, labels: labels.join(','),
    customer_id: cur && cur.linked_by && cur.linked_by !== 'auto' ? cur.customer_id : (matchCustomer(people) || (cur ? cur.customer_id : null)),
    job_id: cur ? cur.job_id : null, linked_by: cur && cur.linked_by && cur.linked_by !== 'auto' ? cur.linked_by : (matchCustomer(people) ? 'auto' : (cur ? cur.linked_by : '')), updated_at: now()
  };
  run(`INSERT INTO email_threads(thread_id,history_id,subject,snippet,from_name,from_email,participants,last_date,message_count,unread,labels,customer_id,job_id,linked_by,updated_at)
    VALUES(:thread_id,:history_id,:subject,:snippet,:from_name,:from_email,:participants,:last_date,:message_count,:unread,:labels,:customer_id,:job_id,:linked_by,:updated_at)
    ON CONFLICT(thread_id) DO UPDATE SET history_id=excluded.history_id, subject=excluded.subject, snippet=excluded.snippet, from_name=excluded.from_name, from_email=excluded.from_email,
    participants=excluded.participants, last_date=excluded.last_date, message_count=excluded.message_count, unread=excluded.unread, labels=excluded.labels,
    customer_id=excluded.customer_id, job_id=excluded.job_id, linked_by=excluded.linked_by, updated_at=excluded.updated_at`, row);
  return { row, isNew: !cur, changed: !cur || cur.history_id !== row.history_id };
}
const THREAD_SELECT = `SELECT t.*, c.name customer_name, j.number job_number FROM email_threads t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN jobs j ON j.id=t.job_id`;

async function pool(items, size, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

async function listThreads({ q = '', label = 'INBOX', pageToken, max = 25, customerId } = {}) {
  if (!connected()) throw new HttpError(409, 'Gmail is not connected. An admin can connect Google under Integrations.');
  let query = str(q);
  if (customerId) {
    const emails = [get('SELECT email FROM customers WHERE id=:id', { id: customerId })?.email, ...all("SELECT email FROM contacts WHERE customer_id=:id AND email != ''", { id: customerId }).map(r => r.email)].filter(Boolean);
    if (!emails.length) return { threads: [], next_page_token: null, note: 'This customer has no email address on file.' };
    query = `${query} {${emails.map(e => `from:${e} to:${e} cc:${e}`).join(' ')}}`.trim();
    label = 'ALL';
  }
  const labelIds = label === 'ALL' ? undefined : label === 'UNREAD' ? ['INBOX', 'UNREAD'] : [label];
  const list = await G.api('/gmail/v1/users/me/threads', { query: { maxResults: Math.min(max, 50), q: query || undefined, labelIds, pageToken } });
  const ids = (list.threads || []);
  await pool(ids, 4, async t => {
    const cur = get('SELECT history_id FROM email_threads WHERE thread_id=:id', { id: t.id });
    if (cur && cur.history_id === String(t.historyId)) return;
    const full = await G.api(`/gmail/v1/users/me/threads/${encodeURIComponent(t.id)}`, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'] } });
    cacheThread(full);
  });
  setSetting('gmail_last_sync', now());
  const rows = ids.map(t => get(`${THREAD_SELECT} WHERE t.thread_id=:id`, { id: t.id })).filter(Boolean);
  return { threads: rows, next_page_token: list.nextPageToken || null, result_size_estimate: list.resultSizeEstimate || rows.length };
}
async function getThread(id) {
  if (!connected()) throw new HttpError(409, 'Gmail is not connected.');
  const t = await G.api(`/gmail/v1/users/me/threads/${encodeURIComponent(id)}`, { query: { format: 'full' } });
  cacheThread(t);
  const messages = (t.messages || []).map(m => {
    const body = walk(m.payload, { text: '', html: '', attachments: [] });
    return {
      id: m.id, message_id: header(m, 'Message-ID') || header(m, 'Message-Id'), from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc'), subject: header(m, 'Subject'),
      date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : header(m, 'Date'), labels: m.labelIds || [], unread: (m.labelIds || []).includes('UNREAD'),
      text: body.text || htmlToText(body.html), html: body.html || '', attachments: body.attachments, from_us: parseAddr(header(m, 'From')).email === me()
    };
  });
  const row = get(`${THREAD_SELECT} WHERE t.thread_id=:id`, { id });
  const people = row.participants.split(',').filter(e => e && e !== me());
  const suggestions = row.customer_id ? [] : all(`SELECT id, name, email FROM customers WHERE lower(email) IN (${people.map((_, i) => ':p' + i).join(',') || "''"}) LIMIT 5`, Object.fromEntries(people.map((p, i) => ['p' + i, p])));
  return { ...row, messages, unknown_senders: row.customer_id ? [] : people, suggestions };
}
async function sendMessage({ to, cc, bcc, subject, text, html, threadId, inReplyTo, references }) {
  if (!str(to)) bad('to is required.');
  if (!str(subject)) bad('subject is required.');
  const raw = Buffer.from(buildMime({ to, cc, bcc, subject, text, html, inReplyTo, references })).toString('base64url');
  const r = await G.api('/gmail/v1/users/me/messages/send', { method: 'POST', body: { raw, ...(threadId ? { threadId } : {}) } });
  return { id: r.id, threadId: r.threadId };
}
async function createDraft({ to, cc, bcc, subject, text, html, threadId, inReplyTo, references }) {
  const raw = Buffer.from(buildMime({ to, cc, bcc, subject, text, html, inReplyTo, references })).toString('base64url');
  const r = await G.api('/gmail/v1/users/me/drafts', { method: 'POST', body: { message: { raw, ...(threadId ? { threadId } : {}) } } });
  return { draft_id: r.id, message_id: r.message && r.message.id, threadId: r.message && r.message.threadId };
}
function linkThread(threadId, { customerId = null, jobId = null, by = 'auto', subject = '', to = '' } = {}) {
  const cur = get('SELECT * FROM email_threads WHERE thread_id=:id', { id: threadId });
  if (cur) run('UPDATE email_threads SET customer_id=:c, job_id=:j, linked_by=:b, updated_at=:t WHERE thread_id=:id', { c: customerId, j: jobId, b: by, t: now(), id: threadId });
  else insert('email_threads', { thread_id: threadId, subject, participants: normEmail(to), customer_id: customerId, job_id: jobId, linked_by: by, last_date: now(), labels: 'SENT', updated_at: now() });
}
// Reply headers for continuing a thread
async function replyContext(threadId) {
  const t = await G.api(`/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`, { query: { format: 'metadata', metadataHeaders: ['Message-ID', 'Message-Id', 'References', 'Subject', 'From', 'Reply-To'] } });
  const last = (t.messages || [])[t.messages.length - 1];
  if (!last) bad('That thread has no messages.');
  const mid = header(last, 'Message-ID') || header(last, 'Message-Id');
  const subj = header(t.messages[0], 'Subject');
  const lastOther = [...t.messages].reverse().find(m => parseAddr(header(m, 'From')).email !== me());
  return { inReplyTo: mid, references: [header(last, 'References'), mid].filter(Boolean).join(' '), subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
    replyTo: lastOther ? (header(lastOther, 'Reply-To') || header(lastOther, 'From')) : '' };
}

// Background poll: refresh recent inbox threads and announce new customer email.
async function poll() {
  if (!connected()) return { skipped: true };
  const before = setting('gmail_notified_until') || new Date(Date.now() - 864e5).toISOString();
  const r = await listThreads({ label: 'INBOX', q: 'newer_than:3d', max: 30 });
  let newest = before; const fresh = [];
  for (const t of r.threads) {
    if (t.last_date > before && t.unread && t.from_email && t.from_email !== me()) { fresh.push(t); if (t.last_date > newest) newest = t.last_date; }
  }
  setSetting('gmail_notified_until', newest);
  const { emit } = require('../events');
  for (const t of fresh) emit('email.received', { thread_id: t.thread_id, subject: t.subject, from_name: t.from_name, from_email: t.from_email, customer_id: t.customer_id, customer_name: t.customer_name, snippet: t.snippet }, null);
  return { refreshed: r.threads.length, new_messages: fresh.length };
}

// ---------------- operations ----------------
const MAIL = { to: S.str('Comma-separated recipients', 1000), cc: S.str('', 1000), bcc: S.str('', 1000), subject: S.str('', 300), body: S.str('Plain-text message body', 50000),
  html: S.str('Optional HTML body', 200000), thread_id: S.str('Reply within this Gmail thread', 100), customer_id: S.idOpt, job_id: S.idOpt };
async function prepare(i) {
  let ctxh = {};
  if (i.thread_id) ctxh = await replyContext(i.thread_id);
  const to = str(i.to) || (ctxh.replyTo ? parseAddr(ctxh.replyTo).email : '');
  if (!to) bad('to is required.');
  return { to, cc: i.cc, bcc: i.bcc, subject: str(i.subject) || ctxh.subject || '', text: i.body || '', html: i.html || '', threadId: i.thread_id || undefined, inReplyTo: ctxh.inReplyTo, references: ctxh.references };
}
function logSent(i, res, ctx, verb) {
  const custId = i.customer_id || matchCustomer(allAddrs(i.to).map(a => a.email));
  if (res.threadId) linkThread(res.threadId, { customerId: custId || null, jobId: i.job_id || null, by: custId ? (i.customer_id ? ctx.actor : 'auto') : '', subject: i.subject, to: i.to });
  if (custId) A.log('customer', custId, `${verb} email to ${i.to}: "${i.subject}"`, { ctx, kind: 'email' });
  if (i.job_id) A.log('job', i.job_id, `${verb} email to ${i.to}: "${i.subject}"`, { ctx, kind: 'email' });
}

op({
  name: 'email_list', method: 'GET', path: '/api/email/threads', tags: ['Email'], roles: R.OFFICE,
  title: 'List email threads', description: 'Business Gmail threads (newest first), each matched to a customer when the address is known. label: INBOX (default), UNREAD, SENT, STARRED or ALL. q accepts Gmail search syntax (from:, subject:, newer_than:2d). customer_id lists all mail with that customer.',
  input: S.obj({ q: S.str('', 500), label: S.enum(['INBOX', 'UNREAD', 'SENT', 'STARRED', 'IMPORTANT', 'ALL']), page_token: S.str('', 200), max: S.int('', { minimum: 1, maximum: 50 }), customer_id: S.idOpt }),
  handler: i => listThreads({ q: i.q, label: i.label || 'INBOX', pageToken: i.page_token, max: i.max || 25, customerId: i.customer_id })
});
op({
  name: 'email_get_thread', method: 'GET', path: '/api/email/threads/:thread', tags: ['Email'], roles: R.OFFICE,
  title: 'Read email thread', description: 'Full conversation: every message with sender, recipients, date, plain text body and attachment names, plus the linked customer/job (or suggested matches).',
  input: S.obj({ thread: S.str('Gmail thread id', 100) }, ['thread']),
  handler: i => getThread(i.thread)
});
op({
  name: 'email_send', method: 'POST', path: '/api/email/send', tags: ['Email'], scope: 'email.send',
  title: 'Send email', description: 'Send an email from the business Gmail account (it appears in Sent Mail). Pass thread_id to reply in a conversation (recipient and subject default from the thread). Logged on the customer and job. If unsure, use email_create_draft instead so a person can review it.',
  input: S.obj(MAIL, ['body']),
  handler: async (i, ctx) => {
    const m = await prepare(i);
    if (!m.subject) bad('subject is required.');
    const res = await sendMessage(m);
    logSent({ ...i, to: m.to, subject: m.subject }, res, ctx, 'Sent');
    return { sent: true, to: m.to, subject: m.subject, message_id: res.id, thread_id: res.threadId };
  }
});
op({
  name: 'email_create_draft', method: 'POST', path: '/api/email/drafts', tags: ['Email'],
  title: 'Draft an email for review', description: 'Create a Gmail draft (not sent) for a person to review and send from Gmail. Pass thread_id to draft a reply. Preferred for anything sensitive.',
  input: S.obj(MAIL, ['body']),
  handler: async (i, ctx) => {
    const m = await prepare(i);
    if (!m.subject) bad('subject is required.');
    const res = await createDraft(m);
    const custId = i.customer_id || matchCustomer(allAddrs(m.to).map(a => a.email));
    if (custId) A.log('customer', custId, `Drafted email to ${m.to}: "${m.subject}" (waiting in Gmail Drafts for review).`, { ctx, kind: 'email' });
    return { drafted: true, to: m.to, subject: m.subject, ...res, review_url: 'https://mail.google.com/mail/u/0/#drafts' };
  }
});
op({
  name: 'email_modify', method: 'POST', path: '/api/email/threads/:thread/modify', tags: ['Email'],
  title: 'Mark / archive email', description: 'Mark a thread read or unread, archive it (remove from inbox), move it back to the inbox, or star it.',
  input: S.obj({ thread: S.str('', 100), read: S.bool(), archive: S.bool(), inbox: S.bool('Move back to inbox'), star: S.bool() }, ['thread']),
  handler: async i => {
    const add = [], remove = [];
    if (i.read === true) remove.push('UNREAD'); if (i.read === false) add.push('UNREAD');
    if (i.archive) remove.push('INBOX'); if (i.inbox) add.push('INBOX');
    if (i.star === true) add.push('STARRED'); if (i.star === false) remove.push('STARRED');
    if (!add.length && !remove.length) bad('Nothing to change.');
    const t = await G.api(`/gmail/v1/users/me/threads/${encodeURIComponent(i.thread)}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } });
    // The modify response carries label ids but no headers, so only labels/unread are refreshed in the cache.
    const cur = get('SELECT labels FROM email_threads WHERE thread_id=:id', { id: i.thread });
    if (cur) {
      let labels;
      if (t && Array.isArray(t.messages) && t.messages.some(m => m.labelIds)) labels = new Set(t.messages.flatMap(m => m.labelIds || []));
      else { labels = new Set(cur.labels.split(',').filter(Boolean)); add.forEach(l => labels.add(l)); remove.forEach(l => labels.delete(l)); }
      const unread = t && Array.isArray(t.messages) && t.messages.some(m => m.labelIds) ? t.messages.some(m => (m.labelIds || []).includes('UNREAD')) : labels.has('UNREAD');
      run('UPDATE email_threads SET labels=:l, unread=:u, updated_at=:t WHERE thread_id=:id', { l: [...labels].join(','), u: unread ? 1 : 0, t: now(), id: i.thread });
    }
    return { ok: true, added: add, removed: remove };
  }
});
op({
  name: 'email_link', method: 'POST', path: '/api/email/threads/:thread/link', tags: ['Email'],
  title: 'Link email to customer / job', description: 'Attach a conversation to a customer (and optionally a job) so it shows on their record. customer_id null unlinks.',
  input: S.obj({ thread: S.str('', 100), customer_id: S.idOpt, job_id: S.idOpt }, ['thread']),
  handler: (i, ctx) => {
    if (i.customer_id && !get('SELECT id FROM customers WHERE id=:id', { id: i.customer_id })) bad('Customer not found.');
    if (i.job_id) { const j = get('SELECT customer_id FROM jobs WHERE id=:id', { id: i.job_id }); if (!j) bad('Job not found.'); if (!i.customer_id) i.customer_id = j.customer_id; }
    linkThread(i.thread, { customerId: i.customer_id || null, jobId: i.job_id || null, by: i.customer_id ? ctx.actor : '' });
    const t = get(`${THREAD_SELECT} WHERE t.thread_id=:id`, { id: i.thread });
    if (i.customer_id) A.log('customer', i.customer_id, `Linked email "${t ? t.subject : i.thread}".`, { ctx, kind: 'email' });
    return t || { ok: true };
  }
});

module.exports = { connected, enabled, listThreads, getThread, sendMessage, createDraft, linkThread, poll, buildMime, decodeWords, htmlToText, cacheThread, matchCustomer };
