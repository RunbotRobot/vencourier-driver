// Vencourier service worker: offline shell + Web Push wake-ups.
const SHELL = 'vencourier-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network-first for the app shell so updates land; API calls are never cached here.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))),
  );
});

// The push carries no payload; ask the API what happened. The token is handed over by the page.
const tokenStore = () => caches.open('vencourier-auth');
self.addEventListener('message', (e) => {
  if (e.data?.type === 'token') e.waitUntil(tokenStore().then((c) => c.put('/token', new Response(e.data.token))));
});

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let notice = null;
    try {
      const t = await (await (await tokenStore()).match('/token'))?.text();
      if (t) notice = await (await fetch('/api/notice', { headers: { authorization: `Bearer ${t}` } })).json();
    } catch { /* fall through to generic */ }
    await self.registration.showNotification(notice?.title ?? 'Vencourier', {
      body: notice?.body ?? 'New activity on a job',
      tag: notice?.jobId ?? 'vencourier',
      renotify: true,
      requireInteraction: true,
      data: { jobId: notice?.jobId },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const jobId = e.notification.data?.jobId;
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = jobId ? `/#/job/${encodeURIComponent(jobId)}` : '/';
    if (all[0]) { await all[0].focus(); all[0].postMessage({ type: 'open', hash: target }); }
    else await clients.openWindow(target);
  })());
});
