import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R01-007 (27/11/2026) — UNA RECENSIONE SEGNALATA COME FALSA SI PUÒ ACCOGLIERE.
 *
 * PATCH /api/segnalazioni rispondeva 409 («questo tipo non si toglie da qui») a ogni recensione
 * accolta, anche quando la recensione non c'era più: l'esito non partiva mai. Ora parte quando la
 * recensione non è più pubblicata, né fra quelle dei prodotti né fra quelle dei negozi; finché è
 * pubblicata, o se la lettura cade, resta il 409.
 */

const db = vi.hoisted(() => ({
  segnalazione: null as Record<string, unknown> | null,
  tabelle: {} as Record<string, Record<string, unknown> | null>,
  cade: null as string | null,
}));
const comunicate = vi.hoisted(() => [] as string[]);

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) => handler({ user: { id: 'admin-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/app/api/segnalazioni/esito/comunica', () => ({
  MOTIVAZIONE_MINIMA: 20,
  comunicaEsito: async (_a: unknown, id: string) => {
    comunicate.push(id);
    return { ok: true, segnalanteEmail: 'inviata', segnalanteNotifica: 'nessun_recapito', venditore: 'non_previsto' };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: () => ({}),
  getAdminSupabase: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => (db.cade === t
        ? { data: null, error: { message: 'rete caduta' } }
        : { data: t === 'segnalazioni' ? db.segnalazione : (db.tabelle[t] ?? null), error: null });
      return q;
    },
  }),
}));

import { PATCH } from '@/app/api/segnalazioni/route';

const ID = '00000000-0000-4000-8000-000000000011';
const chiama = () =>
  (PATCH as unknown as (r: Request) => Promise<Response>)(new Request('http://x/api/segnalazioni', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: ID }),
  }));

describe('R01-007 · la recensione segnalata come falsa', () => {
  beforeEach(() => {
    comunicate.length = 0;
    db.tabelle = {};
    db.cade = null;
    db.segnalazione = { stato: 'accolta', tipo: 'recensione', oggetto_id: 'r-1' };
  });

  it('IL CASO CHE ROMPEVA — accolta e tolta: l\'esito «rimosso» parte', async () => {
    const r = await chiama();
    expect(r.status, 'una recensione accolta e tolta non riceve mai il suo esito').toBe(200);
    expect(comunicate).toEqual([ID]);
  });

  it('accolta ma ancora pubblicata fra le recensioni dei negozi: 409, niente esito', async () => {
    db.tabelle.store_reviews = { id: 'r-1' };
    expect((await chiama()).status).toBe(409);
    expect(comunicate).toEqual([]);
  });

  it('accolta ma ancora pubblicata fra le recensioni dei prodotti: 409', async () => {
    db.tabelle.reviews = { id: 'r-1' };
    expect((await chiama()).status).toBe(409);
    expect(comunicate).toEqual([]);
  });

  it('se la lettura delle recensioni cade, si ferma: non manda «rimosso» senza saperlo', async () => {
    db.cade = 'store_reviews';
    expect((await chiama()).status).toBe(409);
    expect(comunicate).toEqual([]);
  });

  it('un messaggio accolto resta fermo: da qui non si toglie', async () => {
    db.segnalazione = { stato: 'accolta', tipo: 'messaggio', oggetto_id: 'm-1' };
    expect((await chiama()).status).toBe(409);
  });
});
