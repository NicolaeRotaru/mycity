import { NextResponse } from 'next/server';
import { rateLimitAsync, getClientIp } from '@/lib/rate-limit';
import { cercaUnIndirizzo } from '@/lib/geocodifica';
import { logger } from '@/lib/logger';
import { jsonRichiesta, TETTO_JSON } from '@/lib/api/corpo';

export const runtime = 'nodejs';

/**
 * Proxy server-side per il geocoding Nominatim (audit 🟠-15).
 *
 * Prima il geocoding veniva chiamato DAL BROWSER su nominatim.openstreetmap.org:
 *  - viola la Usage Policy Nominatim (richiede un User-Agent identificativo e
 *    vieta l'uso pesante; dal browser l'UA non è impostabile e gli IP sono
 *    eterogenei → rischio ban);
 *  - nessun rate-limit né timeout né fallback.
 * Qui centralizziamo: User-Agent corretto, timeout, rate-limit per IP, e una
 * risposta minimale { lat, lng }. «Nessun risultato» è 200 con { lat: null, lng: null };
 * se invece Nominatim è giù o lento (5xx, rete, tempo scaduto) rispondiamo 503 (429 se è Nominatim
 * a dire «troppe richieste») con { lat: null, lng: null, error: 'servizio_non_disponibile' }: i chiamanti che leggono solo
 * lat/lng proseguono senza coord come prima, chi lo vuole può dire «riprova fra poco».
 */
const SERVIZIO_NON_DISPONIBILE = { lat: null, lng: null, error: 'servizio_non_disponibile' };

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const rl = await rateLimitAsync({ key: `geocode:${ip}`, max: 30, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ lat: null, lng: null, error: 'rate_limited' }, { status: 429 });

  let q = '';
  try {
    const body = (await jsonRichiesta(req, TETTO_JSON)) as { q?: unknown };
    q = typeof body.q === 'string' ? body.q.trim().slice(0, 300) : '';
  } catch {
    return NextResponse.json({ lat: null, lng: null }, { status: 400 });
  }
  if (q.length < 3) return NextResponse.json({ lat: null, lng: null });

  // 26/11/2026 — La ricerca è quella della cassa (lib/geocodifica.ts), non più un testo libero col
  // primo risultato d'Italia: «Via Roma 10, 29121 Piacenza» finiva a Podenzano e la zona diceva
  // «troppo lontano» prima ancora di «Ordina».
  const esito = await cercaUnIndirizzo(q);
  if (esito.esito === 'servizio_giu') {
    if (esito.status != null) logger.warn('[geocode] Nominatim ha risposto con un errore', { status: esito.status });
    else logger.warn('[geocode] Nominatim non raggiungibile', { qlen: q.length });
    // 27/11/2026 — «Troppe richieste» delle mappe resta un 429: la rubrica indirizzi lo legge come
    // «riprova fra poco» e non salva l'indirizzo come «posizione non trovata». L'errore resta quello
    // del servizio, non `rate_limited`, che è il freno di questa rotta (le troppe ricerche di chi cerca).
    return NextResponse.json(SERVIZIO_NON_DISPONIBILE, { status: esito.status === 429 ? 429 : 503 });
  }
  if (esito.esito === 'nessuno') return NextResponse.json({ lat: null, lng: null });
  // 26/11/2026 — Anche il nome del posto trovato: il negozio che cerca «Via Roma 12» legge sotto il
  // campo in quale città è finito, invece di vedere solo un segnaposto su una mappa.
  return NextResponse.json({ lat: esito.lat, lng: esito.lng, ...(esito.nome ? { nome: esito.nome } : {}) });
}
