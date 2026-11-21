import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-002) — NELLE AZIONI DELL'AMMINISTRAZIONE UN GUASTO DEL DATABASE DIVENTAVA «NON TROVATO».
 *
 * Moderare un utente, cancellarlo, annullare un ordine, chiudere un reclamo: le quattro rotte
 * leggevano la riga e rispondevano 404 a ogni lettura senza dati, anche quando il database non
 * rispondeva. Chi amministra leggeva «Utente non trovato» o «Ordine non trovato» su un utente o un
 * ordine che c'erano, e non riprovava. Adesso un errore del database è un 500 «riprova»; il 404
 * resta per la sola risposta «nessuna riga» (PGRST116). Chi può fare cosa non cambia: le prove
 * passano dall'involucro dell'amministratore come prima.
 */

const GIU = { code: '08006', message: 'connessione persa' };
const NESSUNA_RIGA = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };
const ID = 'aaaaaaaa-0000-4000-8000-000000000001';

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

describe('R04-002 · il database che non risponde non è «non trovato»', () => {
  for (const [azione, esegui, nonTrovato] of AZIONI) {
    it(`${azione}: lettura caduta → 500 «riprova», non 404, e niente scritture`, async () => {
      stato.lettura = { data: null, error: GIU };
      const res = await esegui();
      const corpo = JSON.stringify(await res.json());
      expect(res.status, `${azione}: un guasto del database risponde ancora ${corpo}`).toBe(500);
      expect(corpo).not.toContain(nonTrovato);
      expect(corpo).toMatch(/riprova/);
      expect(stato.scritture, `${azione}: con la riga non letta non si scrive niente`).toEqual([]);
    });

    it(`${azione}: nessuna riga (PGRST116) → resta 404`, async () => {
      stato.lettura = { data: null, error: NESSUNA_RIGA };
      const res = await esegui();
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).toContain(nonTrovato);
    });
  }
});
