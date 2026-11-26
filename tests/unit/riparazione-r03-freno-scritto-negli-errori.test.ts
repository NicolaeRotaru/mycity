import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiCallError } from '@/lib/ai/run';

/**
 * R03-006 — Dove un prodotto importato va in errore (giro a orario e «Aggiorna ora») si scrive anche
 * l'ora dell'errore, che e' il dato del freno di sei ore uguale per tutte le copie del sito.
 */
const stato = vi.hoisted(() => ({ aggiornamenti: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, AI_NEGOZI_ACCESA: true };
});
vi.mock('@/lib/env', async (orig) => {
  const vero = await orig<typeof import('@/lib/env')>();
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'sk-test' } };
});
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (r: unknown) => unknown) => (r: unknown) => h(r),
  withAdminAuth: (h: (ctx: { params: Record<string, string> }) => unknown) =>
    (_req: unknown, ctx: { params: Record<string, string> }) => h({ params: ctx.params }),
}));
vi.mock('@/lib/products/externalSync', async (orig) => {
  const vero = await orig<typeof import('@/lib/products/externalSync')>();
  return {
    ...vero,
    fetchExternalSnapshot: async () => { throw new AiCallError('marketplace-import', 500); },
    ritentoDopoErroreConsentito: async () => true,
  };
});
const ID = '11111111-1111-4111-8111-111111111111';
const RIGA = {
  id: ID, name: 'Lampada', seller_id: 's1', external_marketplace: 'amazon', external_source_url: 'https://amazon.it/x',
  external_synced_at: null, external_sync_status: 'idle', external_data: { price: 10, source_title: 'Lampada' },
};
vi.mock('@/lib/supabase/server', () => {
  const domanda = () => {
    let falliti = false;
    let upd: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, not: () => q, order: () => q, limit: () => q, or: () => q, neq: () => q,
      insert: async () => ({ error: null }),
      update: (v: Record<string, unknown>) => { upd = v; return q; },
      eq: (c: string, v: unknown) => {
        if (upd) { stato.aggiornamenti.push({ ...upd, id: v }); upd = null; return Promise.resolve({ error: null }); }
        if (c === 'external_sync_status' && v === 'error') falliti = true;
        return q;
      },
      single: async () => ({ data: RIGA, error: null }),
      then: (ok: (x: unknown) => void) => ok({ data: falliti ? [] : [RIGA], error: null }),
    });
    return q;
  };
  return { getAdminSupabase: () => ({ from: domanda }), getServerSupabase: async () => ({ from: domanda }) };
});

const conOraErrore = () => stato.aggiornamenti.filter((a) => typeof a.external_sync_error_at === 'string' && a.id === ID);
beforeEach(() => { stato.aggiornamenti.length = 0; });

describe('l\'ora dell\'errore si scrive dove un prodotto importato va in errore', () => {
  it('giro a orario', async () => {
    const { GET } = await import('@/app/api/cron/external-price-alerts/route');
    await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'));
    expect(stato.aggiornamenti).toContainEqual({ external_sync_status: 'error', id: ID });
    expect(conOraErrore()).toHaveLength(1);
  });

  it('«Aggiorna ora»', async () => {
    const { POST } = await import('@/app/api/products/[id]/external-refresh/route');
    await (POST as unknown as (r: Request, c: { params: Record<string, string> }) => Promise<Response>)(
      new Request(`http://x/api/products/${ID}/external-refresh`, { method: 'POST' }), { params: { id: ID } });
    expect(stato.aggiornamenti).toContainEqual({ external_sync_status: 'error', id: ID });
    expect(conOraErrore()).toHaveLength(1);
  });
});
