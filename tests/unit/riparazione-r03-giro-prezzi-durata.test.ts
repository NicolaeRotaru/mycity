import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R03-003 — Il giro dei prezzi esterni faceva fino a 10 chiamate al modello in fila
 * (60 s l'una) contro i 300 s di durata: la funzione veniva spenta a meta' giro.
 * Adesso una chiamata nuova parte solo se c'e' il tempo di finirla; i prodotti rimasti
 * non si toccano (restano per il giro dopo, non in errore). Orologio finto.
 */
const stato = vi.hoisted(() => ({
  aggiornamenti: [] as Array<Record<string, unknown>>,
  chiamate: 0,
  durataChiamataMs: 0,
}));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, AI_NEGOZI_ACCESA: true };
});
vi.mock('@/lib/env', async (orig) => {
  const vero = await orig<typeof import('@/lib/env')>();
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'sk-test' } };
});
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r) }));
vi.mock('@/lib/products/externalSync', () => ({
  fetchExternalSnapshot: async () => {
    stato.chiamate += 1;
    vi.setSystemTime(Date.now() + stato.durataChiamataMs);
    return { price: 10, external: { price: 10, availability: 'in_stock' } };
  },
  ritentoDopoErroreConsentito: async () => true,
}));

const RIGHE = Array.from({ length: 10 }, (_, i) => ({
  id: `p${i}`, name: `p${i}`, seller_id: null, external_marketplace: null, external_source_url: 'https://x',
  external_synced_at: null, external_sync_status: 'idle', external_data: { price: 10, source_title: `p${i}` },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      let falliti = false;
      let upd: Record<string, unknown> | null = null;
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, not: () => q, order: () => q, limit: () => q, or: () => q,
        insert: async () => ({ error: null }),
        update: (v: Record<string, unknown>) => { upd = v; return q; },
        eq: (c: string, v: unknown) => {
          if (upd) { stato.aggiornamenti.push({ ...upd, id: v }); upd = null; return Promise.resolve({ error: null }); }
          if (c === 'external_sync_status' && v === 'error') falliti = true;
          return q;
        },
        then: (ok: (x: unknown) => void) => ok({ data: falliti ? [] : RIGHE, error: null }),
      });
      return q;
    },
  }),
}));

async function giro(): Promise<Record<string, unknown>> {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'))).json();
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
  stato.aggiornamenti.length = 0; stato.chiamate = 0;
});
afterEach(() => { vi.useRealTimers(); });

describe('giro dei prezzi esterni e durata massima', () => {
  it('con chiamate da 60 s si ferma prima di sforare i 300 s e non segna in errore i rimasti', async () => {
    stato.durataChiamataMs = 60_000;
    const t0 = Date.now();
    const r = await giro();
    expect(Date.now() - t0).toBeLessThanOrEqual(300_000);
    expect(stato.chiamate).toBeLessThan(10);
    expect(stato.chiamate).toBeGreaterThan(0);
    expect(r.rimasti).toBe(10 - stato.chiamate);
    expect(stato.aggiornamenti.filter((a) => a.external_sync_status === 'error')).toEqual([]);
  });

  it('con chiamate veloci lavora tutti i prodotti del giro', async () => {
    stato.durataChiamataMs = 1_000;
    const r = await giro();
    expect(stato.chiamate).toBe(10);
    expect(r).not.toHaveProperty('rimasti');
  });
});
