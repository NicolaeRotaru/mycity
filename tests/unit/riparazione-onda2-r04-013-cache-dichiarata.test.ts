/**
 * R04-013 (onda 2, 28/11/2026) — LE PAGINE DI PRODOTTO, CATEGORIA E PAGINA SU MISURA DEL NEGOZIO
 * NON DICHIARANO UNA CACHE CHE NON USANO.
 *
 * `revalidate = 300` (prodotto), `600` (categoria), `300` (pagina su misura): con `force-dynamic` in
 * app/layout.tsx nessuna di queste copie esiste, e il giorno in cui quella riga verrà tolta la scheda
 * mostrerebbe prezzo e disponibilità di cinque minuti prima. La parte che resta (una cache vera delle
 * letture) è una scelta di Nicola. Qui si leggono i moduli veri: il valore che Next prende è il più
 * basso fra i segmenti della rotta.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/lettura-per-metadati', () => ({ leggiPerMetadati: async () => null }));
vi.mock('@/lib/queries/precarico', () => ({
  precaricaNegozio: async () => ({ mutations: [], queries: [] }),
  precaricaProdotto: async () => ({ mutations: [], queries: [] }),
}));

const prodotto = await import('@/app/product/[id]/layout');
const categoria = await import('@/app/category/[slug]/layout');
const vetrina = await import('@/app/store/[id]/layout');
const paginaSuMisura = await import('@/app/store/[id]/[slug]/layout');

const secondiDichiarati = (...segmenti: Array<{ revalidate?: unknown }>) =>
  Math.min(...segmenti.map((s) => (typeof s.revalidate === 'number' ? s.revalidate : Infinity)));

describe('R04-013 · nessuna cache dichiarata che non c’è', () => {
  it('IL CASO CHE ROMPEVA — la scheda prodotto non dichiara cinque minuti di copia', () => {
    expect(secondiDichiarati(prodotto), 'la scheda dichiara una copia in cache (prezzo e disponibilità vecchi)').toBe(0);
  });

  it('IL CASO CHE ROMPEVA — la pagina della categoria non dichiara dieci minuti di copia', () => {
    expect(secondiDichiarati(categoria)).toBe(0);
  });

  it('la pagina su misura del negozio dichiara da sola quello che già vale con la vetrina sopra', () => {
    expect(secondiDichiarati(paginaSuMisura)).toBe(0);
    expect(secondiDichiarati(vetrina, paginaSuMisura)).toBe(0);
  });
});
