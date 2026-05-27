/*
 * MyCity service worker.
 *
 * Strategie caching (Workbox-like ma minimal, zero dipendenze):
 *  - Static assets (icone, fonts):  cache-first con fallback network
 *  - Immagini Supabase storage:     stale-while-revalidate (1-day TTL)
 *  - HTML navigation:               network-first con offline fallback
 *  - API + dynamic:                 sempre network (no cache: dati cambiano)
 *
 * Versionamento: increment CACHE_VERSION quando cambia il SW per forzare
 * activate + cleanup vecchie cache.
 */

const CACHE_VERSION = 'v2';
const STATIC_CACHE = `mycity-static-${CACHE_VERSION}`;
const IMAGE_CACHE = `mycity-images-${CACHE_VERSION}`;
const HTML_CACHE = `mycity-html-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline.html';
const PRECACHE = [
  '/offline.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

// Massimo entries cache (LRU manual)
const MAX_IMAGE_ENTRIES = 60;
const MAX_HTML_ENTRIES = 30;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((k) => ![STATIC_CACHE, IMAGE_CACHE, HTML_CACHE].includes(k))
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Trim cache LRU: cancella le entry piu' vecchie quando supera il limite.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  if (requests.length <= maxEntries) return;
  const toDelete = requests.slice(0, requests.length - maxEntries);
  await Promise.all(toDelete.map((r) => cache.delete(r)));
}

// Stale-while-revalidate per immagini: serve subito da cache, aggiorna in background.
async function staleWhileRevalidate(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then((res) => {
    if (res.ok) {
      cache.put(req, res.clone());
      trimCache(cacheName, maxEntries);
    }
    return res;
  }).catch(() => cached); // se rete giu', restituisci la cached anche se vecchia
  return cached || fetchPromise;
}

// Network-first per HTML: prova rete, fallback offline.
async function networkFirstHtml(req) {
  try {
    const res = await fetch(req);
    if (res.ok && req.url.startsWith(self.location.origin)) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(req, res.clone());
      trimCache(HTML_CACHE, MAX_HTML_ENTRIES);
    }
    return res;
  } catch {
    // Offline: prova cache HTML, poi offline.html
    const cache = await caches.open(HTML_CACHE);
    const cached = await cache.match(req);
    if (cached) return cached;
    return caches.match(OFFLINE_URL);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. HTML navigation
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstHtml(req));
    return;
  }

  // 2. Immagini Supabase storage → stale-while-revalidate
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/')) {
    event.respondWith(staleWhileRevalidate(req, IMAGE_CACHE, MAX_IMAGE_ENTRIES));
    return;
  }

  // 3. Static assets nostri (icone, fonts) → cache-first
  if (url.origin === self.location.origin && /\.(svg|png|woff2?|ico)$/i.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }))
    );
    return;
  }

  // 4. Tutto il resto (API, dynamic) → no cache, network-only
});

// PUSH: payload JSON { title, body, url, icon }
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
    tag: data.tag, // sostituisce notifica con stesso tag invece di accumulare
    renotify: data.renotify ?? false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
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

// Skip waiting handler — il PWA banner puo' mandare un message per aggiornare
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
