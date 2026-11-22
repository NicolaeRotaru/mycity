import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { rateLimitAsync } from '@/lib/rate-limit';

/**
 * R03-010 — UN FRENO SOLO PER TUTTE LE STRADE CHE CHIAMANO NOMINATIM.
 *
 * La politica d'uso del servizio pubblico delle mappe chiede al massimo una richiesta al secondo
 * per tutto il sito. Il freno per indirizzo IP della rotta non lo garantiva (ogni persona ne ha
 * uno suo) e la rotta d'ordine non ne aveva. Ora tutte e due passano da qui: un turno al secondo
 * con un contatore unico (condiviso tra le copie se Upstash è acceso, della copia sola se no).
 * Chi non trova il turno entro l'attesa massima non chiama: la rotta risponde «occupato».
 */
const CHIAVE_DEL_FRENO = 'nominatim:globale';
const ATTESA_MASSIMA_MS = 8_000;

async function aspettaIlTurno(): Promise<boolean> {
  const limite = Date.now() + ATTESA_MASSIMA_MS;
  for (;;) {
    const rl = await rateLimitAsync({ key: CHIAVE_DEL_FRENO, max: 1, windowMs: 1_000 });
    if (rl.allowed) return true;
    const attesa = Math.max(250, rl.retryAfterSec * 1_000);
    if (Date.now() + attesa > limite) return false;
    await new Promise((r) => setTimeout(r, attesa));
  }
}

/**
 * La ricerca di un testo su Nominatim, col freno. `occupato` = non si è trovato il turno (non si
 * è chiamato); `senza_posizione` = il servizio non ha risposto o non conosce l'indirizzo.
 */
async function cercaSuNominatim(q: string): Promise<
  { esito: 'trovato'; lat: number; lng: number } | { esito: 'occupato' } | { esito: 'senza_posizione' }
> {
  if (!(await aspettaIlTurno())) return { esito: 'occupato' };
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=it`;
    const res = await fetch(url, {
      headers: {
        // Nominatim Usage Policy: User-Agent identificativo obbligatorio.
        'User-Agent': `MyCity/1.0 (${env.appUrl()})`,
        'Accept-Language': 'it',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return { esito: 'senza_posizione' };
    const json = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const primo = Array.isArray(json) ? json[0] : undefined;
    const lat = primo?.lat != null ? parseFloat(primo.lat) : NaN;
    const lng = primo?.lon != null ? parseFloat(primo.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { esito: 'senza_posizione' };
    return { esito: 'trovato', lat, lng };
  } catch {
    logger.warn('[geocodifica] Nominatim non raggiungibile', { qlen: q.length });
    return { esito: 'senza_posizione' };
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
async function risolvi(
  q: string,
  opzioni?: { seOccupato?: 'lancia' },
): Promise<{ lat: number; lng: number } | null> {
  if (q.length < 3) return null;

  const r = await cercaSuNominatim(q);
  if (r.esito === 'occupato' && opzioni?.seOccupato === 'lancia') throw new Error('nominatim_occupato');
  if (r.esito !== 'trovato') {
    // Un indirizzo che non si trova non è un ordine da bloccare: si prosegue
    // senza la mappa, come si faceva prima.
    logger.warn('[geocodifica] indirizzo non risolto', { lunghezza: q.length, esito: r.esito });
    return null;
  }
  return { lat: r.lat, lng: r.lng };
}

export async function coordinateDiUnIndirizzo(
  indirizzo: { address: string; city: string; zip: string } | { testo: string },
  // R03-010 — La rotta della ricerca indirizzi vuole saper distinguere «occupato» da «non trovato»:
  // con `lancia`, se il turno non arriva entro l'attesa massima lancia `nominatim_occupato`.
  opzioni?: { seOccupato?: 'lancia' },
): Promise<{ lat: number; lng: number } | null> {
  if ('testo' in indirizzo) return risolvi(indirizzo.testo.trim().slice(0, 300), opzioni);
  const q = `${indirizzo.address}, ${indirizzo.zip} ${indirizzo.city}, Italia`.trim().slice(0, 300);
  return risolvi(q, opzioni);
}
