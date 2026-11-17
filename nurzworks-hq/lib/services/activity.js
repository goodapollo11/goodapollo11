'use strict';
// Activity timeline (notes, calls, system history) and file attachments (photos, signatures, receipts).
const fs = require('fs');
const path = require('path');
const { all, get, run, insert, now, UPLOAD_DIR } = require('../db');
const { bad, notFound, str, token } = require('../util');
const { op, S } = require('../ops');
const { R } = require('../auth');

const ENTITIES = ['customer', 'job', 'visit', 'estimate', 'invoice', 'request', 'task', 'plan'];
const TABLE = { customer: 'customers', job: 'jobs', visit: 'visits', estimate: 'estimates', invoice: 'invoices', request: 'requests', task: 'tasks', plan: 'plans' };

function customerIdFor(type, id) {
  if (!id) return null;
  if (type === 'customer') return id;
  if (type === 'visit') return get('SELECT j.customer_id c FROM visits v JOIN jobs j ON j.id=v.job_id WHERE v.id=:id', { id })?.c ?? null;
  const t = TABLE[type];
  if (!t) return null;
  return get(`SELECT customer_id c FROM ${t} WHERE id=:id`, { id })?.c ?? null;
}
function entityExists(type, id) {
  const t = TABLE[type];
  return !!(t && get(`SELECT id FROM ${t} WHERE id=:id`, { id }));
}

// log(entityType, entityId, body, {kind, ctx, customerId, meta})
function log(entityType, entityId, body, { kind = 'system', ctx = null, customerId, meta, isDemo = 0 } = {}) {
  return insert('activity', {
    entity_type: entityType, entity_id: entityId,
    customer_id: customerId !== undefined ? customerId : customerIdFor(entityType, entityId),
    kind, author: ctx ? ctx.actor : 'System', author_id: ctx && ctx.user ? ctx.user.id : null, via: ctx ? ctx.via : 'system',
    body: String(body), meta: meta ? JSON.stringify(meta) : '', is_demo: isDemo, created_at: now()
  });
}
function listFor(entityType, entityId, limit = 100) {
  return all('SELECT * FROM activity WHERE entity_type=:t AND entity_id=:id ORDER BY created_at DESC, id DESC LIMIT :l', { t: entityType, id: entityId, l: limit });
}
function listForCustomer(customerId, limit = 100) {
  return all(`SELECT a.*,
      CASE a.entity_type WHEN 'job' THEN (SELECT number FROM jobs WHERE id=a.entity_id) WHEN 'estimate' THEN (SELECT number FROM estimates WHERE id=a.entity_id)
        WHEN 'invoice' THEN (SELECT number FROM invoices WHERE id=a.entity_id) WHEN 'request' THEN (SELECT number FROM requests WHERE id=a.entity_id) ELSE NULL END ref
    FROM activity a WHERE a.customer_id=:c ORDER BY a.created_at DESC, a.id DESC LIMIT :l`, { c: customerId, l: limit });
}

op({
  name: 'add_note', method: 'POST', path: '/api/notes', tags: ['Activity'], roles: R.STAFF,
  title: 'Add a note', description: 'Add a note, call log, or message summary to a customer, job, visit, estimate, invoice, request, task or service plan. It appears on that record\'s activity timeline (and the customer\'s).',
  input: S.obj({
    entity_type: S.enum(ENTITIES, 'Record type'), entity_id: S.id, body: S.str('Note text', 10000),
    kind: S.enum(['note', 'call', 'email', 'sms', 'meeting'], 'Default note')
  }, ['entity_type', 'entity_id', 'body']),
  handler: (i, ctx) => {
    if (!entityExists(i.entity_type, i.entity_id)) notFound(i.entity_type);
    const id = log(i.entity_type, i.entity_id, i.body, { kind: i.kind || 'note', ctx });
    if (TABLE[i.entity_type]) run(`UPDATE ${TABLE[i.entity_type]} SET updated_at=:t WHERE id=:id`, { t: now(), id: i.entity_id });
    return get('SELECT * FROM activity WHERE id=:id', { id });
  }
});

op({
  name: 'list_activity', method: 'GET', path: '/api/activity', tags: ['Activity'],
  title: 'List activity', description: 'Timeline of notes and history for one record (entity_type + entity_id) or everything about a customer (customer_id). Newest first.',
  input: S.obj({ entity_type: S.enum(ENTITIES), entity_id: S.idOpt, customer_id: S.idOpt, limit: S.limit }),
  handler: i => {
    if (i.customer_id) return listForCustomer(i.customer_id, i.limit || 100);
    if (i.entity_type && i.entity_id) return listFor(i.entity_type, i.entity_id, i.limit || 100);
    return all('SELECT * FROM activity ORDER BY created_at DESC, id DESC LIMIT :l', { l: i.limit || 50 });
  }
});

op({
  name: 'delete_note', method: 'DELETE', path: '/api/notes/:id', tags: ['Activity'], mcp: false,
  title: 'Delete a note', description: 'Delete a note you added (system history cannot be deleted).',
  input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const a = get('SELECT * FROM activity WHERE id=:id', { id: i.id }) || notFound('Note');
    if (a.kind === 'system' || a.kind === 'status') bad('System history cannot be deleted.');
    if (a.author_id !== (ctx.user && ctx.user.id) && !['owner', 'admin'].includes(ctx.user.role)) bad('Only the author or an admin can delete this note.');
    run('DELETE FROM activity WHERE id=:id', { id: i.id });
    return { ok: true };
  }
});

// ---------------- attachments ----------------
const MAX_UPLOAD = 15 * 1024 * 1024;
const SAFE_MIME = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/plain|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[\w.]+|vnd\.ms-excel))$/;
function saveUpload({ entityType, entityId, filename, mime, kind, caption, buf, ctx }) {
  if (!ENTITIES.includes(entityType) && entityType !== 'expense') bad('Unknown record type.');
  if (entityType !== 'expense' && !entityExists(entityType, entityId)) notFound(entityType);
  if (!buf || !buf.length) bad('The file is empty.');
  if (buf.length > MAX_UPLOAD) bad('Files must be 15 MB or smaller.');
  mime = str(mime).toLowerCase().split(';')[0];
  if (!SAFE_MIME.test(mime)) bad('That file type is not allowed. Upload photos, PDFs or office documents.');
  const ext = (path.extname(str(filename)) || '.' + (mime.split('/')[1] || 'bin')).toLowerCase().replace(/[^.\w]/g, '').slice(0, 8);
  const month = new Date().toISOString().slice(0, 7);
  fs.mkdirSync(path.join(UPLOAD_DIR, month), { recursive: true });
  const stored = `${month}/${token(12)}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, stored), buf);
  const id = insert('attachments', {
    entity_type: entityType, entity_id: entityId, customer_id: entityType === 'expense' ? null : customerIdFor(entityType, entityId),
    kind: ['photo', 'signature', 'receipt', 'file'].includes(kind) ? kind : (mime.startsWith('image/') ? 'photo' : 'file'),
    filename: str(filename).replace(/[^\w .()\-]/g, '_').slice(0, 120) || 'file' + ext, mime, size: buf.length, stored,
    caption: str(caption).slice(0, 300), uploaded_by: ctx ? ctx.actor : '', created_at: now()
  });
  if (entityType !== 'expense') log(entityType, entityId, `${kind === 'signature' ? 'Captured customer signature' : `Attached ${mime.startsWith('image/') ? 'photo' : 'file'} "${filename}"`}.`, { ctx });
  return get('SELECT * FROM attachments WHERE id=:id', { id });
}
function attachmentsFor(type, id) {
  return all('SELECT * FROM attachments WHERE entity_type=:t AND entity_id=:id ORDER BY created_at DESC', { t: type, id });
}
function attachmentFile(id) {
  const a = get('SELECT * FROM attachments WHERE id=:id', { id }) || notFound('Attachment');
  const file = path.join(UPLOAD_DIR, a.stored);
  if (!file.startsWith(UPLOAD_DIR) || !fs.existsSync(file)) notFound('File');
  return { a, file };
}

op({
  name: 'list_attachments', method: 'GET', path: '/api/attachments', tags: ['Activity'],
  title: 'List attachments', description: 'Photos, signatures and files attached to a record. Download each with GET /api/attachments/{id}/file.',
  input: S.obj({ entity_type: S.enum([...ENTITIES, 'expense']), entity_id: S.id }, ['entity_type', 'entity_id']),
  handler: i => attachmentsFor(i.entity_type, i.entity_id)
});
op({
  name: 'delete_attachment', method: 'DELETE', path: '/api/attachments/:id', tags: ['Activity'], mcp: false, roles: R.STAFF,
  title: 'Delete attachment', input: S.obj({ id: S.id }, ['id']),
  handler: (i, ctx) => {
    const { a, file } = attachmentFile(i.id);
    run('DELETE FROM attachments WHERE id=:id', { id: a.id });
    fs.rmSync(file, { force: true });
    if (a.entity_type !== 'expense') log(a.entity_type, a.entity_id, `Removed attachment "${a.filename}".`, { ctx });
    return { ok: true };
  }
});

module.exports = { log, listFor, listForCustomer, customerIdFor, entityExists, saveUpload, attachmentsFor, attachmentFile, ENTITIES, TABLE, MAX_UPLOAD };
