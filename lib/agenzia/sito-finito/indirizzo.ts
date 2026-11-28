import { slugify } from '@/lib/store-site';

/**
 * L'INDIRIZZO DEL SITO DI UN CLIENTE — 28/11/2026.
 *
 * Nicola, 28/11 verso le 14:10, sul test di Raquel Cafè: al sì del titolare «deve essere già su Vercel il sito del
 * cliente che ha accettato». Il sito lo serve il marketplace, che è già su Vercel: nessuna chiave in più. Ogni
 * cliente ha il suo indirizzo, `/sito/<nome>-<8 cifre>`: il nome si legge, le 8 cifre sono l'inizio dell'id del
 * negozio e bastano a trovarlo. Due bar con lo stesso nome hanno indirizzi diversi.
 *
 * Un indirizzo col nome vecchio (il locale ha cambiato nome) porta comunque al sito: la rotta rimanda a quello giusto.
 */

/** L'inizio dell'id del negozio che entra nell'indirizzo. */
const CIFRE = 8;

/** Il percorso del sito: «/sito/raquel-cafe-ffb27af9». `null` se l'id del negozio non è un uuid. */
export function percorsoDelSito(sellerId: string, nome: string): string | null {
  const id = typeof sellerId === 'string' ? sellerId.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return null;
  const nomeNellIndirizzo = slugify(nome || '').slice(0, 40).replace(/-+$/, '') || 'sito';
  return `/sito/${nomeNellIndirizzo}-${id.slice(0, CIFRE)}`;
}

/** Dall'ultimo pezzo dell'indirizzo («raquel-cafe-ffb27af9») le 8 cifre del negozio. `null` se non torna. */
export function leggiIndirizzo(pezzo: string): { nome: string; prefisso: string } | null {
  const m = /^([a-z0-9-]{0,60}?)-?([0-9a-f]{8})$/.exec(typeof pezzo === 'string' ? pezzo.toLowerCase() : '');
  if (!m) return null;
  return { nome: m[1], prefisso: m[2] };
}

/**
 * Le due estremità dell'intervallo degli uuid che iniziano con il prefisso: in Postgres gli uuid si confrontano
 * byte per byte, cioè nello stesso ordine delle cifre esadecimali scritte.
 */
export function intervalloDelPrefisso(prefisso: string): { da: string; a: string } {
  return { da: `${prefisso}-0000-0000-0000-000000000000`, a: `${prefisso}-ffff-ffff-ffff-ffffffffffff` };
}
