'use strict';
// Team: people and AI staff, their roles, passwords and API keys.
const { all, get, run, insert, update, tx, now } = require('../db');
const { bad, notFound, forbidden, str, normEmail, emailOk, pick } = require('../util');
const { op, S } = require('../ops');
const AU = require('../auth');
const { R, ROLES, KEY_SCOPES } = AU;
const { baseUrl } = require('../config');

const COLORS = ['#1f6fd1', '#2a9d8a', '#eb6834', '#8e5cc7', '#c03c3c', '#c99a06', '#3d8b37', '#0f7c9c', '#b5527d', '#6b7a8f'];
const nextColor = () => COLORS[get('SELECT COUNT(*) n FROM users').n % COLORS.length];
const SAFE = 'id, name, email, phone, role, kind, title, color, active, last_seen_at, instructions, is_demo, created_at';
const FIELDS = {
  name: S.str('', 200), email: S.str('', 200), phone: S.str('', 50), role: S.enum(ROLES, 'owner | admin | office (CRM, scheduling, billing) | field (own visits, time, notes, photos) | viewer'),
  kind: S.enum(['human', 'ai'], 'human = person who signs in; ai = AI staff member that works through API keys / MCP'), title: S.str('Job title, e.g. Lead Technician or AI Office Manager', 120),
  color: S.str('Schedule color (#hex)', 20), cost_rate: S.num('Hourly cost to the business', { minimum: 0 }), bill_rate: S.num('Default hourly rate billed to customers', { minimum: 0 }),
  instructions: S.str('For AI staff: their job description and standing instructions', 20000), active: S.bool()
};

op({
  name: 'list_team', method: 'GET', path: '/api/team', tags: ['Team'],
  title: 'List team', description: 'People and AI staff with role, kind (human/ai), title and schedule color. Use their ids for assignments.',
  input: S.obj({ include_inactive: S.bool(), kind: S.enum(['human', 'ai']) }),
  handler: (i, ctx) => {
    const books = R.BOOKS.includes(ctx.user.role);
    const rows = all(`SELECT ${SAFE}${books ? ', cost_rate, bill_rate' : ''}, password_hash IS NOT NULL has_password,
      (SELECT COUNT(*) FROM api_keys k WHERE k.user_id=u.id AND k.revoked_at IS NULL) key_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to=u.id AND t.status IN ('open','in_progress','waiting')) open_tasks
      FROM users u ${i.include_inactive ? 'WHERE 1=1' : 'WHERE active=1'} ${i.kind ? 'AND kind=:k' : ''} ORDER BY active DESC, kind, name`, { k: i.kind });
    return rows.map(r => ({ ...r, has_password: !!r.has_password }));
  }
});

function validateMember(o, id = 0) {
  if (o.email !== undefined) {
    o.email = normEmail(o.email);
    if (o.email && !emailOk(o.email)) bad('email must be a valid email address.');
    if (o.email && get('SELECT id FROM users WHERE lower(email)=:e AND id != :id', { e: o.email, id })) bad('Another team member already uses that email.');
  }
  if (o.color !== undefined && o.color && !/^#[0-9a-fA-F]{6}$/.test(o.color)) bad('color must look like #1f6fd1.');
}
op({
  name: 'create_team_member', method: 'POST', path: '/api/team', tags: ['Team'], scope: 'admin', mcp: false,
  title: 'Add team member', description: 'Add a person (with a sign-in password) or an AI staff member (works through API keys).',
  input: S.obj({ ...FIELDS, password: S.str('Sign-in password (people only)', 200) }, ['name']),
  handler: (i, ctx) => {
    const o = pick(i, Object.keys(FIELDS));
    o.kind = o.kind || 'human';
    o.role = o.role || (o.kind === 'ai' ? 'office' : 'field');
    if (o.role === 'owner' && ctx.user.role !== 'owner') forbidden('Only the owner can add another owner.');
    validateMember(o);
    if (o.kind === 'human' && i.password) { const p = AU.passwordProblem(i.password); if (p) bad(p); }
    if (o.kind === 'human' && o.role !== 'viewer' && !o.email && i.password) bad('People who sign in need an email address.');
    const t = now();
    const id = insert('users', { ...o, color: o.color || nextColor(), active: o.active === false ? 0 : 1, password_hash: o.kind === 'human' && i.password ? AU.hashPassword(i.password) : null, created_at: t, updated_at: t });
    return get(`SELECT ${SAFE}, cost_rate, bill_rate FROM users WHERE id=:id`, { id });
  }
});
op({
  name: 'update_team_member', method: 'PUT', path: '/api/team/:id', tags: ['Team'], scope: 'admin', mcp: false,
  title: 'Update team member', input: S.obj({ id: S.id, ...FIELDS }, ['id']),
  handler: (i, ctx) => {
    const u = get('SELECT * FROM users WHERE id=:id', { id: i.id }) || notFound('Team member');
    const o = pick(i, Object.keys(FIELDS));
    if (u.role === 'owner' && ctx.user.role !== 'owner') forbidden('Only the owner can change the owner account.');
    if (o.role === 'owner' && ctx.user.role !== 'owner') forbidden('Only the owner can make someone an owner.');
    const owners = get("SELECT COUNT(*) n FROM users WHERE role='owner' AND active=1 AND kind='human'").n;
    if (u.role === 'owner' && owners <= 1 && ((o.role && o.role !== 'owner') || o.active === false)) bad('There must always be at least one active owner.');
    validateMember(o, u.id);
    if (o.active !== undefined) o.active = o.active ? 1 : 0;
    if (o.name === '') bad('name is required.');
    update('users', u.id, { ...o, updated_at: now() });
    if (o.active === 0) { AU.destroyUserSessions(u.id); run('UPDATE api_keys SET revoked_at=:t WHERE user_id=:u AND revoked_at IS NULL', { t: now(), u: u.id }); }
    return get(`SELECT ${SAFE}, cost_rate, bill_rate FROM users WHERE id=:id`, { id: u.id });
  }
});
op({
  name: 'set_team_password', method: 'POST', path: '/api/team/:id/password', tags: ['Team'], scope: 'admin', mcp: false,
  title: 'Set a password', input: S.obj({ id: S.id, password: S.str('', 200) }, ['id', 'password']),
  handler: (i, ctx) => {
    const u = get('SELECT * FROM users WHERE id=:id', { id: i.id }) || notFound('Team member');
    if (u.kind !== 'human') bad('AI staff sign in with API keys, not passwords.');
    if (u.role === 'owner' && ctx.user.role !== 'owner') forbidden('Only the owner can change the owner password.');
    const p = AU.passwordProblem(i.password); if (p) bad(p);
    if (!u.email) bad('Add an email address first - it is the sign-in name.');
    update('users', u.id, { password_hash: AU.hashPassword(i.password), updated_at: now() });
    if (u.id !== ctx.user.id) AU.destroyUserSessions(u.id);
    return { ok: true };
  }
});

// ---------------- me ----------------
op({
  name: 'get_me', method: 'GET', path: '/api/me', tags: ['Team'],
  title: 'Who am I', description: 'Your own team record: name, role, kind, permissions (scopes) and, for AI staff, your standing instructions.',
  input: S.obj({}),
  handler: (i, ctx) => ({ ...AU.publicUser(get(`SELECT * FROM users WHERE id=:id`, { id: ctx.user.id }) || ctx.user), scopes: ctx.scopes, via: ctx.via })
});
op({
  name: 'update_me', method: 'PUT', path: '/api/me', tags: ['Team'], roles: R.ALL, scope: 'read', mcp: false,
  title: 'Update my profile', input: S.obj({ name: S.str('', 200), phone: S.str('', 50), theme: S.enum(['', 'nurzworks', 'forest', 'forest-night']), color: S.str('', 20), current_password: S.str('', 200), new_password: S.str('', 200) }),
  handler: (i, ctx) => {
    const u = get('SELECT * FROM users WHERE id=:id', { id: ctx.user.id }) || notFound('User');
    const o = pick(i, ['name', 'phone', 'theme', 'color']);
    if (o.name === '') bad('name is required.');
    if (o.color && !/^#[0-9a-fA-F]{6}$/.test(o.color)) bad('color must look like #1f6fd1.');
    if (i.new_password) {
      if (ctx.key) forbidden('Change passwords from a signed-in session.');
      if (u.password_hash && !AU.verifyPassword(i.current_password || '', u.password_hash)) bad('Your current password is not correct.');
      const p = AU.passwordProblem(i.new_password); if (p) bad(p);
      o.password_hash = AU.hashPassword(i.new_password);
    }
    update('users', u.id, { ...o, updated_at: now() });
    return AU.publicUser(get('SELECT * FROM users WHERE id=:id', { id: u.id }));
  }
});

// ---------------- API keys (AI staff, scripts, integrations) ----------------
op({
  name: 'list_api_keys', method: 'GET', path: '/api/keys', tags: ['Team'], scope: 'admin', mcp: false,
  title: 'List API keys', input: S.obj({ user_id: S.idOpt }),
  handler: i => all(`SELECT k.id, k.user_id, u.name user_name, u.kind user_kind, u.role user_role, k.name, k.prefix, k.scopes, k.last_used_at, k.use_count, k.revoked_at, k.created_by, k.created_at
    FROM api_keys k JOIN users u ON u.id=k.user_id ${i.user_id ? 'WHERE k.user_id=:u' : ''} ORDER BY k.revoked_at IS NOT NULL, k.created_at DESC`, { u: i.user_id })
});
op({
  name: 'create_api_key', method: 'POST', path: '/api/keys', tags: ['Team'], scope: 'admin', mcp: false,
  title: 'Create API key', description: 'Create a key for an AI staff member or integration. The secret is shown only once.',
  input: S.obj({ user_id: S.id, name: S.str('', 120), scopes: { type: 'array', items: S.enum(KEY_SCOPES), description: 'read, write, email.send, admin' } }, ['user_id']),
  handler: (i, ctx) => {
    const u = get('SELECT * FROM users WHERE id=:id AND active=1', { id: i.user_id }) || notFound('Team member');
    if (u.role === 'owner' && ctx.user.role !== 'owner') forbidden('Only the owner can create keys that act as the owner.');
    const scopes = i.scopes && i.scopes.length ? i.scopes : ['read', 'write'];
    if (scopes.includes('admin') && !['owner', 'admin'].includes(u.role)) bad(`${u.name}'s role (${u.role}) cannot use the admin scope.`);
    const k = AU.createApiKey({ userId: u.id, name: i.name || `${u.name} key`, scopes, createdBy: ctx.actor });
    const base = baseUrl();
    return {
      id: k.id, key: k.key, user: { id: u.id, name: u.name, role: u.role, kind: u.kind }, scopes,
      mcp_url: `${base}/mcp`, mcp_secret_url: `${base}/mcp/${k.key}`, api_base: `${base}/api`, openapi_url: `${base}/api/openapi.json`,
      warning: 'Copy this key now - it will not be shown again. Treat the secret MCP URL like a password.'
    };
  }
});
op({
  name: 'revoke_api_key', method: 'DELETE', path: '/api/keys/:id', tags: ['Team'], scope: 'admin', mcp: false,
  title: 'Revoke API key', input: S.obj({ id: S.id }, ['id']),
  handler: i => { run('UPDATE api_keys SET revoked_at=:t WHERE id=:id AND revoked_at IS NULL', { t: now(), id: i.id }); return { ok: true }; }
});
op({
  name: 'ai_activity', method: 'GET', path: '/api/ai/activity', tags: ['Team'], roles: R.BOOKS, mcp: false,
  title: 'AI staff activity log', description: 'Recent API and MCP calls by AI staff and integrations.',
  input: S.obj({ user_id: S.idOpt, limit: S.limit }),
  handler: i => all(`SELECT c.*, u.name user_name, u.kind user_kind, k.name key_name FROM api_calls c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN api_keys k ON k.id=c.key_id
    ${i.user_id ? 'WHERE c.user_id=:u' : ''} ORDER BY c.id DESC LIMIT :l`, { u: i.user_id, l: i.limit || 200 })
});

module.exports = { COLORS, nextColor };
