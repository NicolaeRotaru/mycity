import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R04-011 (revisione) — Anche il giro a orario dei prezzi esterni segnava
 * external_synced_at=adesso quando l'aggiornamento falliva. Adesso segna solo
 * l'errore, e un prodotto in errore si ritenta al massimo ogni sei ore.
 */
const stato = vi.hoisted(() => ({
  aggiornamenti: [] as Array<Record<string, unknown>>,
  chiamate: 0,
  statoRiga: 'idle' as string,
  ritento: true,
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
    stato.chiamate++;
    throw new Error('fornitore giu');
  },
  ritentoDopoErroreConsentito: async () => stato.ritento,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, not: () => q, order: () => q, eq: async () => ({ error: null }),
        limit: async () => ({
          data: [{ id: 'p1', name: 'Pane', seller_id: 's1', external_marketplace: null, external_source_url: 'https://x', external_synced_at: null, external_sync_status: stato.statoRiga, external_data: { price: 10, source_title: 'Pane' } }],
          error: null,
        }),
        update: (v: Record<string, unknown>) => { stato.aggiornamenti.push(v); return q; },
      });
      return q;
    },
  }),
}));

async function giro() {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'));
}
beforeEach(() => { stato.aggiornamenti.length = 0; stato.chiamate = 0; stato.statoRiga = 'idle'; stato.ritento = true; });

describe('giro dei prezzi esterni quando l\'aggiornamento fallisce', () => {
  it('segna l\'errore senza dire «aggiornato adesso»', async () => {
    await giro();
    expect(stato.aggiornamenti).toContainEqual({ external_sync_status: 'error' });
    expect(stato.aggiornamenti.some((a) => 'external_synced_at' in a)).toBe(false);
  });

  it('un prodotto gia\' in errore, dentro le sei ore, non si ritenta', async () => {
    stato.statoRiga = 'error';
    stato.ritento = false;
    await giro();
    expect(stato.chiamate).toBe(0);
  });
});
