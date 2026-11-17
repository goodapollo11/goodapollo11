'use strict';
// NurzWorks HQ - authentication, sessions, API keys (AI staff), permissions and secret encryption.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { all, get, run, insert, now, setting, setSetting, DATA_DIR } = require('./db');
const { HttpError, token, sha256, str } = require('./util');

// ---------------- passwords (scrypt) ----------------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, N, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, got);
}
function passwordProblem(pw) {
  if (!pw || String(pw).length < 8) return 'Password must be at least 8 characters.';
  return null;
}

// ---------------- roles & scopes ----------------
// Roles describe a person (or AI staff member). Scopes describe what a credential may do.
const ROLES = ['owner', 'admin', 'office', 'field', 'viewer'];
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', office: 'Office / dispatch', field: 'Field technician', viewer: 'Viewer (read-only)' };
const ROLE_SCOPES = {
  owner: ['read', 'write', 'email.send', 'admin', 'owner'],
  admin: ['read', 'write', 'email.send', 'admin'],
  office: ['read', 'write', 'email.send'],
  field: ['read', 'write'],
  viewer: ['read']
};
const KEY_SCOPES = ['read', 'write', 'email.send', 'admin'];
const R = {
  ALL: ['owner', 'admin', 'office', 'field', 'viewer'],
  STAFF: ['owner', 'admin', 'office', 'field'],
  OFFICE: ['owner', 'admin', 'office'],
  BOOKS: ['owner', 'admin', 'office', 'viewer'], // money & reports: not field techs
  ADMIN: ['owner', 'admin'],
  OWNER: ['owner']
};
function scopesFor(user, key) {
  const roleScopes = ROLE_SCOPES[user.role] || ['read'];
  if (!key) return roleScopes;
  const keyScopes = str(key.scopes).split(',').map(s => s.trim()).filter(Boolean);
  return roleScopes.filter(s => keyScopes.includes(s) || (s === 'owner' && keyScopes.includes('admin')));
}

// ---------------- sessions ----------------
const SESSION_DAYS = 30;
function createSession(userId, req) {
  const t = token(32);
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  run('INSERT INTO sessions(id,user_id,created_at,expires_at,last_seen_at,ip,user_agent) VALUES(:id,:u,:t,:e,:t,:ip,:ua)', {
    id: sha256(t), u: userId, t: now(), e: exp, ip: clientIp(req), ua: str(req && req.headers['user-agent']).slice(0, 200)
  });
  return t;
}
function resolveSession(t) {
  if (!t) return null;
  const s = get(`SELECT s.id sid, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=:id`, { id: sha256(t) });
  if (!s || s.expires_at < now() || !s.active) return null;
  // sliding expiry, written at most every 10 minutes
  if (Date.now() - new Date(s.last_seen_at).getTime() > 6e5) {
    run('UPDATE sessions SET last_seen_at=:t, expires_at=:e WHERE id=:id', { t: now(), e: new Date(Date.now() + SESSION_DAYS * 864e5).toISOString(), id: s.sid });
    run('UPDATE users SET last_seen_at=:t WHERE id=:id', { t: now(), id: s.id });
  }
  const { sid, expires_at, last_seen_at, password_hash, ...user } = s;
  return user;
}
function destroySession(t) { if (t) run('DELETE FROM sessions WHERE id=:id', { id: sha256(t) }); }
function destroyUserSessions(userId) { run('DELETE FROM sessions WHERE user_id=:u', { u: userId }); }
function pruneSessions() { run('DELETE FROM sessions WHERE expires_at < :t', { t: now() }); }

// ---------------- API keys (for AI staff, integrations, scripts) ----------------
function createApiKey({ userId, name, scopes, createdBy }) {
  const secret = 'nwk_' + token(30);
  const id = insert('api_keys', {
    user_id: userId, name: str(name) || 'API key', prefix: secret.slice(0, 12), key_hash: sha256(secret),
    scopes: (scopes && scopes.length ? scopes : ['read', 'write']).filter(s => KEY_SCOPES.includes(s)).join(','), created_by: createdBy || '', created_at: now()
  });
  return { id, key: secret };
}
function resolveApiKey(secret) {
  if (!secret || !secret.startsWith('nwk_')) return null;
  const k = get('SELECT * FROM api_keys WHERE key_hash=:h AND revoked_at IS NULL', { h: sha256(secret) });
  if (!k) return null;
  const u = get('SELECT * FROM users WHERE id=:id AND active=1', { id: k.user_id });
  if (!u) return null;
  run('UPDATE api_keys SET last_used_at=:t, use_count=use_count+1 WHERE id=:id', { t: now(), id: k.id });
  run('UPDATE users SET last_seen_at=:t WHERE id=:id', { t: now(), id: u.id });
  delete u.password_hash;
  return { key: k, user: u };
}

// ---------------- secret encryption (AES-256-GCM) ----------------
// OAuth tokens and integration secrets are encrypted at rest. The key comes from NW_SECRET_KEY or data/secret.key,
// which is never included in backups, so a leaked backup file does not leak live credentials.
let KEY = null;
function secretKey() {
  if (KEY) return KEY;
  if (process.env.NW_SECRET_KEY) { KEY = crypto.createHash('sha256').update(process.env.NW_SECRET_KEY).digest(); return KEY; }
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  KEY = crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').trim()).digest();
  return KEY;
}
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(blob) {
  if (!blob || !String(blob).startsWith('enc:v1:')) return blob;
  try {
    const b = Buffer.from(String(blob).slice(7), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch (_) { return null; }
}
const getSecret = k => { const v = setting(k); return v ? decrypt(v) : null; };
const setSecret = (k, v) => setSetting(k, v ? encrypt(v) : null);

// ---------------- first-run setup code ----------------
function setupCode() {
  let c = setting('setup_code');
  if (!c) { c = crypto.randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-'); setSetting('setup_code', c); }
  return c;
}
const needsSetup = () => !get("SELECT id FROM users WHERE role='owner' AND kind='human' LIMIT 1");

// ---------------- login throttling ----------------
const attempts = new Map();
function throttle(key) {
  const t = Date.now(); const a = (attempts.get(key) || []).filter(x => t - x < 15 * 60e3);
  if (a.length >= 10) throw new HttpError(429, 'Too many attempts. Wait 15 minutes and try again.');
  a.push(t); attempts.set(key, a);
}
const clearThrottle = key => attempts.delete(key);
function clientIp(req) {
  if (!req) return '';
  const xf = process.env.NW_TRUST_PROXY ? str(req.headers['x-forwarded-for']).split(',')[0].trim() : '';
  return xf || (req.socket && req.socket.remoteAddress) || '';
}

function actorName(user) { return !user ? 'System' : user.kind === 'ai' ? `${user.name} (AI)` : user.name; }
function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, has_password: !!password_hash };
}

module.exports = {
  hashPassword, verifyPassword, passwordProblem, ROLES, ROLE_LABEL, ROLE_SCOPES, KEY_SCOPES, R, scopesFor,
  createSession, resolveSession, destroySession, destroyUserSessions, pruneSessions, SESSION_DAYS,
  createApiKey, resolveApiKey, encrypt, decrypt, getSecret, setSecret, setupCode, needsSetup, throttle, clearThrottle, clientIp, actorName, publicUser
};
