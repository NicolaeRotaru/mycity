import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-003 — LA CANCELLAZIONE DI UN UTENTE DALL'AMMINISTRAZIONE RISPONDEVA 500 SENZA SCRIVERE NEL REGISTRO.
 *
 * Quando la lettura del profilo da cancellare cadeva (database giù), la rotta rispondeva
 * «riprova fra poco» e basta: nel registro degli errori non restava niente, e chi guarda
 * gli allarmi non sapeva che il pannello stava fallendo. Adesso il guasto si scrive con
 * logger.error prima della risposta, e la risposta resta la stessa (500, niente cancellato).
 */

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const stato = vi.hoisted(() => ({
  lettura: { data: null as unknown, error: null as unknown },
  cancellati: [] as string[],
}));

const errori = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/middleware', () => {
  const comeAmministratore =
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: '99999999-9999-4999-8999-999999999999' }, req, params: (await ctx?.params) ?? {} });
  return {
    withAdminAuth: comeAmministratore,
    withAdminAuthRateLimit: (_o: unknown, h: Parameters<typeof comeAmministratore>[0]) => comeAmministratore(h),
  };
});
vi.mock('@/lib/logger', () => ({ logger: { error: errori, warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async (_a: unknown, id: string) => {
    stato.cancellati.push(id);
    return { ok: true };
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => {
  const tavolo = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) b[m] = () => b;
    b.single = async () => stato.lettura;
    return b;
  };
  const admin = { from: tavolo };
  return { getAdminSupabase: () => admin };
});

import { DELETE as CANCELLA } from '@/app/api/admin/users/[id]/delete/route';

function cancella() {
  const req = new Request(`http://localhost/api/admin/users/${ID}/delete`, { method: 'DELETE' });
  return (CANCELLA as unknown as (r: Request, c: unknown) => Promise<Response>)(req, {
    params: Promise.resolve({ id: ID }),
  });
}

beforeEach(() => {
  stato.lettura = { data: null, error: null };
  stato.cancellati.length = 0;
  errori.mockClear();
});

describe('R03-003 · la cancellazione che risponde 500 lascia una riga nel registro', () => {
  it('lettura del profilo caduta → 500 «riprova» e un logger.error con l’utente e il codice del guasto', async () => {
    stato.lettura = { data: null, error: { code: '08006', message: 'connessione persa' } };
    const res = await cancella();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toMatch(/riprova/);
    expect(stato.cancellati).toEqual([]);
    expect(errori, 'il 500 della cancellazione non ha scritto niente nel registro').toHaveBeenCalledTimes(1);
    const [, dettagli] = errori.mock.calls[0] as [string, Record<string, unknown>];
    expect(dettagli).toMatchObject({ targetId: ID, code: '08006' });
  });

  it('nessuna riga (PGRST116) resta un 404 senza errore nel registro: non è un guasto', async () => {
    stato.lettura = { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    const res = await cancella();
    expect(res.status).toBe(404);
    expect(errori).not.toHaveBeenCalled();
  });
});
