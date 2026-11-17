/* NurzWorks HQ - core: API, auth, state, router, theme, UI helpers, charts (same conventions as the NurzWorks CMMS) */
'use strict';

// ---------------- icons (original line icons) ----------------
const ICONS = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  today: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15" r="2.2"/>',
  wo: '<path d="M9 4h6M9 4a1 1 0 0 0-1 1v1h8V5a1 1 0 0 0-1-1"/><rect x="5" y="5.5" width="14" height="15.5" rx="2"/><path d="M9 11h6M9 15h4"/>',
  inbox: '<path d="M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.2c2.4.2 4 1.8 4.5 4.3"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
  est: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  inv: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 7 8.5-7"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12.5 2.5 2.5 5-5.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3M20 16V6"/>',
  ai: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4.5M9 13h.01M15 13h.01M9.5 16.5h5"/><circle cx="12" cy="4" r="1"/>',
  plug: '<path d="M9 2v5M15 2v5M7 7h10v4a5 5 0 0 1-10 0z"/><path d="M12 16v6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  play: '<path d="M7 5v14l11-7z"/>', pause: '<path d="M8 5v14M16 5v14"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', print: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M7 14h10v7H7z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>', upload: '<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>', alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  dollar: '<path d="M12 3v18M16.5 7.5c-.6-1.4-2.3-2.3-4.5-2.3-2.6 0-4.3 1.3-4.3 3.2 0 4.4 9 2.3 9 6.8 0 2-1.9 3.4-4.7 3.4-2.3 0-4.1-1-4.8-2.6"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>', ban: '<circle cx="12" cy="12" r="8.5"/><path d="m6 6 12 12"/>',
  database: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>', chevL: '<path d="m15 6-6 6 6 6"/>', list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', nav: '<path d="M3 11 21 3l-8 18-2-8z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', sms: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  truck: '<path d="M3 6h11v10H3zM14 9.5h4l3 3.5v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>', camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  pen: '<path d="M3 21c3-1 5-3 7-6l7-7a2.1 2.1 0 0 0-3-3l-7 7c-3 2-5 4-6 7"/><path d="M14 5l3 3"/>', leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="M5 19c3-4 6-7 10-9"/>',
  tree: '<path d="M12 3 6 11h3l-4 6h14l-4-6h3z"/><path d="M12 17v4"/>', moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>', copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>', archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
  reply: '<path d="M10 9V5l-7 7 7 7v-4c5 0 8 1.5 11 5-1-6-4-10-11-11z"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L14.5 7"/>', more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>', slack: '<path d="M10 3a2 2 0 0 0 0 4h2V5a2 2 0 0 0-2-2zM4 10a2 2 0 0 0 4 0V8H6a2 2 0 0 0-2 2zm10 11a2 2 0 0 0 0-4h-2v2a2 2 0 0 0 2 2zm6-7a2 2 0 0 0-4 0v2h2a2 2 0 0 0 2-2zM12 8v5M8 12h5M12 16v-4M16 12h-4"/>',
  google: '<path d="M20.5 12.2c0-.6-.1-1.2-.2-1.7H12v3.3h4.8a4.1 4.1 0 0 1-1.8 2.7v2.2h2.9a8.7 8.7 0 0 0 2.6-6.5z"/><path d="M12 21c2.4 0 4.4-.8 5.9-2.2L15 16.6c-.8.6-1.8.9-3 .9-2.3 0-4.3-1.6-5-3.7H4v2.3A9 9 0 0 0 12 21z"/><path d="M7 13.8a5.4 5.4 0 0 1 0-3.6V7.9H4a9 9 0 0 0 0 8.2z"/><path d="M12 6.6c1.3 0 2.5.5 3.4 1.3L18 5.4A9 9 0 0 0 4 7.9l3 2.3c.7-2.1 2.7-3.6 5-3.6z"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>', arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>', home: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/>'
};
const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

// ---------------- utilities ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const e = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = s => (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const S = { meta: null, me: null, timer: null, timerTick: null };
const TZ = () => (S.meta && S.meta.timezone) || Intl.DateTimeFormat().resolvedOptions().timeZone;
const dtfCache = {};
function parts(iso) {
  const tz = TZ();
  const f = dtfCache[tz] ||= new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  const p = {}; for (const x of f.formatToParts(new Date(iso))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, h: +p.hour, m: +p.minute, min: +p.hour * 60 + +p.minute, wd: p.weekday };
}
const todayStr = () => parts(new Date().toISOString()).date;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const localInput = iso => { if (!iso) return ''; const p = parts(iso); return `${p.date}T${p.time}`; };
const dayDiff = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const weekday = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
const fmt = {
  money: (v, d = 2) => v == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: (S.meta && S.meta.currency) || 'USD', maximumFractionDigits: d, minimumFractionDigits: d }).format(v),
  money0: v => fmt.money(v, 0),
  num: (v, d = 0) => v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }),
  pct: v => v == null ? '—' : `${Math.round(v)}%`,
  date: s => { if (!s) return '—'; const d = new Date(s.length === 10 ? s + 'T12:00:00Z' : s); return d.toLocaleDateString('en-US', { timeZone: s.length === 10 ? 'UTC' : TZ(), month: 'short', day: 'numeric', year: d.getUTCFullYear() !== new Date().getUTCFullYear() ? 'numeric' : undefined }); },
  dateLong: s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  dt: s => s ? new Date(s).toLocaleString('en-US', { timeZone: TZ(), month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—',
  time: s => s ? new Date(s).toLocaleTimeString('en-US', { timeZone: TZ(), hour: 'numeric', minute: '2-digit' }) : '—',
  rel: s => {
    if (!s) return '—'; const diff = (Date.now() - new Date(s)) / 1000;
    if (diff < 60) return 'just now'; if (diff < 3600) return `${Math.floor(diff / 60)}m ago`; if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`; return fmt.date(s);
  },
  dueIn: s => { if (!s) return ''; const d = dayDiff(todayStr(), s); return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d === -1 ? 'yesterday' : d < 0 ? `${-d} days ago` : `in ${d} days`; },
  month: p => { const [y, m] = p.split('-'); return new Date(Date.UTC(+y, +m - 1, 15)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }) + " '" + y.slice(2); },
  hours: v => v == null ? '—' : `${fmt.num(v, 2)} h`,
  dur: ms => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; }
};
const initials = n => (n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
const opt = (list, sel, blank) => (blank !== undefined ? `<option value="">${e(blank)}</option>` : '') + list.map(o => { const [v, l] = Array.isArray(o) ? o : [o.id ?? o, o.name ?? o]; return `<option value="${e(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${e(l)}</option>`; }).join('');
const LABELS = {
  job: { unscheduled: 'Unscheduled', scheduled: 'Scheduled', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed', invoiced: 'Invoiced', cancelled: 'Cancelled' },
  visit: { scheduled: 'Scheduled', en_route: 'On the way', on_site: 'On site', completed: 'Completed', cancelled: 'Cancelled' },
  estimate: { draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined', expired: 'Expired', converted: 'Won' },
  invoice: { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', partial: 'Partly paid', paid: 'Paid', void: 'Void', overdue: 'Overdue' },
  request: { new: 'New', contacted: 'Contacted', quoted: 'Quoted', scheduled: 'Scheduled', converted: 'Converted', declined: 'Declined' },
  task: { open: 'Open', in_progress: 'In progress', waiting: 'Waiting', done: 'Done', cancelled: 'Cancelled' },
  customer: { lead: 'Lead', active: 'Active', inactive: 'Inactive' },
  plan: { active: 'Active', paused: 'Paused', ended: 'Ended' }
};
const pill = (kind, s) => `<span class="pill st-${e(s)}"><span class="dot"></span>${e((LABELS[kind] || {})[s] || cap(s))}</span>`;
const PRI_ICON = { urgent: '<svg viewBox="0 0 12 12"><path d="M6 1 11 10H1z" fill="currentColor"/></svg>', high: '<svg viewBox="0 0 12 12"><path d="M2 8 6 3l4 5" stroke="currentColor" stroke-width="2" fill="none"/></svg>', normal: '<svg viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="2"/></svg>', low: '<svg viewBox="0 0 12 12"><path d="M2 4l4 5 4-5" stroke="currentColor" stroke-width="2" fill="none"/></svg>' };
const priPill = p => `<span class="pr pr-${e(p)}">${PRI_ICON[p] || ''}${cap(p)}</span>`;
const invStatus = i => i.is_overdue ? `${pill('invoice', 'overdue')}` : pill('invoice', i.status);
const userById = id => (S.meta.team || []).find(u => u.id === Number(id));
const avatar = (u, cls = 'sm') => u ? `<span class="avatar ${cls} ${u.kind === 'ai' ? 'ai' : ''}" style="background:${e(u.color || 'var(--primary)')}" title="${e(u.name)}">${e(initials(u.name))}</span>` : '';
const mapsUrl = addr => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
const telUrl = p => `tel:${String(p).replace(/[^\d+]/g, '')}`;
const smsUrl = (p, body) => `sms:${String(p).replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(body)}`;
const can = what => {
  const r = S.me ? S.me.role : 'viewer';
  if (what === 'admin') return r === 'owner' || r === 'admin';
  if (what === 'office') return ['owner', 'admin', 'office'].includes(r);
  if (what === 'books') return ['owner', 'admin', 'office', 'viewer'].includes(r);
  if (what === 'write') return r !== 'viewer';
  if (what === 'email') return S.me && (S.me.scopes || []).includes('email.send');
  return true;
};

// ---------------- API ----------------
async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, { method, headers: raw ? { 'X-NW-Request': '1', ...raw.headers } : { 'Content-Type': 'application/json', 'X-NW-Request': '1' }, body: raw ? raw.body : body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) { showAuth(); throw new Error('Please sign in again.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const POST = (p, b = {}) => api(p, { method: 'POST', body: b });
const PUT = (p, b = {}) => api(p, { method: 'PUT', body: b });
const DEL = p => api(p, { method: 'DELETE' });
const qs = o => { const x = Object.entries(o).filter(([, v]) => v !== '' && v != null); return x.length ? '?' + new URLSearchParams(x) : ''; };

// ---------------- theme ----------------
const THEMES = [['nurzworks', 'NurzWorks', 'dash'], ['forest', 'Forest', 'tree'], ['forest-night', 'Forest Night', 'moon']];
function applyTheme(t, save = true) {
  if (!THEMES.some(x => x[0] === t)) t = 'nurzworks';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('nw_theme', t); } catch (_) { /* ignore */ }
  const m = $('meta[name="theme-color"]'); if (m) m.content = { nurzworks: '#0f2a44', forest: '#1b3326', 'forest-night': '#0c1a12' }[t];
  if (save && S.me) PUT('/api/me', { theme: t }).catch(() => {});
  if (S.meta) router();
}
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
const CH = () => ({ s1: cssVar('--s1'), s2: cssVar('--s2'), s3: cssVar('--s3'), s4: cssVar('--s4'), grid: cssVar('--grid'), axis: cssVar('--axis'), muted: cssVar('--chart-ink'), card: cssVar('--card'), crit: cssVar('--crit'), warn: cssVar('--warn'), good: cssVar('--good') });

// ---------------- toasts, tooltip ----------------
function toast(msg, type = '') {
  const t = document.createElement('div'); t.className = 'toast ' + type; t.innerHTML = (type === 'error' ? icon('alert') : icon('check')) + `<span>${e(msg)}</span>`;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), type === 'error' ? 6000 : 3000);
}
const tip = $('#tip');
function showTip(html, ev) { tip.innerHTML = html; tip.hidden = false; moveTip(ev); }
function moveTip(ev) { const w = tip.offsetWidth, h = tip.offsetHeight; let x = ev.clientX + 14, y = ev.clientY + 14; if (x + w > innerWidth - 8) x = ev.clientX - w - 14; if (y + h > innerHeight - 8) y = ev.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
function hideTip() { tip.hidden = true; }
document.addEventListener('mouseover', ev => { const t = ev.target.closest && ev.target.closest('[data-tip]'); if (t) showTip(t.dataset.tip, ev); });
document.addEventListener('mousemove', ev => { if (!tip.hidden) { if (ev.target.closest && ev.target.closest('[data-tip]')) moveTip(ev); else hideTip(); } });
const copyText = async t => { try { await navigator.clipboard.writeText(t); toast('Copied'); } catch (_) { prompt('Copy this:', t); } };

// ---------------- modal & forms ----------------
function modal({ title, body, size = '', foot, onMount, headExtra = '' }) {
  return new Promise(resolve => {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${e(title)}"><div class="modal-h"><h2>${e(title)}</h2>${headExtra}<button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
      <div class="modal-b">${body}</div>${foot !== null ? `<div class="modal-f">${foot || '<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Save</button>'}</div>` : ''}</div>`;
    $('#modalRoot').appendChild(bg);
    const close = v => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = ev => { if (ev.key === 'Escape' && $('#modalRoot').lastElementChild === bg) close(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', ev => { if (ev.target === bg) close(null); });
    $$('[data-x]', bg).forEach(b => b.onclick = () => close(null));
    const ctx = { el: bg, close, error: msg => { let x = $('.err', bg); if (!x) { x = document.createElement('div'); x.className = 'err'; $('.modal-b', bg).prepend(x); } x.textContent = msg; x.scrollIntoView({ block: 'nearest' }); } };
    if (onMount) onMount(ctx);
    // focus the first field unless the user (or an automation) already started typing somewhere in the dialog
    if (matchMedia('(min-width: 821px)').matches) { const first = $('input:not([type=hidden]):not([type=checkbox]):not([readonly]), select, textarea', bg); if (first) setTimeout(() => { if (!bg.contains(document.activeElement)) first.focus(); }, 30); }
  });
}
function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return modal({ title, size: 'narrow', body: `<p style="margin:0">${text}</p>`, foot: `<button class="btn" data-x>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${e(okLabel)}</button>`,
    onMount: ctx => { $('[data-ok]', ctx.el).onclick = () => ctx.close(true); } });
}
// field spec: {name,label,type,options,value,required,full,hint,step,min,placeholder,rows,blank,html}
function fieldHtml(f) {
  if (f.type === 'heading') return `<h4>${e(f.label)}</h4>`;
  if (f.type === 'html') return `<div class="field ${f.full ? 'full' : ''}">${f.label ? `<label>${e(f.label)}</label>` : ''}${f.html}</div>`;
  const id = 'f_' + f.name; const v = f.value ?? '';
  let input;
  if (f.type === 'select') input = `<select id="${id}" name="${f.name}">${opt(f.options, v, f.blank)}</select>`;
  else if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}" rows="${f.rows || 3}" placeholder="${e(f.placeholder || '')}">${e(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<div class="field ${f.full ? 'full' : ''}"><label class="check"><input type="checkbox" name="${f.name}" ${v && v !== '0' ? 'checked' : ''}> ${e(f.label)}</label>${f.hint ? `<div class="hint">${e(f.hint)}</div>` : ''}</div>`;
  else if (f.type === 'customer') input = customerPickerHtml(f.name, v, f.label_value);
  else input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${e(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} placeholder="${e(f.placeholder || '')}" ${f.type === 'tel' ? 'inputmode="tel"' : ''} ${f.readonly ? 'readonly' : ''}>`;
  return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${e(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>${input}${f.hint ? `<div class="hint">${e(f.hint)}</div>` : ''}</div>`;
}
function readForm(el) {
  const o = {};
  $$('[name]', el).forEach(i => { if (i.dataset.skip) return; o[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
  return o;
}
// Generic form modal. save(values, ctx) -> result (throw to show the error)
function formModal({ title, fields, save, size = '', okLabel = 'Save', extraFoot = '', cols = '', onMount }) {
  return modal({
    title, size, body: `<form class="form ${cols}" onsubmit="return false">${fields.map(fieldHtml).join('')}</form>`,
    foot: `${extraFoot}<button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>${e(okLabel)}</button>`,
    onMount: ctx => {
      bindCustomerPickers(ctx.el);
      const go = async () => {
        const vals = readForm(ctx.el);
        for (const f of fields) if (f.required && !String(vals[f.name] ?? '').trim()) return ctx.error(`${f.label} is required.`);
        const btn = $('[data-ok]', ctx.el); btn.disabled = true;
        try { ctx.close(await save(vals, ctx) ?? true); } catch (err) { ctx.error(err.message); btn.disabled = false; }
      };
      $('[data-ok]', ctx.el).onclick = go;
      $('form', ctx.el).addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && !ev.target.closest('.ac')) { ev.preventDefault(); go(); } });
      if (onMount) onMount(ctx);
    }
  });
}

// ---------------- customer picker (autocomplete) ----------------
let custCache = null, custCacheAt = 0;
async function customers() { if (!custCache || Date.now() - custCacheAt > 60e3) { custCache = await api('/api/lookup/customers'); custCacheAt = Date.now(); } return custCache; }
const invalidateCustomers = () => { custCache = null; };
function customerPickerHtml(name, value, label = '') {
  return `<div class="ac" data-ac="${name}"><input class="inp" placeholder="Search customers by name, phone, email…" value="${e(label)}" data-skip="1" autocomplete="off"><input type="hidden" name="${name}" value="${e(value || '')}"><div class="ac-list" hidden></div></div>`;
}
function bindCustomerPickers(root) {
  $$('.ac', root).forEach(async box => {
    const inp = $('.inp', box), hid = $('input[type=hidden]', box), list = $('.ac-list', box);
    const all = await customers();
    if (hid.value && !inp.value) { const c = all.find(x => String(x.id) === String(hid.value)); if (c) inp.value = c.name; }
    let sel = -1, rows = [];
    const draw = () => {
      const q = inp.value.trim().toLowerCase(); const d = q.replace(/\D/g, '');
      rows = all.filter(c => !q || c.name.toLowerCase().includes(q) || (c.company || '').toLowerCase().includes(q) || (c.email || '').toLowerCase().includes(q) || (d.length >= 3 && (c.phone || '').replace(/\D/g, '').includes(d)) || (c.number || '').toLowerCase().includes(q)).slice(0, 12);
      list.innerHTML = rows.length ? rows.map((c, i) => `<div data-i="${i}" class="${i === sel ? 'on' : ''}"><b>${e(c.name)}</b> <span class="s">${e(c.number)}${c.status === 'lead' ? ' · lead' : ''}</span><div class="s">${e([c.phone, c.email, c.locations[0] && c.locations[0].address].filter(Boolean).join(' · '))}</div></div>`).join('') : '<div class="s">No match - create the customer first.</div>';
      list.hidden = false;
    };
    const choose = c => { hid.value = c.id; inp.value = c.name; list.hidden = true; hid.dispatchEvent(new Event('change', { bubbles: true })); };
    inp.addEventListener('focus', draw); inp.addEventListener('input', () => { hid.value = ''; sel = -1; draw(); });
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); sel = Math.max(0, Math.min(rows.length - 1, sel + (ev.key === 'ArrowDown' ? 1 : -1))); draw(); }
      if (ev.key === 'Enter' && rows[Math.max(sel, 0)]) { ev.preventDefault(); choose(rows[Math.max(sel, 0)]); }
      if (ev.key === 'Escape') list.hidden = true;
    });
    list.addEventListener('mousedown', ev => { const d = ev.target.closest('[data-i]'); if (d) { ev.preventDefault(); choose(rows[+d.dataset.i]); } });
    inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  });
}

// ---------------- table helper ----------------
function table(rows, cols, opts = {}) {
  if (!rows.length) return `<div class="empty">${icon(opts.emptyIcon || 'list')}${e(opts.empty || 'Nothing here yet.')}</div>`;
  const head = cols.map(c => { const sorted = opts.sortKey && c.sort === opts.sortKey; return `<th class="${c.num ? 'num' : ''} ${c.sort ? 'sort' : ''} ${c.hideM ? 'hide-m' : ''}" ${c.sort ? `data-sort="${c.sort}"` : ''} ${c.width ? `style="width:${c.width}"` : ''}>${c.label}${sorted ? `<span class="arr">${opts.sortDir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`; }).join('');
  const body = rows.map((r, i) => `<tr class="${opts.onRow ? 'click' : ''}" data-i="${i}">${cols.map(c => `<td class="${c.num ? 'num' : ''} ${c.cls || ''} ${c.hideM ? 'hide-m' : ''}">${c.render ? c.render(r) : e(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('');
  return `<div class="tbl-wrap"><table class="tbl ${opts.compact ? 'compact' : ''}"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${opts.foot || ''}</table></div>`;
}
function bindTable(el, rows, opts = {}) {
  if (!el) return;
  $$('tbody tr', el).forEach(tr => tr.addEventListener('click', ev => { if (ev.target.closest('input,button,a,select')) return; if (opts.onRow) opts.onRow(rows[+tr.dataset.i], ev); }));
  $$('th[data-sort]', el).forEach(th => th.onclick = () => opts.onSort && opts.onSort(th.dataset.sort));
}
function sortRows(rows, key, dir) {
  const m = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => { const x = a[key], y = b[key]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * m; });
}

// ---------------- charts (SVG, theme-aware) ----------------
function niceMax(v) { if (v <= 0) return 4; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10) * p; }
function yTicks(max) { const m = max / Math.pow(10, Math.floor(Math.log10(max))); const n = (m === 5 || m === 1) ? 5 : 4; const t = []; for (let i = 0; i <= n; i++) t.push(max * i / n); return t; }
const tipRow = (c, l, v) => `<div><span class="sw" style="background:${c}"></span>${e(l)}: <b>${v}</b></div>`;
function roundedTop(x, y, w, h, r = 4) { if (h <= 0) return ''; r = Math.min(r, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
const kfmt = v => v >= 1000 ? '$' + fmt.num(v / 1000, 1) + 'k' : '$' + fmt.num(v);
function groupedBars(data, series, { height = 220, w = 640, fmtV = v => fmt.num(v), fmtAxis = v => fmt.num(v) } = {}) {
  const C = CH(); const W = w, H = height, L = 44, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...data.flatMap(d => d.values)));
  const cw = (W - L - R) / data.length, gap = 2, bw = Math.min(18, (cw * 0.7 - gap * (series.length - 1)) / series.length);
  const y = v => T + (H - T - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of yTicks(max)) s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? C.grid : C.axis}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10.5" fill="${C.muted}">${fmtAxis(t)}</text>`;
  data.forEach((d, i) => {
    const gx = L + i * cw + (cw - (bw * series.length + gap * (series.length - 1))) / 2;
    const tipHtml = `<b>${e(d.tip || d.label)}</b>` + series.map((sr, j) => tipRow(sr.color, sr.name, fmtV(d.values[j]))).join('');
    s += `<rect x="${L + i * cw}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent" data-tip="${e(tipHtml)}"/>`;
    d.values.forEach((v, j) => { const x = gx + j * (bw + gap); s += `<path d="${roundedTop(x, y(v), bw, y(0) - y(v))}" fill="${series[j].color}" pointer-events="none"/>`; });
    if (data.length <= 12 || i % 2 === 0) s += `<text x="${L + i * cw + cw / 2}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${C.muted}">${e(d.label)}</text>`;
  });
  return legend(series) + `<div class="chart">${s}</svg></div>`;
}
function lineChart(data, series, { height = 200, w = 640, yMax, fmtV = v => fmt.num(v, 1), fmtAxis = v => fmt.num(v), suffix = '' } = {}) {
  const C = CH(); const W = w, H = height, L = 44, R = 14, T = 12, B = 26;
  const vals = data.flatMap(d => d.values).filter(v => v != null);
  const max = yMax || niceMax(Math.max(1, ...vals));
  const n = data.length; const x = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1)); const y = v => T + (H - T - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (const t of yTicks(max)) s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t ? C.grid : C.axis}"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10.5" fill="${C.muted}">${fmtAxis(t)}${suffix}</text>`;
  series.forEach((sr, j) => {
    let d = ''; data.forEach((p, i) => { const v = p.values[j]; if (v == null) return; d += (d ? 'L' : 'M') + x(i) + ',' + y(v); });
    s += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    data.forEach((p, i) => { const v = p.values[j]; if (v != null) s += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="${sr.color}" stroke="${C.card}" stroke-width="2"/>`; });
  });
  data.forEach((p, i) => {
    const step = n > 1 ? (W - L - R) / (n - 1) : W - L - R;
    const tipHtml = `<b>${e(p.tip || p.label)}</b>` + series.map((sr, j) => tipRow(sr.color, sr.name, p.values[j] == null ? '—' : fmtV(p.values[j]) + suffix)).join('');
    s += `<rect x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}" fill="transparent" data-tip="${e(tipHtml)}"/>`;
    s += `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${C.muted}">${e(p.label)}</text>`;
  });
  return (series.length > 1 ? legend(series, true) : '') + `<div class="chart">${s}</svg></div>`;
}
function legend(series, line) { return `<div class="legend">${series.map(s => `<span><i class="${line ? 'line' : ''}" style="background:${s.color}"></i>${e(s.name)}</span>`).join('')}</div>`; }
function hBars(rows, { color, fmtV = v => fmt.num(v) } = {}) {
  if (!rows.length) return `<div class="empty">No data yet.</div>`;
  const max = Math.max(...rows.map(r => r.n), 1); const c = color || CH().s1;
  return `<div class="hbars">${rows.map(r => `<div class="row ${r.href ? 'click' : ''}" ${r.href ? `data-href="${r.href}"` : ''} data-tip="${e(`<b>${e(r.label)}</b><div>${fmtV(r.n)}${r.tip ? ' · ' + e(r.tip) : ''}</div>`)}">
    <div class="lab">${e(r.label)}</div><div class="track"><div class="fill" style="width:${(100 * r.n / max).toFixed(1)}%;background:${r.color || c}"></div></div><div class="n">${fmtV(r.n)}</div></div>`).join('')}</div>`;
}

// ---------------- photos & files ----------------
function resizeImage(file, max = 1600, quality = 0.82) {
  return new Promise(resolve => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 1.5e6) { URL.revokeObjectURL(url); return resolve(file); }
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(url); resolve(b ? new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file); }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function upload(entityType, entityId, file, { kind = '', caption = '' } = {}) {
  const f = await resizeImage(file);
  return api(`/api/attachments${qs({ entity_type: entityType, entity_id: entityId, filename: f.name || 'photo.jpg', kind, caption })}`, { method: 'POST', raw: { headers: { 'Content-Type': f.type || 'application/octet-stream' }, body: f } });
}
function photoGrid(list) {
  if (!list.length) return '<div class="empty" style="padding:14px">No photos or files yet.</div>';
  return `<div class="photos">${list.map(a => `<a href="/api/attachments/${a.id}/file" target="_blank" rel="noopener" title="${e(a.filename)}">${a.mime.startsWith('image/') ? `<img src="/api/attachments/${a.id}/file" alt="${e(a.caption || a.filename)}" loading="lazy">` : `<div class="file">${icon('clip')}<br>${e(a.filename)}</div>`}${a.kind === 'signature' ? '<span class="cap">Signature</span>' : a.caption ? `<span class="cap">${e(a.caption)}</span>` : ''}</a>`).join('')}</div>`;
}
function getPos(timeout = 7000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(p => resolve({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }), () => resolve({}), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
  });
}

// ---------------- activity timeline ----------------
function timeline(rows, { showRef = false } = {}) {
  if (!rows.length) return '<div class="empty" style="padding:14px">No activity yet.</div>';
  const KIND_ICON = { status: 'refresh', email: 'mail', call: 'phone', sms: 'sms', meeting: 'users', system: 'clock' };
  return `<ul class="timeline">${rows.map(a => {
    const person = !['system', 'status'].includes(a.kind) || /\(AI\)/.test(a.author);
    const ai = /\(AI\)/.test(a.author);
    return `<li class="k-${e(a.kind)}"><div class="av ${ai ? 'ai' : person && a.kind === 'note' ? '' : 'sys'}">${a.kind === 'note' ? e(initials(a.author)) : icon(KIND_ICON[a.kind] || 'clock')}</div>
      <div style="min-width:0;flex:1"><div><span class="who">${e(a.author)}</span>${a.kind !== 'note' && a.kind !== 'system' && a.kind !== 'status' ? ` <span class="tag">${e(a.kind)}</span>` : ''}${showRef && a.ref ? ` <span class="tag">${e(a.ref)}</span>` : ''}<span class="when">${fmt.dt(a.created_at)}</span></div><div class="body">${e(a.body)}</div></div></li>`;
  }).join('')}</ul>`;
}
async function noteDialog(entity_type, entity_id, after) {
  const r = await formModal({ title: 'Add note', size: 'narrow', fields: [{ name: 'kind', label: 'Type', type: 'select', options: [['note', 'Note'], ['call', 'Phone call'], ['meeting', 'Meeting'], ['email', 'Email (summary)'], ['sms', 'Text message']], value: 'note', full: 1 }, { name: 'body', label: 'Note', type: 'textarea', rows: 4, full: 1, required: 1 }],
    okLabel: 'Add note', save: v => POST('/api/notes', { entity_type, entity_id, ...v }) });
  if (r) { toast('Note added'); after ? after() : rerender(); }
}

// ---------------- auth screens ----------------
const LOGO = (size = 38) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><rect class="logo-bg" width="32" height="32" rx="7"/><path class="logo-stroke" d="M9 23V9l14 14V9" stroke-width="3.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function showAuth(needsSetup = false) {
  $('#shell').hidden = true; const a = $('#auth'); a.hidden = false; $('#modalRoot').innerHTML = '';
  if (needsSetup) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    a.innerHTML = `<div class="login"><div class="card"><div class="hero">${LOGO()}<div><h1>Set up NurzWorks HQ</h1><p>Create the owner account. You only do this once.</p></div></div>
      <form id="authForm" onsubmit="return false">
        <div class="field"><label>Setup code</label><input name="setup_code" placeholder="XXXX-XXXX" autocomplete="off" required><div class="hint">Printed in the window where the server is running.</div></div>
        <div class="field"><label>Business name</label><input name="company_name" value="NurzWorks"></div>
        <div class="field"><label>Your name</label><input name="name" autocomplete="name" required></div>
        <div class="field"><label>Email (your sign-in)</label><input name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label>Password</label><input name="password" type="password" autocomplete="new-password" minlength="8" required><div class="hint">At least 8 characters.</div></div>
        <div class="field"><label>Time zone</label><input name="timezone" value="${e(tz)}"></div>
        <div id="authErr"></div><button class="btn primary lg block" id="authGo">Create owner account</button></form></div></div>`;
  } else {
    a.innerHTML = `<div class="login"><div class="card"><div class="hero">${LOGO()}<div><h1>NurzWorks HQ</h1><p>Sign in to run the business.</p></div></div>
      <form id="authForm" onsubmit="return false">
        <div class="field"><label>Email</label><input name="email" type="email" autocomplete="username" required></div>
        <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div id="authErr"></div><button class="btn primary lg block" id="authGo">Sign in</button>
        <div class="muted small" style="text-align:center">Forgot your password? Ask an admin, or run <span class="kbd">node server.js reset-password you@email</span>.</div></form></div></div>`;
  }
  const go = async () => {
    const vals = readForm($('#authForm')); $('#authErr').innerHTML = ''; $('#authGo').disabled = true;
    try { await POST(needsSetup ? '/api/setup' : '/api/login', vals); a.hidden = true; a.innerHTML = ''; await start(); }
    catch (err) { $('#authErr').innerHTML = `<div class="err">${e(err.message)}</div>`; $('#authGo').disabled = false; }
  };
  $('#authGo').onclick = go;
  setTimeout(() => { const f = $('#authForm input'); if (f) f.focus(); }, 50);
}

// ---------------- chrome: nav, menus, search, timer ----------------
const NAV = [
  ['Operations', [['dashboard', 'Dashboard', 'dash'], ['schedule', 'Schedule', 'cal'], ['myday', 'My Day', 'today'], ['jobs', 'Jobs', 'wo', 'unscheduled', 'warn'], ['requests', 'Requests', 'inbox', 'requests'], ['plans', 'Service Plans', 'repeat', null, null, 'office']]],
  ['Sales & Billing', [['customers', 'Customers', 'users'], ['estimates', 'Estimates', 'est', null, null, 'books'], ['invoices', 'Invoices', 'inv', 'overdue_invoices', null, 'books'], ['pricebook', 'Price Book', 'book', null, null, 'office']]],
  ['Office', [['inbox', 'Inbox', 'mail', 'unread_email', 'soft', 'office'], ['tasks', 'Tasks', 'task', 'my_tasks', 'soft'], ['time', 'Time & Expenses', 'clock'], ['reports', 'Reports', 'chart', null, null, 'books']]],
  ['Admin', [['team', 'Team & AI Staff', 'ai', null, null, 'admin'], ['integrations', 'Integrations', 'plug', null, null, 'admin'], ['settings', 'Settings', 'gear', null, null, 'admin']]]
];
const FIELD_HIDE = new Set(['requests', 'plans', 'pricebook']);
function navItems() {
  const field = S.me.role === 'field';
  return NAV.map(([g, items]) => [g, items.filter(([k, , , , , perm]) => (!perm || can(perm)) && !(field && FIELD_HIDE.has(k)))]).filter(([, items]) => items.length);
}
function renderChrome() {
  const m = S.meta; S.me = m.me;
  $('#brandName').textContent = m.company.name || 'NurzWorks';
  document.title = `${m.company.name || 'NurzWorks'} HQ`;
  const cur = currentRoute().name;
  $('#nav').innerHTML = navItems().map(([g, items]) => `<div class="nav-group">${g}</div>` + items.map(([k, l, ic, b, bcls]) => {
    const n = b ? m.badges[b] : 0;
    return `<a href="#/${k}" class="${cur === k ? 'active' : ''}">${icon(ic)}<span>${l}</span>${n ? `<span class="badge ${bcls || ''}">${n}</span>` : ''}</a>`;
  }).join('')).join('');
  $('#sideFoot').innerHTML = `<a href="/request" target="_blank" rel="noopener">${icon('ext')} Customer request page</a>${m.settings.cmms_url ? `<br><a href="${e(m.settings.cmms_url)}" target="_blank" rel="noopener">${icon('ext')} NurzWorks CMMS</a>` : ''}<br>v${e(m.version)}`;
  const field = S.me.role === 'field';
  const bn = [['myday', 'My Day', 'today'], ['schedule', 'Schedule', 'cal'], ['jobs', 'Jobs', 'wo'], [field ? 'tasks' : 'customers', field ? 'Tasks' : 'Customers', field ? 'task' : 'users'], ['__more', 'More', 'menu']];
  $('#bottomNav').innerHTML = bn.map(([k, l, ic]) => `<a href="${k === '__more' ? '#' : '#/' + k}" data-k="${k}" class="${cur === k ? 'active' : ''}">${icon(ic)}${l}</a>`).join('');
  const u = S.me; const ub = $('#userBtn'); ub.textContent = initials(u.name); ub.style.background = u.color || 'var(--primary)';
  $('#newBtn').innerHTML = icon('plus') + '<span class="hide-m">New</span>';
  renderTimer();
}
function newMenuItems() {
  const items = [];
  if (can('office')) items.push(['job', 'Job', 'wo'], ['customer', 'Customer', 'users'], ['estimate', 'Estimate', 'est'], ['invoice', 'Invoice', 'inv'], ['request', 'Request / lead', 'inbox']);
  if (can('write')) items.push(['task', 'Task', 'task'], ['time', 'Time entry', 'clock'], ['expense', 'Expense / mileage', 'dollar']);
  return items;
}
$('#newBtn').onclick = ev => {
  ev.stopPropagation(); const menu = $('#newMenu'); $('#userMenu').hidden = true;
  menu.innerHTML = newMenuItems().map(([k, l, ic]) => `<button data-new="${k}">${icon(ic)}${l}</button>`).join('');
  menu.hidden = !menu.hidden;
};
$('#newMenu').onclick = ev => {
  const b = ev.target.closest('[data-new]'); if (!b) return; $('#newMenu').hidden = true;
  const k = b.dataset.new;
  ({ job: () => jobForm(), customer: () => customerForm(), estimate: () => estimateEditor(), invoice: () => invoiceEditor(), request: () => requestForm(), task: () => taskForm(), time: () => timeForm(), expense: () => expenseForm() })[k]();
};
$('#userBtn').onclick = ev => {
  ev.stopPropagation(); $('#newMenu').hidden = true; const menu = $('#userMenu'); const t = document.documentElement.dataset.theme;
  menu.innerHTML = `<div class="hd">${e(S.me.name)} · ${e(cap(S.me.role))}</div><button data-um="profile">${icon('user')}My profile</button><div class="sep"></div><div class="hd">Theme</div>
    ${THEMES.map(([k, l, ic]) => `<button data-theme-pick="${k}" class="${t === k ? 'on' : ''}">${icon(ic)}${l}${t === k ? ' ✓' : ''}</button>`).join('')}<div class="sep"></div><button data-um="logout">${icon('logout')}Sign out</button>`;
  menu.hidden = !menu.hidden;
};
$('#userMenu').onclick = async ev => {
  const tp = ev.target.closest('[data-theme-pick]'); if (tp) { $('#userMenu').hidden = true; applyTheme(tp.dataset.themePick); return; }
  const b = ev.target.closest('[data-um]'); if (!b) return; $('#userMenu').hidden = true;
  if (b.dataset.um === 'logout') { await POST('/api/logout').catch(() => {}); S.meta = null; S.me = null; showAuth(); }
  if (b.dataset.um === 'profile') profileForm();
};
document.addEventListener('click', ev => {
  if (!ev.target.closest('.drop')) { $('#newMenu').hidden = true; $('#userMenu').hidden = true; }
  const h = ev.target.closest('[data-href]');
  if (h && !ev.target.closest('a,button,input,select,textarea,label')) { location.hash = h.dataset.href; }
  const bn = ev.target.closest('#bottomNav a[data-k="__more"]'); if (bn) { ev.preventDefault(); $('#shell').classList.toggle('nav-open'); }
});
$('#menuBtn').innerHTML = icon('menu');
$('#menuBtn').onclick = () => $('#shell').classList.toggle('nav-open');
$('#searchIco').innerHTML = icon('search');
(() => {
  const inp = $('#globalSearch'), box = $('#searchResults'); let tmr, sel = -1;
  const KIND = { customer: ['Customer', '#/customers/'], job: ['Job', '#/jobs/'], estimate: ['Estimate', '#/estimates/'], invoice: ['Invoice', '#/invoices/'], request: ['Request', '#/requests/'], task: ['Task', '#/tasks?id='] };
  inp.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(async () => {
    const q = inp.value.trim(); if (q.length < 2) { box.hidden = true; return; }
    const r = await api('/api/search?q=' + encodeURIComponent(q)).catch(() => []); sel = -1;
    box.innerHTML = r.length ? r.map(x => `<a href="${KIND[x.kind][1]}${x.id}"><span class="kind">${KIND[x.kind][0]}</span><b>${e(x.code === 'TASK' ? '' : x.code)}</b><span class="ellipsis">${e(x.label)}</span><span class="sub">${e(x.sub || '')}</span></a>`).join('') : '<div class="empty">No matches</div>';
    box.hidden = false;
  }, 180); });
  inp.addEventListener('keydown', ev => {
    const links = $$('a', box); if (!links.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); sel = (sel + (ev.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((l, i) => l.classList.toggle('on', i === sel)); }
    if (ev.key === 'Enter') (links[sel] || links[0]).click();
    if (ev.key === 'Escape') box.hidden = true;
  });
  box.addEventListener('click', () => { box.hidden = true; inp.value = ''; });
  document.addEventListener('click', ev => { if (!ev.target.closest('.search-wrap')) box.hidden = true; });
  document.addEventListener('keydown', ev => { if (ev.key === '/' && !ev.target.closest('input,textarea,select') && !$('.modal-bg')) { ev.preventDefault(); inp.focus(); } });
})();

// running timer pill
async function loadTimer() { if (!S.me || S.me.kind !== 'human') return; const r = await api('/api/time/running?user_id=me').catch(() => []); S.timer = r[0] || null; renderTimer(); }
function renderTimer() {
  clearInterval(S.timerTick); const slot = $('#timerSlot');
  if (!S.timer) { slot.innerHTML = ''; return; }
  const draw = () => { slot.innerHTML = `<span class="timer-pill" title="${e(S.timer.job_number ? S.timer.job_number + ' ' + S.timer.job_title : 'On the clock')}"><span class="dot"></span>${fmt.dur(Date.now() - new Date(S.timer.started_at))}<span class="hide-m">${S.timer.job_number ? ' · ' + e(S.timer.job_number) : ''}</span><button id="timerStop">Stop</button></span>`;
    $('#timerStop').onclick = async () => { const pos = await getPos(3000); await POST('/api/time/stop', { id: S.timer.id, ...pos }); toast(`Clocked out`); S.timer = null; renderTimer(); rerender(); }; };
  draw(); S.timerTick = setInterval(draw, 30000);
}

// ---------------- router ----------------
const VIEWS = {};
function currentRoute() {
  const h = location.hash.slice(1) || '/dashboard';
  const [p, q] = h.split('?'); const parts2 = p.split('/').filter(Boolean);
  return { name: parts2[0] || 'dashboard', id: parts2[1], sub: parts2[2], q: Object.fromEntries(new URLSearchParams(q || '')) };
}
async function router() {
  if (!S.meta) return;
  const r = currentRoute(); const view = $('#view');
  $('#shell').classList.remove('nav-open'); hideTip();
  $$('#nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + r.name));
  $$('#bottomNav a').forEach(a => a.classList.toggle('active', a.dataset.k === r.name));
  let name = r.name;
  if (S.me.role === 'field' && name === 'dashboard') name = 'myday';
  const fn = VIEWS[name] || VIEWS.dashboard;
  const key = name + (r.id || '');
  if (view.dataset.view !== key) { view.innerHTML = `<div class="loading">Loading…</div>`; window.scrollTo(0, 0); }
  view.dataset.view = key;
  try { await fn(view, r); } catch (err) { console.error(err); view.innerHTML = `<div class="card card-b"><div class="err">${e(err.message)}</div><a href="#/dashboard">Back to dashboard</a></div>`; }
}
async function loadMeta() { S.meta = await api('/api/meta'); S.me = S.meta.me; renderChrome(); }
async function refresh() { await loadMeta(); await router(); }
async function rerender() { const m = api('/api/meta').then(x => { S.meta = x; renderChrome(); }).catch(() => {}); await router(); await m; }
window.addEventListener('hashchange', router);
async function start() {
  await loadMeta();
  const saved = (() => { try { return localStorage.getItem('nw_theme'); } catch (_) { return null; } })();
  const t = S.me.theme || saved || S.meta.theme_default || 'nurzworks';
  if (t !== document.documentElement.dataset.theme) applyTheme(t, false);
  $('#auth').hidden = true; $('#shell').hidden = false;
  await router(); loadTimer();
  setInterval(() => { if (!document.hidden && S.meta) api('/api/meta').then(x => { S.meta = x; renderChrome(); }).catch(() => {}); }, 120000);
}
async function boot() {
  try {
    const s = await fetch('/api/session').then(r => r.json().then(d => ({ ok: r.ok, d })));
    if (s.d.needs_setup) return showAuth(true);
    if (!s.ok || !s.d.signed_in) return showAuth(false);
    await start();
  } catch (err) { document.body.innerHTML = `<div class="login"><div class="card card-b"><div class="err">Could not reach NurzWorks HQ: ${e(err.message)}. Make sure the server is running.</div></div></div>`; }
}
if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') { navigator.serviceWorker && navigator.serviceWorker.register('/sw.js').catch(() => {}); }
