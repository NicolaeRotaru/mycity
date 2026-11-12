import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R02-003 (12/11/2026) — La garanzia lato server: PATCH /api/segnalazioni non manda l'esito di una
 * segnalazione «accolta» («il contenuto è stato rimosso») se il contenuto è ancora online.
 */

const db: { segnalazione: Record<string, unknown> | null; prodotto: Record<string, unknown> | null; negozio: Record<string, unknown> | null } = {
  segnalazione: null, prodotto: null, negozio: null,
};
const comunicate: string[] = [];

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/app/api/segnalazioni/esito/comunica', () => ({
  MOTIVAZIONE_MINIMA: 20,
  comunicaEsito: async (_a: unknown, id: string) => {
    comunicate.push(id);
    return { ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'inviata', venditore: 'inviata' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: () => ({}),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({
        data: t === 'segnalazioni' ? db.segnalazione : t === 'products' ? db.prodotto : t === 'profiles' ? db.negozio : null,
        error: null,
      });
      return q;
    },
  }),
}));

import { PATCH } from '@/app/api/segnalazioni/route';

const ID = '00000000-0000-4000-8000-000000000042';
const chiama = () =>
  (PATCH as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/segnalazioni', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ID }),
  }));

describe('R02-003 · l esito «rimosso» parte solo se il contenuto è davvero fuori', () => {
  beforeEach(() => { comunicate.length = 0; db.prodotto = null; db.negozio = null; });

  it('prodotto accolto ma ancora in vetrina: 409, niente esito', async () => {
    db.segnalazione = { stato: 'accolta', tipo: 'prodotto', oggetto_id: 'p-1' };
    db.prodotto = { status: 'available' };
    expect((await chiama()).status).toBe(409);
    expect(comunicate).toEqual([]);
  });

  it('prodotto accolto e in bozza: l esito parte', async () => {
    db.segnalazione = { stato: 'accolta', tipo: 'prodotto', oggetto_id: 'p-1' };
    db.prodotto = { status: 'draft' };
    expect((await chiama()).status).toBe(200);
    expect(comunicate).toEqual([ID]);
  });

  it('negozio accolto ma ancora approvato: 409', async () => {
    db.segnalazione = { stato: 'accolta', tipo: 'negozio', oggetto_id: 'n-1' };
    db.negozio = { approval_status: 'approved' };
    expect((await chiama()).status).toBe(409);
    expect(comunicate).toEqual([]);
  });

  it('recensione accolta: da qui non si toglie, 409', async () => {
    db.segnalazione = { stato: 'accolta', tipo: 'recensione', oggetto_id: 'r-1' };
    expect((await chiama()).status).toBe(409);
  });

  it('respinta: l esito parte senza controlli', async () => {
    db.segnalazione = { stato: 'respinta', tipo: 'prodotto', oggetto_id: 'p-1' };
    db.prodotto = { status: 'available' };
    expect((await chiama()).status).toBe(200);
  });
});
