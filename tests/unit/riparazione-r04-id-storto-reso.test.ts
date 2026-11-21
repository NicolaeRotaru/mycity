import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-009, correzione) — UN ID DI RESO CHE NON È UN UUID È «NON TROVATO», NON «RIPROVA».
 *
 * La prima correzione di R04-009 ha fatto diventare 503 «riprova» ogni errore del database nella
 * lettura del reso (rotte `decide` e `avanza`). Un indirizzo con un id storto fa rispondere a Postgres
 * 22P02 («invalid input syntax for type uuid»): nessun reso può avere quel codice, e riprovare non
 * serve. Prima era 404 e torna 404, con la regola del deposito (lib/supabase/lettura-per-metadati.ts).
 * Un guasto vero (08006, la connessione persa) resta 503 «riprova».
 */

const FORNAIO = 'fornaio-venditore';
const ID_STORTO = { code: '22P02', message: 'invalid input syntax for type uuid: "non-e-un-uuid"' };
const GIU = { code: '08006', message: 'connessione persa' };

const stato = vi.hoisted(() => ({
  lettura: { data: null as unknown, error: null as unknown },
  scritture: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: FORNAIO }, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', async (o) => ({
  ...((await o()) as Record<string, unknown>),
  refundOrder: vi.fn(async () => ({ refundId: 'rf_1', reversedCents: 0 })),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/ordini/campanella', () => ({ scriviCampanella: vi.fn(async () => undefined) }));

vi.mock('@/lib/supabase/server', () => {
  const tavolo = () => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'neq', 'order', 'limit', 'not']) b[m] = () => b;
    b.single = async () => stato.lettura;
    b.maybeSingle = async () => stato.lettura;
    b.update = (patch: Record<string, unknown>) => {
      stato.scritture.push(patch);
      return b;
    };
    b.insert = async () => ({ error: null });
    b.then = (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
    return b;
  };
  return {
    getServerSupabase: async () => ({ from: tavolo }),
    getAdminSupabase: () => ({ from: tavolo, rpc: async () => ({ data: null, error: null }) }),
  };
});

import { POST as AVANZA } from '@/app/api/returns/[id]/avanza/route';
import { POST as DECIDE } from '@/app/api/returns/[id]/decide/route';

function chiama(rotta: typeof AVANZA, corpo: unknown) {
  const req = new Request('http://localhost/api/returns/non-e-un-uuid/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return rotta(req as never, { params: Promise.resolve({ id: 'non-e-un-uuid' }) }) as Promise<Response>;
}

const ROTTE: Array<[string, () => Promise<Response>]> = [
  ['decide', () => chiama(DECIDE, { decision: 'APPROVED' })],
  ['avanza', () => chiama(AVANZA, { stato: 'RECEIVED' })],
];

beforeEach(() => {
  stato.lettura = { data: null, error: null };
  stato.scritture.length = 0;
});

describe('R04-009 · un id di reso che non è un UUID è «non trovato», un guasto vero resta «riprova»', () => {
  for (const [nome, esegui] of ROTTE) {
    it(`${nome}: id storto (22P02) → 404 «Reso non trovato», non 503 «riprova», e niente scritture`, async () => {
      stato.lettura = { data: null, error: ID_STORTO };
      const res = await esegui();
      const corpo = JSON.stringify(await res.json());
      expect(res.status, `${nome}: un id che non è un UUID risponde ${res.status} ${corpo}`).toBe(404);
      expect(corpo).toContain('Reso non trovato');
      expect(corpo).not.toMatch(/riprova/);
      expect(stato.scritture).toHaveLength(0);
    });

    it(`${nome}: connessione persa (08006) → resta 503 «riprova»`, async () => {
      stato.lettura = { data: null, error: GIU };
      const res = await esegui();
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).toMatch(/riprova/);
      expect(stato.scritture).toHaveLength(0);
    });
  }
});
