'use strict';
// NurzWorks HQ - operation registry.
// Every business operation is declared once here (name, HTTP route, JSON schema, permissions, handler).
// The same definition powers the REST API used by the web app, the MCP tools used by AI staff,
// the generated OpenAPI spec and the in-app API reference - so people and AI always get identical behavior.
const { HttpError, validate } = require('./util');
const { R, ROLE_SCOPES, actorName } = require('./auth');
const { run, now } = require('./db');

const OPS = [];
const BY_NAME = new Map();

/**
 * op({ name, method, path, title, description, scope, roles, input, handler, mcp, tags, annotations, public })
 * - scope: credential scope required: read | write | email.send | admin
 * - roles: which team roles may call it (defaults by scope)
 * - mcp:   false hides it from AI tool lists (still reachable over REST)
 */
function op(def) {
  const method = def.method || 'GET';
  const d = { method, scope: method === 'GET' ? 'read' : 'write', mcp: true, tags: [], ...def };
  if (!d.roles) d.roles = d.scope === 'read' ? R.ALL : d.scope === 'admin' ? R.ADMIN : R.OFFICE;
  if (!d.input) d.input = { type: 'object', properties: {} };
  if (d.path) {
    const keys = [];
    const pattern = d.path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return k === 'id' || k.endsWith('_id') ? '(\\d+)' : '([A-Za-z0-9_.\\-]+)'; });
    d.re = new RegExp('^' + pattern + '$');
    d.keys = keys;
  }
  if (BY_NAME.has(d.name)) throw new Error('Duplicate operation ' + d.name);
  OPS.push(d); BY_NAME.set(d.name, d);
  return d;
}

function match(method, pathname) {
  let pathHit = false;
  for (const o of OPS) {
    if (!o.re) continue;
    const m = pathname.match(o.re);
    if (!m) continue;
    pathHit = true;
    if (o.method !== method) continue;
    const params = {};
    o.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    return { op: o, params };
  }
  return pathHit ? { methodNotAllowed: true } : null;
}

function permitted(o, ctx) {
  if (o.public) return true;
  if (!ctx || !ctx.user) return false;
  return o.roles.includes(ctx.user.role) && ctx.scopes.includes(o.scope);
}

function logCall(o, ctx, status, ms, summary) {
  try {
    run('INSERT INTO api_calls(user_id,key_id,via,op,status,ms,summary,created_at) VALUES(:u,:k,:v,:o,:s,:ms,:sum,:t)', {
      u: ctx.user ? ctx.user.id : null, k: ctx.key ? ctx.key.id : null, v: ctx.via, o: o.name, s: status, ms, sum: String(summary || '').slice(0, 300), t: now()
    });
  } catch (_) { /* logging must never break a request */ }
}

async function execute(o, rawInput, ctx) {
  if (!o.public) {
    if (!ctx || !ctx.user) throw new HttpError(401, 'Sign in required.');
    if (!o.roles.includes(ctx.user.role)) throw new HttpError(403, `The ${ctx.user.role} role cannot use "${o.name}".`);
    if (!ctx.scopes.includes(o.scope)) throw new HttpError(403, `This credential lacks the "${o.scope}" scope required by "${o.name}".`);
  }
  const t0 = Date.now();
  const logged = ctx && (ctx.via === 'api' || ctx.via === 'mcp') && o.method !== 'GET' || (ctx && ctx.via === 'mcp');
  try {
    const input = validate(o.input, rawInput || {});
    const out = await o.handler(input, ctx || systemCtx());
    if (logged) logCall(o, ctx, 200, Date.now() - t0, summarize(out));
    return out;
  } catch (e) {
    if (logged) logCall(o, ctx, e.status || 500, Date.now() - t0, e.message);
    throw e;
  }
}
function summarize(out) {
  if (!out || typeof out !== 'object') return '';
  if (Array.isArray(out)) return `${out.length} result(s)`;
  return [out.number, out.title || out.name, out.status].filter(Boolean).join(' · ');
}

const SYSTEM_USER = { id: null, name: 'System', role: 'owner', kind: 'system', active: 1 };
function systemCtx(name = 'System', via = 'system') {
  return { user: { ...SYSTEM_USER, name }, key: null, scopes: ROLE_SCOPES.owner, via, actor: name };
}
function userCtx(user, via, key = null, scopes = null) {
  return { user, key, scopes: scopes || ROLE_SCOPES[user.role] || ['read'], via, actor: actorName(user) };
}

// shared schema snippets
const S = {
  id: { type: 'integer', minimum: 1 },
  idOpt: { type: ['integer', 'null'], minimum: 1 },
  date: { type: ['string', 'null'], format: 'date', description: 'YYYY-MM-DD' },
  dateTime: { type: 'string', format: 'date-time', description: 'Local business time like 2026-11-18T09:00, or ISO 8601 with offset' },
  str: (description, maxLength = 2000) => ({ type: 'string', maxLength, ...(description ? { description } : {}) }),
  num: (description, extra = {}) => ({ type: 'number', ...(description ? { description } : {}), ...extra }),
  int: (description, extra = {}) => ({ type: 'integer', ...(description ? { description } : {}), ...extra }),
  bool: description => ({ type: 'boolean', ...(description ? { description } : {}) }),
  enum: (values, description) => ({ type: 'string', enum: values, ...(description ? { description } : {}) }),
  limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Max rows to return (default 100)' },
  offset: { type: 'integer', minimum: 0, description: 'Rows to skip, for paging' },
  obj: (properties, required = [], description) => ({ type: 'object', properties, ...(required.length ? { required } : {}), ...(description ? { description } : {}) })
};
const PRIORITY = ['low', 'normal', 'high', 'urgent'];

module.exports = { op, OPS, BY_NAME, match, execute, permitted, systemCtx, userCtx, S, PRIORITY };
