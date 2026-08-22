import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /api/admin/cod-remittance (🔴-1 slice 2): l'admin conferma la rimessa contanti
 * del rider → l'endpoint chiama l'RPC confirm_cod_remittance e ritorna gli ordini
 * rilasciati (AWAITING_REMITTANCE → HELD). withAdminAuth e l'RPC sono mockati.
 */

const RIDER = '11111111-1111-1111-1111-111111111111';
const state: { released: number; rpcError: null | { message: string } } = {
  released: 3,
  rpcError: null,
};
const rpcMock = vi.fn(async () => ({ data: state.released, error: state.rpcError }));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (h: (ctx: { req: unknown }) => unknown) => (req: unknown) => h({ req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ rpc: rpcMock }),
}));

function reqWith(body: unknown) {
  // 22/8/2026 — QUI C'ERA UNA RICHIESTA FINTA CON DENTRO SOLO `json()`.
  // Adesso il corpo lo legge un lettore col tetto, che ha bisogno di una
  // richiesta vera: la finta non aveva ne' `body` ne' `arrayBuffer`, quindi
  // provava una cosa che in produzione non succede mai.
  return new Request('http://localhost/prova', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Request;
}
async function run(body: unknown) {
  const { POST } = await import('@/app/api/admin/cod-remittance/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(reqWith(body));
}

beforeEach(() => {
  state.released = 3;
  state.rpcError = null;
  rpcMock.mockClear();
});

describe('POST /api/admin/cod-remittance', () => {
  it('conferma rimessa → chiama l\'RPC e ritorna gli ordini rilasciati', async () => {
    const res = await run({ riderId: RIDER, date: '2026-06-15' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, released: 3 });
    expect(rpcMock).toHaveBeenCalledWith('confirm_cod_remittance', { p_rider: RIDER, p_date: '2026-06-15' });
  });

  it('body non valido (uuid/data) → 400, nessuna chiamata RPC', async () => {
    expect((await run({ riderId: 'not-a-uuid', date: '2026-06-15' })).status).toBe(400);
    expect((await run({ riderId: RIDER, date: '15/06/2026' })).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('errore RPC (es. forbidden) → 500', async () => {
    state.rpcError = { message: 'forbidden' };
    expect((await run({ riderId: RIDER, date: '2026-06-15' })).status).toBe(500);
  });
});
