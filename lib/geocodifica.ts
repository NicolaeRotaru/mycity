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
 * deciso dalla consegna (che non dipende dalla distanza): servono a
 * far vedere dove va la spesa e quanto manca.
 *
 * Stessa fonte, stesse regole e stesso timeout della rotta /api/geocode: la
 * logica sta qui una volta sola.
 */
/**
 * 12/11/2026 (R03-001) — «VIA ROMA 10, PIACENZA» NON E' PIU' UNA VIA ROMA QUALUNQUE.
 *
 * La ricerca era a testo libero, con un risultato solo e nessun confine: per le vie dal
 * nome comune (Via Roma, Via Cavour, Via Garibaldi…) il primo risultato era una via
 * omonima di un altro comune, a 10-20 km, e la cassa rifiutava l'ordine con «troppo
 * lontano». Ora la ricerca è strutturata (via, città, CAP), chiusa nel riquadro di
 * Piacenza e dintorni, chiede cinque risultati e tiene solo quello del comune scritto
 * (e del CAP scritto, quando OpenStreetMap lo conosce). Se nessuno è affidabile la
 * risposta è null: l'ordine passa senza coordinate, come il codice prevede già, invece
 * di essere fermato con un'accusa sbagliata all'indirizzo del cliente.
 */

/** Piacenza e dintorni: lon min, lat max, lon max, lat min (formato viewbox di Nominatim). */
export const RIQUADRO_PIACENZA = '9.30,45.25,10.05,44.80';

/** Il testo di un comune, per confrontarlo: minuscolo, senza accenti e senza spazi doppi. */
export function nomeDelComune(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    // «Piacenza PC», «Piacenza (PC)»: la sigla della provincia non fa parte del comune.
    .replace(/ pc$/, '');
}

type RisultatoNominatim = {
  lat?: string;
  lon?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    hamlet?: string;
    suburb?: string;
    postcode?: string;
  };
};

/**
 * Il risultato è del comune e del CAP che il cliente ha scritto? Il comune deve
 * combaciare; il CAP si confronta solo se OpenStreetMap lo conosce (molte vie non
 * l'hanno), sulle prime quattro cifre, perché Piacenza città ha più CAP (29121, 29122).
 */
export function risultatoAffidabile(r: RisultatoNominatim, citta: string, cap: string): boolean {
  const voluto = nomeDelComune(citta);
  if (!voluto) return false;
  const a = r.address ?? {};
  const comuni = [a.city, a.town, a.village, a.municipality].map(nomeDelComune).filter(Boolean);
  if (!comuni.includes(voluto)) return false;
  const capScritto = cap.replace(/\D/g, '');
  const capTrovato = (a.postcode ?? '').replace(/\D/g, '');
  // Un CAP che finisce in «00» è quello generico di una città (29100 per Piacenza): vale per
  // tutti i CAP della città, quindi si confrontano solo le prime tre cifre.
  const cifre = capScritto.endsWith('00') ? 3 : 4;
  if (capScritto.length === 5 && capTrovato.length === 5 && capScritto.slice(0, cifre) !== capTrovato.slice(0, cifre)) {
    return false;
  }
  return true;
}

/** L'indirizzo di ricerca strutturata di Nominatim per questo indirizzo. */
export function urlDellaRicerca(indirizzo: { address: string; city: string; zip: string }): string {
  const p = new URLSearchParams({
    street: indirizzo.address.trim().slice(0, 200),
    city: indirizzo.city.trim().slice(0, 100),
    format: 'json',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'it',
    // Il riquadro è una preferenza, non un confine (12/11, collaudo): con bounded=1 un indirizzo
    // fuori zona (Milano, Bobbio) tornava null e l'ordine passava il controllo dei 5 km. Il
    // filtro sul comune scritto (`risultatoAffidabile`) basta a scartare le vie omonime.
    viewbox: RIQUADRO_PIACENZA,
  });
  const cap = indirizzo.zip.trim();
  if (cap) p.set('postalcode', cap.slice(0, 10));
  return `https://nominatim.openstreetmap.org/search?${p.toString()}`;
}

export async function coordinateDiUnIndirizzo(indirizzo: {
  address: string;
  city: string;
  zip: string;
}): Promise<{ lat: number; lng: number } | null> {
  if (indirizzo.address.trim().length < 3 || indirizzo.city.trim().length < 2) return null;

  try {
    const res = await fetch(urlDellaRicerca(indirizzo), {
      headers: {
        // Nominatim Usage Policy: User-Agent identificativo obbligatorio.
        'User-Agent': `MyCity/1.0 (${env.appUrl()})`,
        'Accept-Language': 'it',
      },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as RisultatoNominatim[];
    const risultati = Array.isArray(json) ? json : [];
    for (const r of risultati) {
      if (!risultatoAffidabile(r, indirizzo.city, indirizzo.zip)) continue;
      const lat = r.lat != null ? parseFloat(r.lat) : NaN;
      const lng = r.lon != null ? parseFloat(r.lon) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return null;
  } catch {
    // Un indirizzo che non si trova non è un ordine da bloccare: si prosegue
    // senza la mappa, come si faceva prima.
    logger.warn('[geocodifica] indirizzo non risolto', { lunghezza: indirizzo.address.length });
    return null;
  }
}
