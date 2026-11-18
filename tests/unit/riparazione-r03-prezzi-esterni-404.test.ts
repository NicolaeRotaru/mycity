import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-007 — Un 404 del fornitore AI nell'aggiornamento dei prezzi esterni (il
 * modello configurato non c'e' piu') diventava un generico «Aggiornamento non
 * riuscito. Riprova.» nel pannello admin, e un «check failed» qualunque nel giro
 * a orario. Riprovare non serve: adesso si dice come nelle rotte AI («Funzione
 * AI momentaneamente non disponibile.») e parte l'allarme sul modello.
 */
const stato = vi.hoisted(() => ({
  errore: null as unknown,
  logErrori: [] as string[],
  logAvvisi: [] as string[],
}));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, AI_NEGOZI_ACCESA: true };
});
vi.mock('@/lib/env', async (orig) => {
  const vero = await orig<typeof import('@/lib/env')>();
  return { ...vero, env: { ...vero.env, anthropicKey: () => 'sk-test' } };
});
vi.mock('@/lib/logger', () => ({
  logger: {
    error: (m: string) => { stato.logErrori.push(m); },
    warn: (m: string) => { stato.logAvvisi.push(m); },
    info: () => undefined,
    debug: () => undefined,
  },
}));
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
    fetchExternalSnapshot: async () => {
      throw stato.errore;
    },
    ritentoDopoErroreConsentito: async () => true,
  };
});

const ID = '11111111-1111-4111-8111-111111111111';
const RIGA = {
  id: ID, name: 'Lampada', seller_id: 's1', external_marketplace: 'amazon', external_source_url: 'https://amazon.it/x',
  external_synced_at: null, external_sync_status: 'idle', external_data: { price: 10, source_title: 'Lampada' },
};
vi.mock('@/lib/supabase/server', () => {
  // Una domanda nuova per ogni `from`: la fila dei falliti (status = error) e' vuota.
  const domanda = () => {
    let falliti = false;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, not: () => q, order: () => q, limit: () => q, or: () => q, neq: () => q,
      update: () => q, insert: async () => ({ error: null }),
      eq: (c: string, v: unknown) => { if (c === 'external_sync_status' && v === 'error') falliti = true; return q; },
      single: async () => ({ data: RIGA, error: null }),
      then: (ok: (x: unknown) => void) => ok({ data: falliti ? [] : [RIGA], error: null }),
    });
    return q;
  };
  return { getAdminSupabase: () => ({ from: domanda }), getServerSupabase: async () => ({ from: domanda }) };
});

import { AiCallError } from '@/lib/ai/run';

async function aggiornaOra(): Promise<{ status: number; body: { error?: { message?: string } } }> {
  const { POST } = await import('@/app/api/products/[id]/external-refresh/route');
  const res = await (POST as unknown as (r: Request, c: { params: Record<string, string> }) => Promise<Response>)(
    new Request(`http://x/api/products/${ID}/external-refresh`, { method: 'POST' }),
    { params: { id: ID } },
  );
  return { status: res.status, body: await res.json() };
}

async function giro(): Promise<Record<string, unknown>> {
  const { GET } = await import('@/app/api/cron/external-price-alerts/route');
  const res = await (GET as unknown as (r: Request) => Promise<Response>)(new Request('http://x'));
  return res.json();
}

const testo = (b: unknown) => JSON.stringify(b);

beforeEach(() => {
  stato.logErrori.length = 0;
  stato.logAvvisi.length = 0;
});

describe('aggiornamento dei prezzi esterni: il 404 del fornitore si dice per quello che e\'', () => {
  it('«Aggiorna ora» con un 404: non dice «Aggiornamento non riuscito. Riprova.», dice che la funzione AI non e\' disponibile', async () => {
    stato.errore = new AiCallError('marketplace-import', 404);
    const r = await aggiornaOra();
    expect(r.status).toBe(503);
    expect(testo(r.body)).toContain('Funzione AI momentaneamente non disponibile');
    expect(testo(r.body)).not.toContain('Aggiornamento non riuscito');
    expect(stato.logErrori.some((m) => m.includes('non trova il modello'))).toBe(true);
  });

  it('«Aggiorna ora» con un altro guasto: resta «Aggiornamento non riuscito. Riprova.»', async () => {
    stato.errore = new AiCallError('marketplace-import', 500);
    const r = await aggiornaOra();
    expect(r.status).toBe(502);
    expect(testo(r.body)).toContain('Aggiornamento non riuscito');
  });

  it('il giro a orario con un 404: allarme sul modello e motivo nella risposta, non un «check failed» qualunque', async () => {
    stato.errore = new AiCallError('marketplace-import', 404);
    const r = await giro();
    expect(r.errors).toBe(1);
    expect(String(r.errore)).toContain('non trova il modello');
    expect(stato.logErrori.some((m) => m.includes('non trova il modello'))).toBe(true);
    expect(stato.logAvvisi).not.toContain('external-price-alerts: check failed');
  });

  it('il giro a orario con un altro guasto: resta il «check failed», senza allarme sul modello', async () => {
    stato.errore = new Error('rete');
    const r = await giro();
    expect(r.errors).toBe(1);
    expect(r).not.toHaveProperty('errore');
    expect(stato.logAvvisi).toContain('external-price-alerts: check failed');
  });
});
