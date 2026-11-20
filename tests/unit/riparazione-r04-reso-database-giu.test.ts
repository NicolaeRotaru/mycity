import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 20/11/2026 (R04-009) — SE IL DATABASE NON RISPONDE, CHI DECIDE UN RESO NON DEVE LEGGERE
 * «NON TROVATO» O «NON AUTORIZZATO».
 *
 * Le rotte `decide` e `avanza` leggevano la riga del reso con `if (error || !ret) → 404`: un
 * database caduto diventava «Reso non trovato», e il negozio pensava che la richiesta fosse sparita.
 * Lo stesso per la rilettura dell'ordine prima del rimborso («Ordine del reso non trovato») e per il
 * controllo «sei il cliente?» del ritiro (lettura caduta = «non autorizzato»). Una lettura caduta è
 * un guasto passeggero: 503 «riprova». PGRST116 («nessuna riga») resta il solo «non c'è».
 *
 * Il database finto risponde in fila: ogni lettura di una tabella prende la risposta successiva
 * della sua coda (l'ultima resta per le letture dopo).
 */

const FORNAIO = 'fornaio-venditore';
const ANNA = 'anna-cliente';
const GIU = { code: '08006', message: 'connessione persa' };
const NESSUNA_RIGA = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };

type Risposta = { data: unknown; error: unknown };
const stato = vi.hoisted(() => ({
  chiamante: '',
  code: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
  scritture: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_o: unknown, handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: stato.chiamante }, req, params: (await ctx?.params) ?? {} }),
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
  const prossima = (tabella: string): Risposta => {
    const coda = stato.code[tabella] ?? [{ data: null, error: null }];
    return coda.length > 1 ? coda.shift()! : coda[0];
  };
  const tavolo = (tabella: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is', 'neq', 'order', 'limit', 'not']) b[m] = () => b;
    b.single = async () => prossima(tabella);
    b.maybeSingle = async () => prossima(tabella);
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
  const req = new Request('http://localhost/api/returns/r1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return rotta(req as never, { params: Promise.resolve({ id: 'r1' }) }) as Promise<Response>;
}

const reso = (status: string) => ({
  data: { id: 'r1', status, seller_id: FORNAIO, buyer_id: ANNA, order_id: 'o1', reason: 'DAMAGED', refund_amount_cents: 4200, created_at: '2026-11-10T10:00:00Z', order_item_id: null },
  error: null,
});
const ordineDelFornaio = { data: { seller_id: FORNAIO, user_id: ANNA }, error: null };

beforeEach(() => {
  stato.chiamante = FORNAIO;
  stato.code = {};
  stato.scritture.length = 0;
});

describe('R04-009 · decide: il database che non risponde non è un reso che non c’è', () => {
  it('la lettura del reso cade: 503 «riprova», non 404 «Reso non trovato»', async () => {
    stato.code.returns = [{ data: null, error: GIU }];
    const res = await chiama(DECIDE, { decision: 'APPROVED' });
    expect(res.status, 'un database caduto risponde ancora «Reso non trovato»').toBe(503);
    expect(stato.scritture).toHaveLength(0);
  });

  it('nessuna riga (PGRST116): resta 404 «Reso non trovato»', async () => {
    stato.code.returns = [{ data: null, error: NESSUNA_RIGA }];
    const res = await chiama(DECIDE, { decision: 'APPROVED' });
    expect(res.status).toBe(404);
  });

  it('approvazione con rimborso, la rilettura dell’ordine cade: 503, non «Ordine del reso non trovato»', async () => {
    stato.code.returns = [reso('REQUESTED')];
    // La prima lettura dell'ordine è quella di chi comanda (riesce), la seconda è quella del rimborso (cade).
    stato.code.orders = [ordineDelFornaio, { data: null, error: GIU }];
    const res = await chiama(DECIDE, { decision: 'APPROVED', refundAmountCents: 1000 });
    expect(res.status, 'la rilettura caduta dell’ordine risponde ancora «non trovato»').toBe(503);
    expect(stato.scritture, 'con l’ordine non letto il reso non si tocca').toHaveLength(0);
  });

  it('l’ordine del rimborso non c’è davvero (PGRST116): resta 404', async () => {
    stato.code.returns = [reso('REQUESTED')];
    stato.code.orders = [ordineDelFornaio, { data: null, error: NESSUNA_RIGA }];
    const res = await chiama(DECIDE, { decision: 'APPROVED', refundAmountCents: 1000 });
    expect(res.status).toBe(404);
  });
});

describe('R04-009 · avanza: il database che non risponde non è «non trovato» né «non autorizzato»', () => {
  it('la lettura del reso cade: 503 «riprova», non 404', async () => {
    stato.code.returns = [{ data: null, error: GIU }];
    const res = await chiama(AVANZA, { stato: 'RECEIVED' });
    expect(res.status, 'un database caduto risponde ancora «Reso non trovato»').toBe(503);
  });

  it('nessuna riga (PGRST116): resta 404', async () => {
    stato.code.returns = [{ data: null, error: NESSUNA_RIGA }];
    const res = await chiama(AVANZA, { stato: 'RECEIVED' });
    expect(res.status).toBe(404);
  });

  it('il cliente ritira la richiesta e la lettura «sei il cliente?» cade: 503, non 403', async () => {
    stato.chiamante = ANNA;
    stato.code.returns = [reso('REQUESTED')];
    stato.code.profiles = [{ data: { role: 'buyer' }, error: null }];
    // Chi comanda legge l'ordine (riesce: il negozio è il fornaio), poi «sei il cliente?» (cade).
    stato.code.orders = [ordineDelFornaio, { data: null, error: GIU }];
    const res = await chiama(AVANZA, { stato: 'CANCELED' });
    expect(res.status, 'la lettura caduta risponde ancora «non autorizzato»').toBe(503);
    expect(stato.scritture).toHaveLength(0);
  });

  it('chi non è né negozio né cliente resta 403', async () => {
    stato.chiamante = 'un-altro';
    stato.code.returns = [reso('REQUESTED')];
    stato.code.profiles = [{ data: { role: 'buyer' }, error: null }];
    stato.code.orders = [ordineDelFornaio];
    const res = await chiama(AVANZA, { stato: 'CANCELED' });
    expect(res.status).toBe(403);
  });

  it('il negozio rimborsa e la rilettura dell’ordine cade: 503, non «Ordine del reso non trovato»', async () => {
    stato.code.returns = [reso('RECEIVED')];
    stato.code.orders = [ordineDelFornaio, { data: null, error: GIU }];
    const res = await chiama(AVANZA, { stato: 'REFUNDED' });
    expect(res.status, 'la rilettura caduta dell’ordine risponde ancora «non trovato»').toBe(503);
    expect(stato.scritture).toHaveLength(0);
  });
});
