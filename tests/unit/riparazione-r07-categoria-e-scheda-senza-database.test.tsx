/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * R07-014 — Senza database la categoria e la scheda prodotto mostravano «Qualcosa è andato storto»
 * (la pagina d'errore di tutto il sito) invece del loro errore con «Riprova».
 *
 * Chi lancia è il guscio: il guscio del prodotto quando non legge il prodotto, i metadati della
 * categoria quando non leggono la categoria. Lanciano di proposito (un guasto non è «non trovato»),
 * ma l'errore partiva prima che la pagina arrivasse al suo ramo isError.
 *
 * Next sceglie il confine così: l'errore di un guscio (layout) lo prende l'error.tsx più vicino
 * SOPRA la sua cartella (quello della stessa cartella copre solo la pagina); l'errore della pagina e
 * dei suoi metadati lo prende l'error.tsx più vicino a partire dalla cartella stessa. La prova
 * cerca il confine con questa regola e lo disegna con l'errore vero.
 */

const RADICE = path.resolve(__dirname, '../..');

function confineDErrore(cartella: string, chiLancia: 'guscio' | 'pagina'): string {
  let dir = chiLancia === 'guscio' ? path.posix.dirname(cartella) : cartella;
  for (;;) {
    const file = path.posix.join(dir, 'error.tsx');
    if (existsSync(path.join(RADICE, file))) return file;
    if (dir === 'app') throw new Error(`nessun error.tsx sopra ${cartella}`);
    dir = path.posix.dirname(dir);
  }
}

vi.mock('@/lib/queries/precarico', () => ({ precaricaProdotto: async () => ({ mutations: [], queries: [] }) }));
vi.mock('@/lib/queries/metadati-vetrina', () => ({
  leggiProdottoPerMetadati: async () => { throw new Error('fetch failed'); },
  disponibilitaPerGoogle: () => 'https://schema.org/InStock',
  prodottoDaIndicizzare: () => true,
}));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => { throw new Error('senza chiavi'); } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));
vi.mock('@/lib/supabase/lettura-per-metadati', () => ({ leggiPerMetadati: async () => { throw new Error('fetch failed'); } }));
vi.mock('@/lib/supabase/anonimo', () => ({ creaClientAnonimo: () => { throw new Error('senza chiavi'); } }));

async function disegna(file: string) {
  const mod = await monta(file);
  const errore = Object.assign(new Error('fetch failed'), { digest: '4242' });
  const s = accendi(mod.default, { error: errore, reset: () => {} });
  const testo = testoVisibile(s.radice);
  const riprova = Array.from(s.radice.querySelectorAll('button')).some((b) => /Riprova/.test(b.textContent ?? ''));
  const versoIlCatalogo = !!s.radice.querySelector('a[href="/categorie"]');
  s.smonta();
  return { testo, riprova, versoIlCatalogo };
}

describe('R07-014 · senza database la scheda prodotto dice il suo errore, con «Riprova»', () => {
  it('il guscio del prodotto lancia quando non legge il prodotto (il caso di partenza)', async () => {
    const { default: ProductLayout } = await import('@/app/product/[id]/layout');
    await expect(ProductLayout({ children: null, params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000001' }) })).rejects.toThrow();
  });

  it('l errore del guscio arriva a un confine che dice «Impossibile caricare il prodotto», con «Riprova» e il catalogo', async () => {
    const { testo, riprova, versoIlCatalogo } = await disegna(confineDErrore('app/product/[id]', 'guscio'));
    expect(testo, 'il cliente legge la pagina d errore generica del sito').not.toContain('Qualcosa è andato storto');
    expect(testo).toContain('Impossibile caricare il prodotto');
    expect(riprova).toBe(true);
    expect(versoIlCatalogo).toBe(true);
  }, 60000);
});

describe('R07-014 · senza database la categoria dice il suo errore, con «Riprova»', () => {
  it('i metadati della categoria lanciano quando non leggono la categoria (il caso di partenza)', async () => {
    const { generateMetadata } = await import('@/app/category/[slug]/layout');
    await expect(generateMetadata({ params: Promise.resolve({ slug: 'alimentari' }) })).rejects.toThrow();
  });

  it('l errore dei metadati arriva a un confine che dice «Non riesco a caricare questa categoria», con «Riprova» e le categorie', async () => {
    const { testo, riprova, versoIlCatalogo } = await disegna(confineDErrore('app/category/[slug]', 'pagina'));
    expect(testo, 'il cliente legge la pagina d errore generica del sito').not.toContain('Qualcosa è andato storto');
    expect(testo).toContain('Non riesco a caricare questa categoria');
    expect(riprova).toBe(true);
    expect(versoIlCatalogo).toBe(true);
  }, 60000);

  it('anche un errore del guscio della categoria arriva allo stesso confine', async () => {
    const { testo } = await disegna(confineDErrore('app/category/[slug]', 'guscio'));
    expect(testo).toContain('Non riesco a caricare questa categoria');
  }, 60000);
});
