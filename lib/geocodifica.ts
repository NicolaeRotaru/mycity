import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { AREA_SERVITA, dentroLAreaServita } from '@/lib/ordini/zona-di-consegna';

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

  const esito = await cercaUnIndirizzo(q);
  if (esito.esito === 'trovato') return { lat: esito.lat, lng: esito.lng };
  // Un indirizzo che non si trova non è un ordine da bloccare: si prosegue
  // senza la mappa, come si faceva prima.
  if (esito.esito === 'servizio_giu') logger.warn('[geocodifica] indirizzo non risolto', { lunghezza: q.length });
  return null;
}

/**
 * 26/11/2026 — VIA ROMA A PIACENZA NON È VIA ROMA A PODENZANO.
 *
 * La ricerca era a testo libero (q=«via, CAP città, Italia»), con un risultato solo e
 * nessun confine. Per le vie dal nome comune il primo risultato era una via omonima
 * fuori città: «Via Roma 10, 29121 Piacenza» finiva a Podenzano, a 10 km dal negozio,
 * e il controllo dei 5 km rifiutava l'ordine dicendo al cliente che abitava troppo
 * lontano. Cinque vie del centro su otto, in palestra.
 *
 * Adesso la ricerca è una sola, qui, per la cassa (contanti e carta), per /api/geocode
 * (il controllo della zona prima di «Ordina», la rubrica, il negozio):
 *  ① in forma strutturata (street, city, postalcode, countrycodes=it);
 *  ② prima dentro il riquadro di Piacenza e dintorni (viewbox + bounded=1);
 *  ③ con 5 risultati, scartando quelli con un comune o un CAP diversi da quelli scritti;
 *  ④ se nessun risultato è affidabile la risposta è «nessuno»: l'ordine passa senza
 *     coordinate (e gli amministratori ricevono la campanella per misurare a mano),
 *     invece di essere bloccato con «troppo lontano».
 * Il controllo dei 5 km resta com'è.
 *
 * Fuori dal riquadro si guarda solo se la città scritta è un'altra (Milano), e lì vale
 * solo un risultato di QUEL comune: una consegna a Milano resta fuori zona come prima.
 * Senza città (il negozio che scrive solo la via) non c'è niente da strutturare: resta il
 * testo, ma chiuso nel riquadro.
 */
// Il riquadro è quello dove può stare un negozio (lib/ordini/zona-di-consegna.ts): uno solo.
export const RIQUADRO_DI_PIACENZA = AREA_SERVITA;

export type EsitoDellaRicerca =
  // `nome`: il posto trovato come lo scrivono le mappe («Via Roma, Piacenza, …»), da far leggere a chi cerca.
  | { esito: 'trovato'; lat: number; lng: number; nome: string | null }
  | { esito: 'nessuno' }
  | { esito: 'servizio_giu'; status: number | null };

type RisultatoDelleMappe = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
};

// I nomi del posto in cui cade un risultato: il comune e, per chi scrive la frazione, la frazione.
const NOMI_DEL_POSTO = ['city', 'town', 'village', 'municipality', 'hamlet', 'suburb', 'quarter', 'city_district', 'neighbourhood'];

/**
 * «Piacenza (PC)», «Piacenza PC», «piacenza pc», «Piacenza - PC», «piacenza» → la stessa cosa.
 * 27/11/2026 — La sigla si toglie anche minuscola: «piacenza pc» restava «piacenza pc» e nessun
 * risultato delle mappe aveva quel nome. Vale per le due parti del confronto (`stessoNome`).
 */
function pulisciCitta(citta: string): string {
  return citta
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+\p{L}{2}\.?\s*$/u, ' ')
    .replace(/[\s,;.\-–]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function stessoNome(a: string): string {
  return pulisciCitta(a).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** La frase «via, CAP città, Italia» (quella di sopra, e quella che manda la cassa) nei suoi pezzi. */
function pezziDellaDomanda(q: string): { via: string; citta: string; cap: string; testo: string } {
  // «Piacenza, Italia» scritto nella città: la domanda finisce con due «, Italia». Le altre si tolgono
  // solo dopo una virgola («Corso Italia, Italia» resta «Corso Italia»).
  const testo = q
    .trim()
    .replace(/,?\s*(italia|italy)\s*$/i, '')
    .replace(/(?:\s*,\s*(?:italia|italy))+\s*$/i, '')
    .replace(/[\s,]+$/, '')
    .trim();
  return dividiLaDomanda(testo, testo);
}

function dividiLaDomanda(parte: string, testo: string): { via: string; citta: string; cap: string; testo: string } {
  const virgola = parte.lastIndexOf(',');
  if (virgola >= 0) {
    const prima = parte.slice(0, virgola).trim();
    const coda = parte.slice(virgola + 1).trim();
    // 27/11/2026 — «Piacenza, PC»: la sigla della provincia dopo una virgola non è la città
    // (si cercava la città «PC»). Si guarda la parte prima, se lì c'è una città o un CAP.
    if (/^\(?\s*\p{L}{2}\.?\s*\)?$/u.test(coda)) {
      const senzaSigla = dividiLaDomanda(prima, testo);
      if (senzaSigla.citta || senzaSigla.cap) return senzaSigla;
    }
    const { cap, resto } = capDellaCoda(coda);
    const citta = pulisciCitta(resto);
    // «Via Roma, 12»: la coda è il numero civico, non una città.
    if (cap || /\p{L}/u.test(citta)) return { via: prima, citta, cap, testo };
  }
  return { via: parte, citta: '', cap: '', testo };
}

/**
 * 27/11/2026 — Il CAP come lo scrivono le persone: «29121», «29 121», in testa o in coda alla città
 * («Piacenza 29121»). Prima valeva solo «29121» in testa: il resto finiva dentro il nome della città
 * e nessun risultato tornava. Un CAP di quattro cifre (lo zero iniziale perso, o un errore di
 * battitura) si toglie dal nome ma non filtra: meglio la città sola che un CAP sbagliato.
 */
function capDellaCoda(coda: string): { cap: string; resto: string } {
  const cinque = /(?:^|\s)(\d{2})\s?(\d{3})(?=\s|$)/u;
  const m = coda.match(cinque);
  if (m) return { cap: m[1] + m[2], resto: coda.replace(cinque, ' ').replace(cinque, ' ') };
  return { cap: '', resto: coda.replace(/(?:^|\s)\d{4}(?=\s|$)/u, ' ') };
}

/** Lo stesso comune ha più CAP (Piacenza 29121 e 29122): le prime tre cifre dicono la città. */
function capDellaStessaCitta(a: string, b: string): boolean {
  return a.length === 5 && b.length === 5 && a.slice(0, 3) === b.slice(0, 3);
}

/**
 * ③ Un risultato vale se cade nel comune scritto e ha il CAP scritto. Quando le mappe non dicono il
 * comune: dentro il riquadro si tiene, fuori no (lì il comune scritto è l'unica garanzia).
 */
function affidabile(
  r: RisultatoDelleMappe,
  scritto: { citta: string; cap: string },
  comuneObbligatorio: boolean,
): { lat: number; lng: number; nome: string | null } | null {
  const lat = r.lat != null ? parseFloat(r.lat) : NaN;
  const lng = r.lon != null ? parseFloat(r.lon) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const a = r.address ?? {};
  let comuneVisto = false;
  if (scritto.citta) {
    const nomi = NOMI_DEL_POSTO.map((k) => a[k]).filter((v): v is string => !!v).map(stessoNome);
    if (nomi.length === 0 ? comuneObbligatorio : !nomi.includes(stessoNome(scritto.citta))) return null;
    comuneVisto = nomi.length > 0;
  }
  if (scritto.cap && a.postcode) {
    const cap = a.postcode.split(/[;,]/).map((c) => c.replace(/\D/g, '')).filter(Boolean);
    // 27/11/2026 — Col comune confermato dalle mappe, un altro CAP della stessa città (29122 per una
    // via che le mappe danno 29121) non scarta il risultato. Senza comune il CAP deve essere quello.
    const vale = (c: string) => c === scritto.cap || (comuneVisto && capDellaStessaCitta(c, scritto.cap));
    if (cap.length > 0 && !cap.some(vale)) return null;
  }
  return { lat, lng, nome: typeof r.display_name === 'string' && r.display_name.trim() ? r.display_name.trim() : null };
}

async function chiediAlleMappe(
  parametri: Record<string, string>,
  segnale: AbortSignal,
): Promise<RisultatoDelleMappe[] | { giu: number }> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams(parametri)}`, {
    headers: {
      // Nominatim Usage Policy: User-Agent identificativo obbligatorio.
      'User-Agent': `MyCity/1.0 (${env.appUrl()})`,
      'Accept-Language': 'it',
    },
    signal: segnale,
  });
  if (!res.ok) return { giu: res.status };
  const json = (await res.json()) as unknown;
  return Array.isArray(json) ? (json as RisultatoDelleMappe[]) : [];
}

/** La ricerca, una volta sola: la usano `coordinateDiUnIndirizzo` e la rotta /api/geocode. */
export async function cercaUnIndirizzo(domanda: string): Promise<EsitoDellaRicerca> {
  const { via, citta, cap, testo } = pezziDellaDomanda(domanda.slice(0, 300));
  if (via.length < 3) return { esito: 'nessuno' };
  const scritto = { citta, cap };
  const r = RIQUADRO_DI_PIACENZA;
  const comune = { format: 'json', countrycodes: 'it', addressdetails: '1', limit: '5' };
  const cosa: Record<string, string> = citta
    ? { street: via.replace(/,/g, ' ').replace(/\s+/g, ' ').trim(), city: citta, ...(cap ? { postalcode: cap } : {}) }
    : { q: testo };

  try {
    // Un tempo solo per tutta la ricerca, come prima: la cassa non aspetta più di 5 secondi.
    const segnale = AbortSignal.timeout(5_000);
    const vicino = await chiediAlleMappe(
      { ...cosa, ...comune, viewbox: `${r.ovest},${r.nord},${r.est},${r.sud}`, bounded: '1' },
      segnale,
    );
    if (!Array.isArray(vicino)) return { esito: 'servizio_giu', status: vicino.giu };
    for (const ris of vicino) {
      const p = affidabile(ris, scritto, false);
      if (p && dentroLAreaServita(p.lat, p.lng)) return { esito: 'trovato', ...p };
    }
    if (!citta) return { esito: 'nessuno' };

    const lontano = await chiediAlleMappe({ ...cosa, ...comune }, segnale);
    if (!Array.isArray(lontano)) return { esito: 'servizio_giu', status: lontano.giu };
    for (const ris of lontano) {
      const p = affidabile(ris, scritto, true);
      if (p) return { esito: 'trovato', ...p };
    }
    return { esito: 'nessuno' };
  } catch {
    return { esito: 'servizio_giu', status: null };
  }
}
