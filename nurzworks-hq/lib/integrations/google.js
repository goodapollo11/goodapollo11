'use strict';
// Google OAuth 2.0 for the business Google Workspace account (Gmail + Google Calendar).
// Create the OAuth client in a Google Cloud project owned by your Workspace and set the consent screen to
// "Internal": then Gmail's restricted scopes need no Google verification. Tokens are encrypted at rest.
const crypto = require('crypto');
const { setting, setSetting } = require('../db');
const { getSecret, setSecret } = require('../auth');
const { HttpError, str } = require('../util');
const { baseUrl, company } = require('../config');

const OAUTH = () => (process.env.NW_GOOGLE_OAUTH_BASE || 'https://accounts.google.com').replace(/\/$/, '');
const TOKEN_URL = () => process.env.NW_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const REVOKE_URL = () => process.env.NW_GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
// For tests: NW_GOOGLE_API_BASE replaces both API hosts.
function apiUrl(path) {
  if (process.env.NW_GOOGLE_API_BASE) return process.env.NW_GOOGLE_API_BASE.replace(/\/$/, '') + path;
  return (path.startsWith('/gmail/') ? 'https://gmail.googleapis.com' : 'https://www.googleapis.com') + path;
}
const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly'
];

const clientId = () => setting('google_client_id') || process.env.NW_GOOGLE_CLIENT_ID || '';
const clientSecret = () => getSecret('google_client_secret') || process.env.NW_GOOGLE_CLIENT_SECRET || '';
const configured = () => !!(clientId() && clientSecret());
function tokens() { try { return JSON.parse(getSecret('google_tokens') || 'null'); } catch (_) { return null; } }
const connected = () => { const t = tokens(); return !!(t && t.refresh_token); };
const redirectUri = () => `${baseUrl()}/oauth/google/callback`;

function authUrl() {
  if (!configured()) throw new HttpError(409, 'Save the Google OAuth client ID and secret first.');
  const state = crypto.randomBytes(18).toString('base64url');
  setSetting('google_oauth_state', `${state}|${Date.now() + 15 * 60e3}`);
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', state
  });
  const hint = setting('company_email');
  if (hint) q.set('login_hint', hint);
  return `${OAUTH()}/o/oauth2/v2/auth?${q}`;
}
function checkState(state) {
  const [s, exp] = String(setting('google_oauth_state') || '').split('|');
  setSetting('google_oauth_state', null);
  if (!s || !state || Number(exp) < Date.now()) return false;
  return s.length === state.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(state));
}
async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `Google sign-in failed: ${data.error_description || data.error || res.status}`);
  return data;
}
function saveTokens(data, prev = {}) {
  const t = {
    access_token: data.access_token, refresh_token: data.refresh_token || prev.refresh_token,
    expires_at: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000, scope: data.scope || prev.scope || ''
  };
  setSecret('google_tokens', JSON.stringify(t));
  return t;
}
async function exchange(code) {
  const data = await tokenRequest({ code, client_id: clientId(), client_secret: clientSecret(), redirect_uri: redirectUri(), grant_type: 'authorization_code' });
  if (!data.refresh_token) throw new HttpError(502, 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  saveTokens(data);
  let email = '';
  if (data.id_token) { try { email = JSON.parse(Buffer.from(data.id_token.split('.')[1], 'base64url').toString()).email || ''; } catch (_) { /* ignore */ } }
  if (!email) { try { email = (await api('/oauth2/v3/userinfo')).email || ''; } catch (_) { /* ignore */ } }
  setSetting('google_email', email);
  setSetting('google_connected_at', new Date().toISOString());
  if (!setting('company_email') && email) setSetting('company_email', email);
  return { email, scope: data.scope };
}
let refreshing = null;
async function accessToken() {
  const t = tokens();
  if (!t || !t.refresh_token) throw new HttpError(409, 'Google is not connected. An admin can connect it under Integrations.');
  if (t.access_token && t.expires_at > Date.now()) return t.access_token;
  if (!refreshing) refreshing = (async () => {
    try { return saveTokens(await tokenRequest({ client_id: clientId(), client_secret: clientSecret(), refresh_token: t.refresh_token, grant_type: 'refresh_token' }), t).access_token; }
    catch (e) {
      if (/invalid_grant/i.test(e.message)) { setSetting('google_error', 'Google access was revoked or expired. Reconnect Google in Integrations.'); }
      throw e;
    } finally { refreshing = null; }
  })();
  return refreshing;
}
async function api(path, { method = 'GET', query, body, raw = false } = {}) {
  const url = apiUrl(path) + (query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([k, v]) => Array.isArray(v) ? v.map(x => [k, x]) : [[k, v]])) : '');
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await accessToken();
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && attempt === 0) { const t = tokens(); if (t) { t.expires_at = 0; setSecret('google_tokens', JSON.stringify(t)); } continue; }
    if (res.status === 204) return {};
    const data = raw ? await res.text() : await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || res.statusText;
      const err = new HttpError(res.status === 404 || res.status === 410 ? res.status : 502, `Google API: ${msg}`);
      err.googleStatus = res.status;
      throw err;
    }
    setSetting('google_error', null);
    return data;
  }
}
async function disconnect() {
  const t = tokens();
  if (t && t.refresh_token) { try { await fetch(`${REVOKE_URL()}?token=${encodeURIComponent(t.refresh_token)}`, { method: 'POST' }); } catch (_) { /* best effort */ } }
  for (const k of ['google_tokens', 'google_email', 'google_connected_at', 'google_error']) setSetting(k, null);
}
function status() {
  const t = tokens();
  return {
    configured: configured(), connected: connected(), email: setting('google_email') || '', connected_at: setting('google_connected_at'),
    scopes: t ? t.scope : '', redirect_uri: redirectUri(), client_id: clientId(), error: setting('google_error') || '', sender_name: company().name
  };
}
function saveCredentials({ client_id, client_secret }) {
  if (client_id !== undefined) setSetting('google_client_id', str(client_id));
  if (client_secret) setSecret('google_client_secret', str(client_secret));
}

module.exports = { SCOPES, configured, connected, authUrl, checkState, exchange, accessToken, api, disconnect, status, saveCredentials, redirectUri };
