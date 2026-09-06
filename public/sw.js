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
  // Serve alle notifiche: e' il file che si vede quando arriva un avviso, e
  // l'avviso arriva anche con la rete ballerina.
  '/icon-192.png',
];

// Massimo entries cache. Il taglio e' per ordine di ingresso (FIFO), non LRU:
// leggere una foto non la sposta in fondo alla fila.
//
// 6/9/2026 — 60 ERA UN TETTO CHE NON SERVIVA A NIENTE. Una pagina di ricerca
// arriva a 96 prodotti (il tetto `limit ?? 96` di ProductGrid): la cache si
// riempiva e si svuotava dentro la stessa schermata. 200 = una griglia piena
// piu' due navigazioni.
const MAX_IMAGE_ENTRIES = 200;
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

// Quanto puo' restare vecchia una foto prima di ricontrollarla in rete.
const FRESCHEZZA_IMMAGINI_MS = 24 * 60 * 60 * 1000;

// Quando abbiamo salvato questa copia. L'ora del server (`date`) NON si puo'
// usare: le foto arrivano da un altro dominio, e su una risposta cross-origin il
// browser lascia leggere solo poche intestazioni — `date` non e' fra quelle. Il
// momento del salvataggio ce lo scriviamo noi, prima di mettere via la foto.
const INTESTAZIONE_SALVATA = 'x-mycity-salvata';

// La copia da mettere in cache, con sopra l'ora in cui l'abbiamo presa.
async function conMarcaTemporale(res) {
  const intestazioni = new Headers(res.headers);
  intestazioni.set(INTESTAZIONE_SALVATA, String(Date.now()));
  return new Response(await res.clone().arrayBuffer(), {
    status: res.status,
    statusText: res.statusText,
    headers: intestazioni,
  });
}

// Da quanto tempo abbiamo in mano questa copia? Se non porta la marca (copie
// salvate dalla versione precedente del service worker), la trattiamo come
// vecchia e si ricontrolla: il comportamento di prima.
function eRecente(res, freschezzaMs) {
  const quando = Number(res.headers.get(INTESTAZIONE_SALVATA));
  return Number.isFinite(quando) && quando > 0 && Date.now() - quando < freschezzaMs;
}

// Taglio della cache: cancella le entry entrate per prime (FIFO) quando si
// supera il limite. `cache.keys()` le restituisce in ordine di inserimento.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  if (requests.length <= maxEntries) return;
  const toDelete = requests.slice(0, requests.length - maxEntries);
  await Promise.all(toDelete.map((r) => cache.delete(r)));
}

// Stale-while-revalidate per immagini: serve subito da cache, aggiorna in background.
async function staleWhileRevalidate(req, cacheName, maxEntries, freschezzaMs = 0) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  // 6/9/2026 — OGNI FOTO GIA' VISTA VENIVA RISCARICATA A OGNI APERTURA.
  //
  // Il `fetch` qui sotto partiva sempre, anche con la copia gia' in cache: su
  // una griglia di ricerca sono decine di richieste in sottofondo che rubano
  // banda proprio alle foto nuove che stanno ancora arrivando.
  //
  // Le foto di prodotto hanno indirizzo versionato: finche' la copia e'
  // recente non c'e' niente da ricontrollare. Se non e' recente, o se non si
  // sa quanto e' vecchia, si torna al comportamento di prima.
  if (cached && freschezzaMs > 0 && eRecente(cached, freschezzaMs)) return cached;

  const fetchPromise = fetch(req).then((res) => {
    if (res.ok) {
      // Il salvataggio resta in sottofondo e non puo' rovinare la risposta: se
      // la memoria del telefono e' piena, `cache.put` fallisce e la foto arriva
      // lo stesso. Prima l'errore restava senza padrone; adesso e' raccolto.
      conMarcaTemporale(res)
        .then((copia) => cache.put(req, copia))
        .then(() => trimCache(cacheName, maxEntries))
        .catch(() => {});
    }
    return res;
  }).catch(() =>
    // 22/8/2026 — QUI SI RESTITUIVA `undefined`, E `respondWith(undefined)` LANCIA.
    //
    // Con la rete assente e l'immagine non ancora in cache, `cached` e'
    // `undefined`: il service worker sollevava un'eccezione invece di lasciar
    // fallire la sola immagine, e in alcuni browser questo fa saltare la
    // gestione dell'intera richiesta. Una foto mancante diventava un pezzo di
    // pagina rotto.
    //
    // `Response.error()` e' la risposta giusta: dice «questa non c'e'», il
    // browser mostra l'immagine rotta e basta, e il resto della pagina vive.
    cached ?? Response.error(),
  );
  return cached || fetchPromise;
}

/**
 * 22/8/2026 — LE PAGINE PRIVATE FINIVANO IN CACHE.
 *
 * `networkFirstHtml` metteva in cache OGNI pagina servita con successo, comprese
 * quelle dietro l'accesso: i propri ordini, il profilo, la dashboard del
 * negozio, il pannello di amministrazione.
 *
 * Su un computer condiviso — o dopo un cambio di account sullo stesso browser —
 * quelle pagine tornano fuori dalla cache a chi non le doveva vedere. Non e'
 * una fuga verso internet: e' una fuga verso la persona seduta dopo di te.
 */
const PERCORSI_PRIVATI = ['/orders', '/profile', '/seller', '/rider', '/admin', '/checkout', '/cart'];

function ePrivata(url) {
  return PERCORSI_PRIVATI.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'));
}

// Network-first per HTML: prova rete, fallback offline.
async function networkFirstHtml(req) {
  const url = new URL(req.url);
  const privata = ePrivata(url);
  try {
    const res = await fetch(req);
    if (res.ok && req.url.startsWith(self.location.origin) && !privata) {
      const cache = await caches.open(HTML_CACHE);
      cache.put(req, res.clone());
      trimCache(HTML_CACHE, MAX_HTML_ENTRIES);
    }
    return res;
  } catch {
    // Offline: prova cache HTML, poi offline.html. Sulle pagine private non si
    // guarda nemmeno in cache: non ci deve essere niente, e se c'e' e' roba
    // vecchia di un'altra sessione.
    if (!privata) {
      const cache = await caches.open(HTML_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
    }
    return caches.match(OFFLINE_URL);
  }
}

/**
 * 6/9/2026 — SENZA RETE, CON LA CACHE SVUOTATA, ARRIVAVA LA PAGINA D'ERRORE DEL BROWSER.
 *
 * Il ripiego finale delle pagine e' `caches.match(OFFLINE_URL)` (qui sopra). Se
 * quella copia non c'e' piu' — iOS cancella da solo le cache dei siti dopo 7
 * giorni senza aperture, e il sistema le svuota quando lo spazio scarseggia —
 * `caches.match` restituisce `undefined`, e `respondWith(undefined)` solleva un
 * TypeError: chi ha MyCity sulla schermata Home e la riapre in ascensore vede la
 * schermata d'errore del browser, e sembra che il sito sia morto.
 *
 * E' lo stesso errore corretto il 22/8 per le immagini (`Response.error()`),
 * rimasto sul percorso delle pagine. La correzione qui sta dove si risponde, non
 * dentro un solo ramo: da `respondWith` non passa mai piu' `undefined`. La
 * pagina minima e' scritta dentro il service worker, quindi il sistema non puo'
 * sfrattarla come fa con i file in cache.
 */
const PAGINA_OFFLINE_MINIMA = '<!doctype html><html lang="it"><head><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>Sei offline</title></head>'
  + '<body style="margin:0;padding:3rem 1rem;text-align:center;background:#FBF7F0;color:#1C1A18;'
  + 'font-family:system-ui,-apple-system,Segoe UI,sans-serif">'
  + '<div style="font-size:4rem">&#127760;</div>'
  + '<h1 style="color:#C0492C">Sei offline</h1>'
  + '<p style="color:#57534E">Sembra che la connessione sia caduta. Quando torni online, '
  + 'riproveremo a caricare la pagina.</p>'
  + '<a href="" style="display:inline-block;margin-top:1rem;padding:0.75rem 1.5rem;border-radius:999px;'
  + 'background:#C0492C;color:#fff;text-decoration:none;font-weight:600">Riprova</a>'
  + '</body></html>';

async function rispostaSicura(promessa) {
  let res;
  try {
    res = await promessa;
  } catch {
    res = undefined;
  }
  return res ?? new Response(PAGINA_OFFLINE_MINIMA, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1. HTML navigation
  if (req.mode === 'navigate') {
    event.respondWith(rispostaSicura(networkFirstHtml(req)));
    return;
  }

  // 2. Immagini Supabase storage → stale-while-revalidate
  if (url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/storage/')) {
    event.respondWith(
      staleWhileRevalidate(req, IMAGE_CACHE, MAX_IMAGE_ENTRIES, FRESCHEZZA_IMMAGINI_MS),
    );
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
    // Chrome su Android non disegna gli SVG nelle notifiche: al posto del
    // marchio mostrava l'icona generica del browser. Il PNG e' lo stesso file
    // gia' dichiarato nel manifest, ed e' precaricato qui sopra.
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
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
