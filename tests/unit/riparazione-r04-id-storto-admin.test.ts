import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-002, correzione) — UN ID CHE NON È UN UUID È «NON TROVATO», NON «RIPROVA».
 *
 * La prima correzione di R04-002 ha fatto diventare 500 «riprova» ogni errore del database nelle
 * quattro azioni dell'amministrazione. Ma un indirizzo con un id storto (un link tagliato, un robot)
 * fa rispondere a Postgres 22P02 («invalid input syntax for type uuid»): nessuna riga può avere quel
 * codice, e riprovare non serve a niente. Prima era 404 e torna 404, con la stessa regola del deposito
 * (lib/supabase/lettura-per-metadati.ts, lib/ordini/annullo-del-cliente.ts, lib/queries/venduto-da.ts).
 * Un guasto vero (08006, la connessione persa) resta 500 «riprova».
 */

const ID_STORTO = { code: '22P02', message: 'invalid input syntax for type uuid: "non-e-un-uuid"' };
const GIU = { code: '08006', message: 'connessione persa' };
const ID = 'non-e-un-uuid';

const stato = vi.hoisted(() => ({
  lettura: { data: null as unknown, error: null as unknown },
  scritture: [] as string[],
}));

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
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/account/cancellazione', () => ({
  cancellaAccount: vi.fn(async () => {
    stato.scritture.push('cancellaAccount');
    return { ok: true };
  }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', () => {
  const tavolo = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'neq', 'order', 'limit', 'not']) b[m] = () => b;
    b.single = async () => stato.lettura;
    b.maybeSingle = async () => stato.lettura;
    b.update = () => {
      stato.scritture.push('update');
      return b;
    };
    b.insert = async () => {
      stato.scritture.push('insert');
      return { error: null };
    };
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
    return b;
  };
  const admin = {
    from: tavolo,
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  };
  return { getAdminSupabase: () => admin, getServerSupabase: async () => admin };
});

import { POST as MODERA } from '@/app/api/admin/users/[id]/moderate/route';
import { DELETE as CANCELLA } from '@/app/api/admin/users/[id]/delete/route';
import { POST as ANNULLA } from '@/app/api/admin/orders/[id]/cancel/route';
import { POST as CHIUDI_RECLAMO } from '@/app/api/admin/disputes/[id]/resolve/route';

type Rotta = (req: never, ctx: never) => Promise<Response>;
function chiama(rotta: unknown, metodo: string, corpo?: unknown) {
  const req = new Request(`http://localhost/api/admin/x/${ID}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return (rotta as Rotta)(req as never, { params: Promise.resolve({ id: ID }) } as never);
}

const AZIONI: Array<[string, () => Promise<Response>, string]> = [
  ['moderare un negozio', () => chiama(MODERA, 'POST', { action: 'approve' }), 'Utente non trovato'],
  ['cancellare un utente', () => chiama(CANCELLA, 'DELETE'), 'Utente non trovato'],
  ['annullare un ordine', () => chiama(ANNULLA, 'POST', { reason: 'prova' }), 'Ordine non trovato'],
  [
    'chiudere un reclamo',
    () => chiama(CHIUDI_RECLAMO, 'POST', { status: 'rejected', notes: 'Reclamo senza fondamento, chiuso.' }),
    'Reclamo non trovato',
  ],
];

beforeEach(() => {
  stato.lettura = { data: null, error: null };
  stato.scritture.length = 0;
});

describe('R04-002 · un id che non è un UUID è «non trovato», un guasto vero resta «riprova»', () => {
  for (const [azione, esegui, nonTrovato] of AZIONI) {
    it(`${azione}: id storto (22P02) → 404 «non trovato», non 500 «riprova», e niente scritture`, async () => {
      stato.lettura = { data: null, error: ID_STORTO };
      const res = await esegui();
      const corpo = JSON.stringify(await res.json());
      expect(res.status, `${azione}: un id che non è un UUID risponde ${res.status} ${corpo}`).toBe(404);
      expect(corpo).toContain(nonTrovato);
      expect(corpo).not.toMatch(/riprova/);
      expect(stato.scritture, `${azione}: con un id storto non si scrive niente`).toEqual([]);
    });

    it(`${azione}: connessione persa (08006) → resta 500 «riprova»`, async () => {
      stato.lettura = { data: null, error: GIU };
      const res = await esegui();
      const corpo = JSON.stringify(await res.json());
      expect(res.status).toBe(500);
      expect(corpo).toMatch(/riprova/);
      expect(stato.scritture).toEqual([]);
    });
  }
});
