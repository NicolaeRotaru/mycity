import { describe, it, expect, vi } from 'vitest';
import { QueryClient, hydrate } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { queryKeys } from '@/lib/queries/keys';

/**
 * R07-021 (12/11/2026) — la vetrina mandava a Google lo schema del negozio senza le stelle
 * nell'HTML del server: media e numero delle recensioni (`store_review_stats`) le leggeva solo
 * il browser, che poi riscriveva lo script con `aggregateRating`. Ora il precarico del server
 * porta anche il riepilogo, con la stessa chiave che usa la pagina.
 */
const NEGOZIO = {
  id: 'negozio-1', store_name: 'Salumeria del Borgo', is_approved: true, store_hours: null,
  stripe_charges_enabled: true, stripe_payouts_enabled: true,
};

vi.mock('@/lib/supabase/anonimo', () => ({
  creaClientAnonimo: () => ({
    from: () => {
      const catena: Record<string, unknown> = {
        select: () => catena,
        eq: () => catena,
        maybeSingle: async () => ({ data: NEGOZIO, error: null }),
      };
      return catena;
    },
    rpc: async (nome: string, argomenti: { p_store_ids?: string[] }) =>
      nome === 'store_review_stats' && argomenti?.p_store_ids?.includes('negozio-1')
        ? { data: [{ store_id: 'negozio-1', avg: '4.6', count: 37 }], error: null }
        : { data: [], error: null },
  }),
}));

import { precaricaNegozio } from '@/lib/queries/precarico';

describe('R07-021 · le stelle del negozio arrivano già dal server', () => {
  it('il precarico della vetrina contiene media e numero delle recensioni, con la chiave della pagina', async () => {
    const stato = await precaricaNegozio('negozio-1');
    const qc = new QueryClient();
    hydrate(qc, stato);
    expect(qc.getQueryData([...queryKeys.reviews.store('negozio-1'), 'riepilogo'])).toEqual({ media: 4.6, totale: 37 });
  });

  it('e la pagina legge le stelle con quella stessa chiave e la stessa forma', async () => {
    const { domandaRiepilogoRecensioni } = await import('@/lib/queries/riepilogo-recensioni-negozio');
    const d = domandaRiepilogoRecensioni({ rpc: async () => ({ data: [], error: null }) }, 'negozio-1');
    expect(d.queryKey).toEqual([...queryKeys.reviews.store('negozio-1'), 'riepilogo']);
    const pagina = readFileSync('components/store-sections/useStorePageData.ts', 'utf8');
    expect(pagina).toContain("queryKey: [...queryKeys.reviews.store(id), 'riepilogo']");
    expect(pagina).toContain('{ media: Number(riga.avg), totale: Number(riga.count) }');
  });
});
