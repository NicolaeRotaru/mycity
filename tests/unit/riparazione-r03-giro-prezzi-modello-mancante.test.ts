import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiCallError } from '@/lib/ai/run';

/**
 * R03-002 — Con il modello AI mancante (404 del fornitore) il giro dei prezzi esterni
 * continuava a chiamare per ogni prodotto e li segnava tutti 'error' (freno di sei ore).
 * Adesso al primo 404 il giro si ferma e nessun prodotto finisce segnato 'error'.
 */
const stato = vi.hoisted(() => ({
  aggiornamenti: [] as Array<Record<string, unknown>>,
  chiamate: 0,
  errore: null as unknown,
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
    throw stato.errore;
  },
  ritentoDopoErroreConsentito: async () => true,
}));

const RIGHE = ['p1', 'p2', 'p3'].map((id) => ({
  id, name: id, seller_id: 's1', external_marketplace: null, external_source_url: 'https://x',
  external_synced_at: null, external_sync_status: 'idle', external_data: { price: 10, source_title: id },
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
beforeEach(() => { stato.aggiornamenti.length = 0; stato.chiamate = 0; });

describe('giro dei prezzi esterni con il modello AI mancante', () => {
  it('al primo 404 si ferma e non segna \'error\' nessun prodotto', async () => {
    stato.errore = new AiCallError('marketplace-import', 404);
    const r = await giro();
    expect(stato.chiamate).toBe(1);
    expect(stato.aggiornamenti.filter((a) => a.external_sync_status === 'error')).toEqual([]);
    expect(String(r.errore)).toContain('non trova il modello');
  });

  it('con un guasto qualunque il giro continua e segna in errore chi fallisce', async () => {
    stato.errore = new Error('rete');
    await giro();
    expect(stato.chiamate).toBe(3);
    expect(stato.aggiornamenti.filter((a) => a.external_sync_status === 'error')).toHaveLength(3);
  });
});
