import { describe, it, expect, vi } from 'vitest';
import { AiCallError } from '@/lib/ai/run';

/**
 * R03-004 — «Aggiorna ora» dei prezzi esterni: col budget AI finito (o il limite del fornitore)
 * l'admin leggeva «Aggiornamento non riuscito. Riprova.». Adesso parlano le parole di mapAiError.
 */
const stato = vi.hoisted(() => ({ errore: null as unknown }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => {
  const vero = await orig<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, AI_NEGOZI_ACCESA: true };
});
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: { params: Record<string, string> }) => unknown) =>
    (_req: unknown, ctx: { params: Record<string, string> }) => h({ params: ctx.params }),
}));
vi.mock('@/lib/products/externalSync', async (orig) => {
  const vero = await orig<typeof import('@/lib/products/externalSync')>();
  return { ...vero, fetchExternalSnapshot: async () => { throw stato.errore; }, ritentoDopoErroreConsentito: async () => true };
});
const ID = '11111111-1111-4111-8111-111111111111';
const RIGA = { external_source_url: 'https://x', external_marketplace: 'amazon', external_data: null, external_synced_at: null, external_sync_status: 'idle' };
vi.mock('@/lib/supabase/server', () => {
  const domanda = () => {
    const q: Record<string, unknown> = {};
    Object.assign(q, { select: () => q, update: () => q, eq: () => q, single: async () => ({ data: RIGA, error: null }), then: (ok: (x: unknown) => void) => ok({ data: null, error: null }) });
    return q;
  };
  return { getAdminSupabase: () => ({ from: domanda }), getServerSupabase: async () => ({ from: domanda }) };
});

async function aggiornaOra() {
  const { POST } = await import('@/app/api/products/[id]/external-refresh/route');
  const res = await (POST as unknown as (r: Request, c: { params: Record<string, string> }) => Promise<Response>)(
    new Request(`http://x/api/products/${ID}/external-refresh`, { method: 'POST' }), { params: { id: ID } });
  return { status: res.status, testo: JSON.stringify(await res.json()) };
}

describe('«Aggiorna ora» dei prezzi esterni e gli errori del servizio AI', () => {
  it('tetto di spesa: dice che il budget e\' finito, non «Riprova»', async () => {
    stato.errore = AiCallError.perTettoSpesa('marketplace-import');
    const r = await aggiornaOra();
    expect(r.status).toBe(503);
    expect(r.testo).toContain('Budget AI giornaliero esaurito');
    expect(r.testo).not.toContain('Aggiornamento non riuscito');
  });
  it('429: risposta di limite con attesa, non «Riprova»', async () => {
    stato.errore = new AiCallError('marketplace-import', 429, undefined, 30);
    const r = await aggiornaOra();
    expect(r.status).toBe(429);
    expect(r.testo).not.toContain('Aggiornamento non riuscito');
  });
  it('un guasto qualunque resta «Aggiornamento non riuscito. Riprova.»', async () => {
    stato.errore = new AiCallError('marketplace-import', 500);
    const r = await aggiornaOra();
    expect(r.status).toBe(502);
    expect(r.testo).toContain('Aggiornamento non riuscito');
  });
});
