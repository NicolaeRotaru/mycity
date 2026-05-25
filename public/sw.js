/*
 * MyCity service worker minimal.
 * Scope: ricezione push + click handler + offline fallback semplice.
 * Non facciamo caching aggressivo (i prodotti cambiano frequentemente);
 * solo le route statiche e l'offline page.
 */

const CACHE = 'mycity-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = ['/offline.html', '/manifest.json', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fetch: solo offline-fallback su navigation HTML (no caching dei dati API)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE_URL))
  );
});

// PUSH: il payload arriva come JSON { title, body, url, icon }
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MyCity', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'MyCity';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.svg',
    badge: '/icon-192.svg',
    data: { url: data.url || '/' },
    vibrate: [50, 30, 50],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se c'è già una finestra MyCity aperta, focus
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
