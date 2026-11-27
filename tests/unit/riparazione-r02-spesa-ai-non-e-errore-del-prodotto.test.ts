import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Col budget AI finito (o con la spesa di oggi che non si legge) il prodotto importato veniva
 * segnato «error» e restava dietro il freno di sei ore anche quando il budget tornava. Non e'
 * colpa del prodotto: adesso non va in errore, ne' dal giro a orario ne' da «Aggiorna ora».
 * Orologio finto.
 */
type Riga = {
  id: string; name: string; seller_id: string | null; external_marketplace: string | null; external_source_url: string;
  external_synced_at: string | null; external_sync_status: string | null; external_data: { price: number; source_title: string };
};
const stato = vi.hoisted(() => ({
  errore: null as unknown,
  righe: [] as Riga[],
  chiamate: [] as string[],
  aggiornamenti: [] as Array<Record<string, unknown>>,
}));
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
  withAdminAuth:
    (h: (ctx: { params: Record<string, string> }) => unknown) =>
    (_req: unknown, ctx: { params: Record<string, string> }) =>
      h({ params: ctx.params }),
}));
vi.mock('@/lib/products/externalSync', async (orig) => {
  const vero = await orig<typeof import('@/lib/products/externalSync')>();
  return {
    ...vero,
    fetchExternalSnapshot: async (query: string) => {
      stato.chiamate.push(query);
      throw stato.errore;
    },
    ritentoDopoErroreConsentito: async () => true,
  };
});
vi.mock('@/lib/supabase/server', () => {
  const domanda = () => {
    let filtro: 'sani' | 'falliti' | null = null;
    let aggiornamento: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, not: () => q, order: () => q, limit: () => q, neq: () => q, insert: async () => ({ error: null }),
      or: () => { filtro = 'sani'; return q; },
      update: (v: Record<string, unknown>) => { aggiornamento = v; return q; },
      eq: (c: string, v: unknown) => {
        if (aggiornamento) { stato.aggiornamenti.push({ ...aggiornamento, id: v }); aggiornamento = null; return Promise.resolve({ error: null }); }
        if (c === 'external_sync_status' && v === 'error') filtro = 'falliti';
        return q;
      },
      single: async () => ({ data: stato.righe[0], error: null }),
      then: (ok: (x: unknown) => void) => {
        const data = stato.righe.filter((r) =>
          filtro === 'falliti' ? r.external_sync_status === 'error' : filtro === 'sani' ? r.external_sync_status !== 'error' : true);
        ok({ data, error: null });
      },
    });
    return q;
  };
  return { getAdminSupabase: () => ({ from: domanda }), getServerSupabase: async () => ({ from: domanda }) };
});

import { AiCallError } from '@/lib/ai/run';

const ID = '11111111-1111-4111-8111-111111111111';
const riga = (id: string): Riga => ({
  id, name: id, seller_id: 's1', external_marketplace: 'amazon', external_source_url: 'https://amazon.it/x',
  external_synced_at: null, external_sync_status: 'idle', external_data: { price: 10, source_title: id },
});

async function giro(): Promise<Record<string, unknown>> {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  return (await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'))).json();
}
async function aggiornaOra(): Promise<number> {
  const { POST } = await import('@/app/api/products/[id]/external-refresh/route');
  const res = await (POST as unknown as (r: Request, c: { params: Record<string, string> }) => Promise<Response>)(
    new Request(`http://x/api/products/${ID}/external-refresh`, { method: 'POST' }),
    { params: { id: ID } },
  );
  return res.status;
}
const segnatiInErrore = () => stato.aggiornamenti.filter((a) => a.external_sync_status === 'error');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  stato.righe = []; stato.chiamate.length = 0; stato.aggiornamenti.length = 0; stato.errore = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('il budget AI finito non e\' un errore del prodotto', () => {
  for (const [nome, errore] of [
    ['budget finito', () => AiCallError.perTettoSpesa('marketplace-import')],
    ['spesa sconosciuta', () => AiCallError.perSpesaSconosciuta('marketplace-import')],
  ] as const) {
    it(`giro a orario, ${nome}: nessun prodotto segnato «error» e il giro si ferma`, async () => {
      stato.errore = errore();
      stato.righe = [riga('p1'), riga('p2'), riga('p3')];
      const r = await giro();
      expect(segnatiInErrore()).toEqual([]);
      expect(stato.chiamate).toEqual(['p1']);
      expect(r.errors).toBe(0);
      expect(r.rimasti).toBe(3);
    });

    it(`«Aggiorna ora», ${nome}: il prodotto resta com'era, non «error»`, async () => {
      stato.errore = errore();
      stato.righe = [{ ...riga(ID), name: 'Lampada' }];
      const status = await aggiornaOra();
      expect(status).toBe(503);
      expect(segnatiInErrore()).toEqual([]);
      expect(stato.aggiornamenti).toContainEqual({ external_sync_status: 'idle', id: ID });
    });
  }

  it('un guasto qualunque resta un errore del prodotto', async () => {
    stato.errore = new AiCallError('marketplace-import', 500);
    stato.righe = [{ ...riga(ID), name: 'Lampada' }];
    await aggiornaOra();
    expect(segnatiInErrore()).toEqual([{ external_sync_status: 'error', id: ID }]);
  });
});
