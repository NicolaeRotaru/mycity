import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S06 — PATCH /api/seller/products/:id, eseguita davvero.
 *
 * 1890: una scheda incompleta (DaCompletare) e un rifiuto 23514 del database
 *       arrivano al negoziante come 400 col motivo, non come «Riprova».
 * 1582: un guasto vero risponde «Riprova» ma lascia traccia nel registro.
 */

const stato = vi.hoisted(() => ({ errore: null as unknown, log: [] as unknown[] }));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: Record<string, unknown>) => unknown) =>
    async (req: Request) => h({ req, user: { id: 'seller-1' }, supaUtente: {}, params: { id: 'p1' } }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => stato.log.push(a), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/products/salvataggio-tracciato', async (orig) => {
  const vero = await orig<typeof import('@/lib/products/salvataggio-tracciato')>();
  return {
    ...vero,
    salvaProdottoTracciato: async () => { throw stato.errore; },
  };
});

const { PATCH } = await import('@/app/api/seller/products/[id]/route');
const { DaCompletare } = await import('@/lib/products/salvataggio-tracciato');
const salva = () =>
  (PATCH as unknown as (r: Request) => Promise<Response>)(
    new Request('http://x/api/seller/products/p1', {
      method: 'PATCH',
      body: JSON.stringify({ payload: { name: 'Pane' } }),
    }),
  );

beforeEach(() => { stato.log = []; });

describe('1890 — il motivo arriva al negoziante', () => {
  it('una scheda incompleta torna 400 con i campi mancanti', async () => {
    stato.errore = new DaCompletare('Mancano gli allergeni', ['allergeni']);
    const r = await salva();
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(JSON.stringify(j)).toContain('Mancano gli allergeni');
    expect(JSON.stringify(j)).toContain('allergeni');
  });
  it('un rifiuto 23514 del database torna 400, non «Riprova»', async () => {
    stato.errore = { code: '23514', message: 'Per un alimento servono gli ingredienti' };
    const r = await salva();
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).not.toContain('Riprova');
  });
});

describe('1582 — il guasto vero lascia traccia', () => {
  it('risponde 500 «Riprova» e scrive l\'errore nel registro', async () => {
    stato.errore = { code: '42703', message: 'column "x" does not exist' };
    const r = await salva();
    expect(r.status).toBe(500);
    expect(JSON.stringify(stato.log)).toContain('column \\"x\\" does not exist');
  });
});
