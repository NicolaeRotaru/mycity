import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { rateLimitAsync } from '@/lib/rate-limit';

/**
 * 19/11/2026 (R04-009) — UN FRENO SOLO PER TUTTO IL SITO SU NOMINATIM.
 *
 * La regola d'uso di Nominatim è circa una chiamata al secondo, per tutta l'applicazione.
 * Qui c'era solo il freno per indirizzo IP della rotta /api/geocode: cento persone con cento
 * IP diversi, più gli ordini, superavano il secondo senza che nulla li fermasse. Il contatore
 * è quello del sito (`rateLimitAsync`: Upstash, condiviso fra le istanze; in memoria solo se
 * Upstash non c'è o non risponde), con una chiave globale. La rotta /api/geocode usa la
 * stessa chiave (stessi numeri) e `coordinateDiUnIndirizzo` la usa qui sotto.
 */
const FRENO_NOMINATIM = { key: 'nominatim:globale', max: 1, windowMs: 1_000 } as const;

/** Quanto, al massimo, il percorso d'ordine aspetta il freno prima di rinunciare alle coordinate. */
const ATTESA_MASSIMA_ORDINE_MS = 300;

/**
 * Il turno per il percorso d'ordine: non fa mai aspettare più di ATTESA_MASSIMA_ORDINE_MS.
 * Una sola ripresa dopo 150 ms; se il turno non arriva (o il contatore non risponde in tempo)
 * si torna al comportamento di sempre quando Nominatim non risponde: niente coordinate.
 */
async function turnoPerOrdine(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scaduto = new Promise<false>((ok) => { timer = setTimeout(() => ok(false), ATTESA_MASSIMA_ORDINE_MS); });
  const tentativi = (async () => {
    for (let i = 0; i < 2; i++) {
      if (i > 0) await new Promise((ok) => setTimeout(ok, 150));
      if ((await rateLimitAsync(FRENO_NOMINATIM)).allowed) return true;
    }
    return false;
  })().catch(() => false);
  try {
    return await Promise.race([tentativi, scaduto]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Trovare le coordinate di un indirizzo, dal server.
 *
 * 22/8/2026 — PERCHE' ESISTE QUESTO FILE.
 *
 * Il browser, al checkout, geolocalizzava l'indirizzo scritto a mano e mandava
 * le coordinate al server. Il server le buttava — giustamente: il prezzo della
 * consegna dipende dalla distanza, e un numero che arriva dal browser è un
 * numero che si può cambiare. Solo che poi non le calcolava nemmeno lui:
 * l'ordine nasceva senza destinazione, la mappa della consegna restava vuota e
 * il tempo di arrivo non si poteva stimare. Il fattorino andava a naso.
 *
 * Qui il server se le calcola da sé. NON entrano nel prezzo — quello resta
 * deciso dalla consegna (che non dipende dalla distanza): servono a
 * far vedere dove va la spesa e quanto manca.
 *
 * Stessa fonte, stesse regole e stesso timeout della rotta /api/geocode: la
 * logica sta qui una volta sola.
 */
export async function coordinateDiUnIndirizzo(indirizzo: {
  address: string;
  city: string;
  zip: string;
}): Promise<{ lat: number; lng: number } | null> {
  const q = `${indirizzo.address}, ${indirizzo.zip} ${indirizzo.city}, Italia`.trim().slice(0, 300);
  if (q.length < 3) return null;

  try {
    if (!(await turnoPerOrdine())) {
      logger.warn('[geocodifica] freno di Nominatim pieno: ordine senza coordinate');
      return null;
    }
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=it`;
    const res = await fetch(url, {
      headers: {
        // Nominatim Usage Policy: User-Agent identificativo obbligatorio.
        'User-Agent': `MyCity/1.0 (${env.appUrl()})`,
        'Accept-Language': 'it',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const primo = Array.isArray(json) ? json[0] : undefined;
    const lat = primo?.lat != null ? parseFloat(primo.lat) : NaN;
    const lng = primo?.lon != null ? parseFloat(primo.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    // Un indirizzo che non si trova non è un ordine da bloccare: si prosegue
    // senza la mappa, come si faceva prima.
    logger.warn('[geocodifica] indirizzo non risolto', { lunghezza: q.length });
    return null;
  }
}
