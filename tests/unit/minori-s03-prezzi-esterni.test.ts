import { describe, it, expect, vi, beforeEach } from 'vitest';

/** S03 — il giro dei prezzi esterni (schede 42, 541). */
const stato = vi.hoisted(() => ({ aiAccesa: false, inserite: [] as Array<Record<string, unknown>>, chiamate: 0 }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, get AI_NEGOZI_ACCESA() { return stato.aiAccesa; } };
});
vi.mock('@/lib/env', async (orig) => {
  const vero = await orig<typeof import('@/lib/env')>();
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'sk-test' } };
});
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/products/externalSync', () => ({
  fetchExternalSnapshot: async () => {
    stato.chiamate++;
    return { price: 12, external: { price: 12, availability: 'in_stock' } };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        // 12/11/2026 (R04-011) — la rotta ora chiede prima i prodotti non in errore (.or) e
        // poi i falliti (.eq): qui l'unico prodotto e' sano, i falliti sono zero.
        select: () => q, not: () => q, order: () => q,
        eq: (c: string) =>
          c === 'external_sync_status'
            ? { order: () => ({ limit: async () => ({ data: [], error: null }) }) }
            : Promise.resolve({ error: null }),
        or: () => q,
        limit: async () => ({
          data: [{ id: 'p1', name: 'Pane', seller_id: 's1', external_marketplace: null, external_source_url: 'https://x', external_synced_at: null, external_data: { price: 10, availability: 'in_stock', source_title: 'Pane' } }],
          error: null,
        }),
        update: () => q,
        insert: async (r: Record<string, unknown>) => { if (t === 'notifications') stato.inserite.push(r); return { error: null }; },
      });
      return q;
    },
  }),
}));

async function giro() {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'));
}
beforeEach(() => { stato.inserite.length = 0; stato.chiamate = 0; });

describe('giro dei prezzi esterni', () => {
  it('42 — con l AI dei negozi spenta non parte, anche con la chiave', async () => {
    stato.aiAccesa = false;
    const r = await giro();
    expect(await r.json()).toMatchObject({ ok: true, skipped: 'AI spenta al lancio' });
    expect(stato.chiamate).toBe(0);
  });

  it('541 — l avviso del prezzo al negozio è di servizio, non una promozione', async () => {
    stato.aiAccesa = true;
    await giro();
    expect(stato.inserite).toHaveLength(1);
    expect(stato.inserite[0].category).toBe('system');
  });
});
