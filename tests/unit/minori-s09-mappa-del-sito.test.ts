/**
 * S09 — La mappa del sito (app/sitemap.ts): schede 2452 e 566.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mondo = vi.hoisted(() => ({
  erroreNegozi: false,
  dati: {
    seller_public_profiles: [{ id: 'n-pane', created_at: '2026-10-01' }],
    categories: [
      { id: 'c-ali', slug: 'alimentari', parent_id: null },
      { id: 'c-forno', slug: 'forno', parent_id: 'c-ali' },
      { id: 'c-abb', slug: 'abbigliamento', parent_id: null },
    ],
    products: [{ id: 'p-focaccia', created_at: '2026-10-10', seller_id: 'n-pane', category_id: 'c-forno' }],
  } as Record<string, unknown[]>,
}));

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: (tabella: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'limit', 'range', 'is']) q[m] = () => q;
      const risposta = tabella === 'seller_public_profiles' && mondo.erroreNegozi
        ? { data: null, error: { message: 'rete' } }
        : { data: mondo.dati[tabella] ?? [], error: null };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta).then(ok, ko);
      return q;
    },
  }),
}));

import sitemap from '@/app/sitemap';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://finto.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'chiave-finta');
  mondo.erroreNegozi = false;
});
afterEach(() => vi.unstubAllEnvs());

describe('2452 — se cade la lettura dei negozi', () => {
  it('la mappa non toglie a Google tutte le categorie', async () => {
    mondo.erroreNegozi = true;
    const cat = (await sitemap()).map((r) => r.url).filter((u) => u.includes('/category/'));
    expect(cat).toHaveLength(3);
  });
});

describe('566 — niente date finte, e le pagine utili ci sono', () => {
  it('nessuna riga dichiara una data di modifica che non conosciamo', async () => {
    const righe = await sitemap();
    expect(righe.filter((r) => r.lastModified !== undefined)).toEqual([]);
  });
  it('ci sono /categorie, /come-funziona, /terms e /returns', async () => {
    const percorsi = (await sitemap()).map((r) => new URL(r.url).pathname);
    for (const p of ['/categorie', '/come-funziona', '/terms', '/returns']) expect(percorsi).toContain(p);
  });
});
