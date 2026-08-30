/**
 * UNA FOTO CARICATA DA UN UTENTE PUÒ STARE SOLO IN CASA NOSTRA.
 *
 * 27/8/2026 (R021) — Le foto allegate a una richiesta di reso erano validate
 * con `z.string().url()`, e quel controllo — con zod 3 — accetta anche
 * `javascript:…` e `data:…`. Il valore finiva poi dritto dentro un
 * `<a href={url}>` nella scheda che il negoziante apre per decidere il reso.
 *
 * Oggi il danno è contenuto: la politica di sicurezza dei contenuti in
 * produzione usa nonce + strict-dynamic senza `unsafe-inline`, quindi un
 * `javascript:` non parte, e le immagini si caricano solo dagli host dichiarati
 * in `next.config.js`. Ma resta vero il nocciolo — un indirizzo scelto
 * dall'utente dentro un `href` senza nessuna verifica — e resta vero il domani:
 * il giorno in cui quella politica si allenta, lo stesso campo diventa
 * esecuzione di codice.
 *
 * La regola qui è la più stretta che si possa scrivere senza rompere niente:
 * `https`, e l'host è quello del nostro archivio Supabase. È dove le foto
 * finiscono davvero (`lib/storage/carica-immagine.ts`): un indirizzo altrove
 * non è una foto di reso, è qualcos'altro travestito.
 */

/** L'host dell'archivio Supabase, dedotto da NEXT_PUBLIC_SUPABASE_URL. */
export function hostArchivio(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Vero solo se l'indirizzo è una foto servita dal nostro archivio.
 *
 * Senza `NEXT_PUBLIC_SUPABASE_URL` (build di prova, script) non si può sapere
 * quale sia l'host di casa: in quel caso si accetta comunque solo `https`, che
 * è la parte che chiude `javascript:` e `data:`.
 */
export function fotoDiCasa(indirizzo: unknown): boolean {
  if (typeof indirizzo !== 'string' || indirizzo.length === 0) return false;
  let url: URL;
  try {
    url = new URL(indirizzo);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const casa = hostArchivio();
  if (!casa) return true;
  return url.host === casa;
}
