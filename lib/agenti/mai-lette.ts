// LE PAGINE CHE IL PROGRAMMA NON APRE MAI IN AUTOMATICO — 28/11/2026.
// Meta (Facebook, Instagram, WhatsApp, Threads), TikTok, Google e i portali (Tripadvisor, TheFork, Glovo): le stesse
// regole dei flussi 12 e 26 di n8n. Valgono per il primo indirizzo e per ogni rinvio (collaudo del 28/11: un dominio
// che rinviava alla sua pagina Facebook la faceva leggere, e Facebook diventava «il sito» del negozio).
// I siti fatti con Google Sites (sites.google.com) sono siti dei locali: quelli si aprono.
// Senza dipendenze: lo usano anche la scheda e la pagina del venditore.

const VIETATE = /(^|\.)(facebook\.com|facebook\.net|fb\.com|fb\.me|fb\.watch|instagram\.com|instagr\.am|threads\.net|threads\.com|whatsapp\.com|wa\.me|messenger\.com|tiktok\.com|goo\.gl|g\.page|g\.co|share\.google|tripadvisor\.[a-z.]+|thefork\.[a-z.]+|lafourchette\.[a-z.]+|glovoapp\.com|glovo\.[a-z.]+)$/i;
const GOOGLE = /(^|\.)google\.[a-z.]+$/i;

/** Il nome di dominio (senza «www.») non si apre mai in automatico? */
export function maiLetta(host: string): boolean {
  const h = String(host ?? '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  if (!h) return true;
  if (h === 'sites.google.com') return false;
  return VIETATE.test(h) || GOOGLE.test(h);
}

/** Lo stesso controllo su un indirizzo intero; un indirizzo che non si legge conta come vietato. */
export function indirizzoMaiLetto(url: string): boolean {
  try { return maiLetta(new URL(url).hostname); } catch { return true; }
}
