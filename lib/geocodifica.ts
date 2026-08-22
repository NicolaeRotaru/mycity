import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

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
 * come oggi, deciso dagli indirizzi salvati o dalla tariffa fissa: servono a
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
