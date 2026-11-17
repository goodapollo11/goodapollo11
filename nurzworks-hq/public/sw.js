// Service worker: makes HQ installable and lets the app shell open with no signal.
// Business data is never cached - API calls always go to the server.
const CACHE = 'nw-hq-v1';
const SHELL = ['/', '/app.css', '/public.css', '/theme-boot.js', '/app.js', '/views-ops.js', '/views-sales.js', '/views-office.js', '/views-admin.js', '/manifest.webmanifest', '/icons/icon-192.png'];
self.addEventListener('install', ev => { ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', ev => { ev.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', ev => {
  const req = ev.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (/^\/(api|public|mcp|oauth|integrations|hooks|p)\b/.test(url.pathname) || url.pathname === '/llms.txt') return; // live data only
  if (req.mode === 'navigate') {
    if (url.pathname !== '/') return; // request form & portal pages: always live
    ev.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('/', copy)); } return r; }).catch(() => caches.match('/')));
    return;
  }
  ev.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
