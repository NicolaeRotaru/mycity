/**
 * GLI INDIRIZZI CHE SI POSSONO SALVARE PER L'ANALISI — 24/11/2026.
 *
 * Nicola: «ci deve essere un luogo dove l'imprenditore deve inserire l'id dei social e google e
 * quello che serve per analizzare anche il sito». Il sito del negozio lo manda il nostro server a
 * Google PageSpeed, e i canali li legge n8n: un indirizzo interno («localhost», «192.168.1.1»,
 * «intranet.local») non è il sito di un negozio, e mandarlo in giro vorrebbe dire far bussare
 * qualcuno a porte che non sono pubbliche. Quindi si salva solo:
 *  · un indirizzo https con un nome di dominio vero (lettere, un punto, un suffisso di lettere);
 *  · niente numeri IP, niente porte, niente nome e password dentro l'indirizzo;
 *  · niente suffissi riservati alle reti di casa o di prova (.local, .lan, .internal, .test…).
 * «www.iltuonegozio.it» si accetta e diventa «https://www.iltuonegozio.it/».
 * «http://…» no: chiediamo l'indirizzo sicuro, quello che Google mostra.
 */

const SUFFISSI_NON_PUBBLICI = /\.(?:local|localhost|localdomain|lan|home|internal|intranet|corp|svc|test|example|invalid|onion|arpa)$/i;
const LUNGHEZZA_MASSIMA = 300;

function urlDi(v: string): URL | null {
  const t = v.trim();
  if (!t || t.length > LUNGHEZZA_MASSIMA || /\s/.test(t)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^https:\/\//i.test(t)) return null; // http:, javascript:, ftp:…
  try {
    return new URL(/^https:\/\//i.test(t) ? t : `https://${t}`);
  } catch {
    return null;
  }
}

/** Il nome del sito è pubblico: lettere e cifre, almeno un punto, un suffisso di sole lettere. */
function nomePubblico(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h || h.length > 253) return false;
  if (h.startsWith('[') || /^[0-9.]+$/.test(h) || /^0x/i.test(h)) return false; // IPv6, IPv4, 0x7f000001
  if (SUFFISSI_NON_PUBBLICI.test(h)) return false;
  const pezzi = h.split('.');
  if (pezzi.length < 2) return false;
  if (!/^[a-z]{2,24}$/.test(pezzi[pezzi.length - 1]) && !/^xn--[a-z0-9-]{2,59}$/.test(pezzi[pezzi.length - 1])) return false;
  // Ogni pezzo: lettere, cifre e trattini, ma non all'inizio né alla fine (senza «guarda indietro»: Safari vecchi).
  return pezzi.every((p) => /^[a-z0-9-]{1,63}$/.test(p) && !p.startsWith('-') && !p.endsWith('-'));
}

/** L'indirizzo pubblico in forma pulita (https, senza «#…»), o `null` se non si può salvare. */
export function indirizzoWebPubblico(v: string | null | undefined): string | null {
  const u = urlDi(String(v ?? ''));
  if (!u || u.protocol !== 'https:') return null;
  if (u.username || u.password || u.port) return null;
  if (!nomePubblico(u.hostname)) return null;
  u.hash = '';
  return u.toString();
}

/**
 * Il link della scheda su Google Maps: quello che si copia da «Condividi» nell'app (maps.app.goo.gl,
 * g.page, goo.gl/maps) o dalla barra del browser (google.it/maps, maps.google.com…). Un link di un
 * altro sito non è una scheda Google: `null`.
 */
/** I domini nazionali di Google ammessi dopo «google.» o «maps.google.». */
const DOMINI_GOOGLE = new Set(['com', 'it', 'sm', 'ch', 'fr', 'de', 'at', 'es', 'pt', 'be', 'nl', 'lu', 'ie', 'co.uk', 'pl', 'ro', 'gr', 'hr', 'si', 'com.br', 'com.ar', 'ca', 'com.au', 'us']);

export function linkGoogleMaps(v: string | null | undefined): string | null {
  const pulito = indirizzoWebPubblico(v);
  if (!pulito) return null;
  const u = new URL(pulito);
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const percorso = u.pathname.toLowerCase();
  // 26/11/2026 — Solo i domini veri di Google (revisione di sicurezza di mycity#336): prima passavano anche
  // «google.qzx.me» e «maps.google.ab.cd». L'elenco è chiuso: i paesi dove MyCity lavora e i vicini.
  const google = DOMINI_GOOGLE.has(host.replace(/^google\./, '')) && host.startsWith('google.');
  const mapsGoogle = DOMINI_GOOGLE.has(host.replace(/^maps\.google\./, '')) && host.startsWith('maps.google.');
  const ok =
    host === 'maps.app.goo.gl' ||
    host === 'g.page' ||
    // 26/11/2026 — Il link «Condividi» di Google Maps dal telefono, oggi (share.google/…).
    host === 'share.google' ||
    (host === 'goo.gl' && percorso.startsWith('/maps')) ||
    (host === 'g.co' && percorso.startsWith('/kgs/')) ||
    mapsGoogle ||
    (google && percorso.startsWith('/maps'));
  // Il solo dominio («https://g.page/») non è una scheda: serve il pezzo che dice quale.
  return ok && (percorso.length > 1 || u.search.length > 1) ? pulito : null;
}
