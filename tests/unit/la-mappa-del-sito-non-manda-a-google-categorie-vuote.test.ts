import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 31/10/2026 — LA MAPPA DEL SITO NON MANDA A GOOGLE CATEGORIE VUOTE.
 *
 * La sitemap elencava tutte le categorie: 72 indirizzi, e solo 3 con un prodotto dentro. Ogni
 * categoria vuota era una pagina senza niente mandata a Google da indicizzare. Qui la sitemap
 * gira davvero, contro un database finto, e si guarda quali categorie ci finiscono.
 */

const mondo = vi.hoisted(() => ({
  erroreProdotti: false,
  dati: {
    seller_public_profiles: [{ id: 'n-pane', created_at: '2026-10-01' }],
    categories: [
      { id: 'c-ali', slug: 'alimentari', parent_id: null },
      { id: 'c-forno', slug: 'forno', parent_id: 'c-ali' },
      { id: 'c-abb', slug: 'abbigliamento', parent_id: null },
      { id: 'c-ele', slug: 'elettronica', parent_id: null },
    ],
    products: [
      { id: 'p-focaccia', created_at: '2026-10-10', seller_id: 'n-pane', category_id: 'c-forno' },
    ],
  } as Record<string, unknown[]>,
}));

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: (tabella: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is']) q[m] = () => q;
      const risposta = tabella === 'products' && mondo.erroreProdotti
        ? { data: null, error: { message: 'rete' } }
        : { data: mondo.dati[tabella] ?? [], error: null };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta).then(ok, ko);
      return q;
    },
  }),
}));

import sitemap from '@/app/sitemap';

async function categorieInMappa(): Promise<string[]> {
  const righe = await sitemap();
  return righe
    .map((r) => r.url)
    .filter((u) => u.includes('/category/'))
    .map((u) => u.split('/category/')[1])
    .sort();
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://finto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-finta');
  mondo.erroreProdotti = false;
});
afterEach(() => vi.unstubAllEnvs());

describe('la sitemap e le categorie', () => {
  it('manda solo le categorie con un prodotto, compresa la madre di una sottocategoria piena', async () => {
    expect(await categorieInMappa()).toEqual(['alimentari', 'forno']);
  });

  it('se la lettura dei prodotti fallisce non toglie le categorie da Google', async () => {
    mondo.erroreProdotti = true;
    expect(await categorieInMappa()).toEqual(['abbigliamento', 'alimentari', 'elettronica', 'forno']);
  });
});
