/* To-Do Pro service worker — offline app shell + runtime caching */
const VERSION = 'v14';
const SHELL = `todo-pro-shell-${VERSION}`;
const RUNTIME = `todo-pro-runtime-${VERSION}`;
const CFG = 'tp-cfg'; // survives version bumps: holds the reminder worker URL for notification buttons
const CORE = [
  './', 'index.html', 'style.css', 'script.js', 'quickparse.js', 'habits.js', 'cloud.js', 'auth.js', 'help.html', 'firebase-config.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];
// During local development keep things fresh (network first)
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(CORE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME, CFG].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Never intercept live Firebase / Google auth traffic — the SDK handles its own offline cache
const BYPASS = /(firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com|firebaseinstallations|accounts\.google\.com|apis\.google\.com|\/__\/auth\/)/;
// Cacheable third-party static assets (fonts + Firebase SDK modules)
const STATIC_CDN = /(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.gstatic\.com\/firebasejs)/;

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (BYPASS.test(req.url)) return;

  // Page navigations: network first, fall back to cached shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(DEV ? networkFirst(req, SHELL) : staleWhileRevalidate(req, SHELL));
  } else if (STATIC_CDN.test(req.url)) {
    e.respondWith(staleWhileRevalidate(req, RUNTIME));
  }
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then((cache) =>
    cache.match(req).then((cached) => {
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || net;
    })
  );
}
function networkFirst(req, cacheName) {
  return fetch(req)
    .then((res) => { const copy = res.clone(); caches.open(cacheName).then((c) => c.put(req, copy)); return res; })
    .catch(() => caches.match(req));
}

/* ---------- worker URL (sent by the page) used by the notification buttons ---------- */
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cfg') return;
  e.waitUntil(caches.open(CFG).then((c) => c.put('./cfg', new Response(JSON.stringify({ workerUrl: e.data.workerUrl || '' })))));
});
async function workerUrl() {
  try { const r = await (await caches.open(CFG)).match('./cfg'); return r ? (await r.json()).workerUrl || '' : ''; } catch { return ''; }
}
async function callWorker(d, act, extra = {}) {
  const url = await workerUrl();
  if (!url || !d.sig || !d.uid) return false;
  try {
    const r = await fetch(url.replace(/\/+$/, '') + '/act', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ uid: d.uid, id: d.taskId, sig: d.sig, act, echo: d.echo, tzo: new Date().getTimezoneOffset(), ...extra }) });
    return r.ok;
  } catch { return false; }
}
const fmtTime = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

/* Another device snoozed/finished this task: close its notification here too (and any in-app alarm popup). */
async function dismissLocal(d) {
  const id = d.taskId || 'x';
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  wins.forEach((c) => c.postMessage({ type: 'dismiss', id }));
  if (!wins.some((c) => c.visibilityState === 'visible')) {
    // A push with no visible page must still end in a notification (browser rule): replace the shown one silently, then close it.
    await self.registration.showNotification('Reminder handled', { tag: 'task-' + id, silent: true, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png' });
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const tag of ['task-' + id, 'pre-' + id]) (await self.registration.getNotifications({ tag })).forEach((n) => n.close());
}

/* Background push from the reminder worker (FCM data message) */
self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { /* ignore */ }
  const d = p.data || p;
  const title = d.title || 'Reminder';
  const kind = d.kind || 'main';
  if (kind === 'dismiss') { e.waitUntil(dismissLocal(d)); return; }
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.filter((c) => c.visibilityState === 'visible');
    if (visible.length) { visible.forEach((c) => c.postMessage({ type: 'reminder', data: d })); return; } // app is open: in-app alarm
    const at = d.alarm ? fmtTime(d.alarm) : '';
    const note = d.body || (kind === 'pre' ? 'Get ready.' : 'Time to get this done!');
    if (kind === 'pre') {
      await self.registration.showNotification('⏳ Coming up: ' + title, {
        body: (at ? `At ${at} · ` : '') + note, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png',
        tag: 'pre-' + (d.taskId || 'x'), data: d,
      });
      return;
    }
    await self.registration.showNotification('⏰ ' + title, {
      body: (kind === 'echo' ? 'Still pending · ' : '') + (at ? `Scheduled ${at} · ` : '') + note,
      icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png',
      tag: 'task-' + (d.taskId || 'x'), renotify: true, requireInteraction: true,
      timestamp: d.alarm ? new Date(d.alarm).getTime() : Date.now(),
      vibrate: [400, 200, 400, 200, 800], data: d,
      actions: [{ action: 'snooze', title: 'Snooze 10 min' }, { action: 'done', title: 'Done' }],
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  const d = e.notification.data || {};
  e.notification.close();
  const openApp = (qs = '') => self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { if (qs) c.postMessage({ type: 'act', act: qs.act, id: qs.id }); return c.focus(); }
    return self.clients.openWindow(qs ? `./?do=${qs.act}&id=${encodeURIComponent(qs.id)}` : './');
  });
  if (e.action === 'done' || e.action === 'snooze') {
    e.waitUntil((async () => {
      if (await callWorker(d, e.action, { min: 10 })) {
        if (e.action === 'snooze') { // brief confirmation, auto-dismissed
          await self.registration.showNotification('💤 Snoozed for 10 minutes', { body: d.title || '', tag: 'snooze-' + d.taskId, silent: true, icon: 'icons/icon-192.png', badge: 'icons/favicon-32.png' });
          await new Promise((r) => setTimeout(r, 4000));
          (await self.registration.getNotifications({ tag: 'snooze-' + d.taskId })).forEach((n) => n.close());
        }
        return;
      }
      await openApp({ act: e.action, id: d.taskId }); // no worker URL / offline: let the app do it
    })());
    return;
  }
  e.waitUntil(Promise.all([callWorker(d, 'ack'), openApp()]));
});
// Swiped away = you saw it, so no backup push
self.addEventListener('notificationclose', (e) => { const d = e.notification.data || {}; if (d.taskId && d.sig) e.waitUntil(callWorker(d, 'ack')); });
