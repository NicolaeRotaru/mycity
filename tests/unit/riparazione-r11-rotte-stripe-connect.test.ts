import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R11-024 — Il collegamento del negozio e del fattorino a Stripe e il bonifico a
 * mano non avevano nessuna prova. Qui le cinque rotte, con Stripe e database
 * finti: chi non deve passare non passa, gli errori non diventano «tutto ok», e
 * il percorso giusto risponde quello che la pagina si aspetta.
 */

const stato = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  ruolo: 'seller',
  email: 'forno@esempio.it' as string | null,
  creaLink: vi.fn(),
  loginLink: vi.fn(),
  conto: {} as Record<string, unknown>,
  scritto: { error: null as unknown, righe: 1 },
  rilascio: vi.fn(),
  ordine: null as Record<string, unknown> | null,
  resi: [] as unknown[],
  reclami: [] as unknown[],
  stripeAcceso: true,
}));

vi.mock('@/lib/api/middleware', () => {
  const conUtente = (_o: unknown, gestore: (ctx: Record<string, unknown>) => unknown) => (req: Request) =>
    gestore({ user: { id: 'u-1', email: stato.email }, profile: { role: stato.ruolo }, req, params: {} });
  return {
    withAuthRateLimit: conUtente,
    withSellerAuthRateLimit: conUtente,
    withInternalAuth: (gestore: (req: Request) => unknown) => (req: Request) => gestore(req),
  };
});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { appUrl: () => 'https://mycity.test' } }));
vi.mock('@/lib/stripe/salva-conto', () => ({ ContoNonSalvato: class extends Error {}, salvaIlConto: vi.fn() }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => stato.stripeAcceso,
  createConnectOnboardingLink: (a: unknown) => stato.creaLink(a),
  createConnectLoginLink: (id: string) => stato.loginLink(id),
  getStripe: () => ({ accounts: { retrieve: async () => stato.conto } }),
}));
vi.mock('@/lib/stripe/payout', () => ({
  applyConnectAccountStatus: async () => stato.scritto,
  releaseOrderPayout: (id: string) => stato.rilascio(id),
}));
vi.mock('@/lib/supabase/server', () => {
  const catena = (risposta: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'limit']) c[m] = () => c;
    c.single = async () => risposta();
    c.maybeSingle = async () => risposta();
    (c as { then: unknown }).then = (ok: (v: unknown) => void) => ok(risposta());
    return c;
  };
  return {
    getServerSupabase: async () => ({ from: () => catena(() => ({ data: stato.profilo, error: stato.profilo ? null : { message: 'x' } })) }),
    getAdminSupabase: () => ({
      from: (t: string) =>
        catena(() =>
          t === 'orders' ? { data: stato.ordine, error: null } : { data: t === 'returns' ? stato.resi : stato.reclami, error: null },
        ),
    }),
  };
});

const chiama = async (percorso: string, corpo?: unknown) => {
  const mod = (await import(percorso)) as { POST: (r: Request) => Promise<Response> };
  return mod.POST(new Request('http://localhost/x', { method: 'POST', body: corpo ? JSON.stringify(corpo) : undefined }));
};

beforeEach(() => {
  stato.profilo = { approval_status: 'approved', stripe_account_id: null, store_name: 'Forno' };
  stato.ruolo = 'seller';
  stato.email = 'forno@esempio.it';
  stato.creaLink = vi.fn(async () => ({ url: 'https://connect.stripe.test/x', accountId: 'acct_1' }));
  stato.loginLink = vi.fn(async () => ({ url: 'https://dashboard.stripe.test/x' }));
  stato.conto = { id: 'acct_1', charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { currently_due: [] } };
  stato.scritto = { error: null, righe: 1 };
  stato.rilascio = vi.fn(async () => ({ ok: true, transferId: 'tr_1' }));
  stato.ordine = { dispute_status: null, internal_dispute_status: null, delivered_at: '2026-01-01T00:00:00Z' };
  stato.resi = [];
  stato.reclami = [];
  stato.stripeAcceso = true;
});

describe('onboarding del negozio', () => {
  const R = '@/app/api/stripe/connect/onboarding/route';
  it('negozio approvato: link di Stripe, da venditore, col conto salvato prima', async () => {
    const r = await chiama(R);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: 'https://connect.stripe.test/x' });
    expect(stato.creaLink).toHaveBeenCalledWith(expect.objectContaining({ ruolo: 'venditore', salvaConto: expect.any(Function) }));
  });
  it('negozio non ancora approvato: 403, nessun conto creato', async () => {
    stato.profilo = { approval_status: 'pending', stripe_account_id: null };
    expect((await chiama(R)).status).toBe(403);
    expect(stato.creaLink).not.toHaveBeenCalled();
  });
  it('Stripe spento: 503; errore di Stripe: 500 «Errore Stripe»', async () => {
    stato.stripeAcceso = false;
    expect((await chiama(R)).status).toBe(503);
    stato.stripeAcceso = true;
    stato.creaLink = vi.fn(async () => { throw new Error('boom'); });
    expect((await chiama(R)).status).toBe(500);
  });
});

describe('onboarding del fattorino', () => {
  const R = '@/app/api/stripe/connect/rider-onboarding/route';
  it('fattorino: link da fattorino (niente card_payments)', async () => {
    stato.ruolo = 'rider';
    expect((await chiama(R)).status).toBe(200);
    expect(stato.creaLink).toHaveBeenCalledWith(expect.objectContaining({ ruolo: 'fattorino' }));
  });
  it.each(['buyer', 'seller'])('%s: non passa', async (ruolo) => {
    stato.ruolo = ruolo;
    expect((await chiama(R)).status).toBe(403);
    expect(stato.creaLink).not.toHaveBeenCalled();
  });
});

describe('aggiorna stato del collegamento', () => {
  const R = '@/app/api/stripe/connect/refresh-status/route';
  it('senza conto: non collegato, 200', async () => {
    expect(await (await chiama(R)).json()).toMatchObject({ connected: false, payouts_enabled: false });
  });
  it('col conto: lo stato vero di Stripe', async () => {
    stato.profilo = { stripe_account_id: 'acct_1' };
    const r = await chiama(R);
    expect(await r.json()).toMatchObject({ connected: true, payouts_enabled: true });
  });
  it('stato non registrato sul profilo: 503, non «tutto ok»', async () => {
    stato.profilo = { stripe_account_id: 'acct_1' };
    stato.scritto = { error: null, righe: 0 };
    expect((await chiama(R)).status).toBe(503);
  });
});

describe('accesso al conto Stripe', () => {
  const R = '@/app/api/stripe/connect/login/route';
  it('senza conto collegato: 403', async () => {
    expect((await chiama(R)).status).toBe(403);
    expect(stato.loginLink).not.toHaveBeenCalled();
  });
  it('col conto: il link monouso', async () => {
    stato.profilo = { stripe_account_id: 'acct_1' };
    expect(await (await chiama(R)).json()).toEqual({ url: 'https://dashboard.stripe.test/x' });
  });
});

describe('bonifico a mano (rotta interna)', () => {
  const R = '@/app/api/stripe/payout/route';
  const ID = '0b6a3f4e-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
  it('id che non è un uuid: 400, niente bonifico', async () => {
    expect((await chiama(R, { orderId: 'abc' })).status).toBe(400);
    expect(stato.rilascio).not.toHaveBeenCalled();
  });
  it('con un reso aperto o una contestazione in banca: 409, niente bonifico', async () => {
    stato.resi = [{ id: 'reso' }];
    expect((await chiama(R, { orderId: ID })).status).toBe(409);
    stato.resi = [];
    stato.ordine = { dispute_status: 'OPEN', internal_dispute_status: null, delivered_at: '2026-01-01T00:00:00Z' };
    expect((await chiama(R, { orderId: ID })).status).toBe(409);
    expect(stato.rilascio).not.toHaveBeenCalled();
  });
  it('con un reclamo aperto (tabella o colonna sull ordine): 409', async () => {
    stato.reclami = [{ id: 'reclamo' }];
    expect((await chiama(R, { orderId: ID })).status).toBe(409);
    stato.reclami = [];
    stato.ordine = { dispute_status: null, internal_dispute_status: 'OPEN', delivered_at: '2026-01-01T00:00:00Z' };
    expect((await chiama(R, { orderId: ID })).status).toBe(409);
    expect(stato.rilascio).not.toHaveBeenCalled();
  });
  it('consegnato da pochi minuti: 409, il bonifico aspetta', async () => {
    stato.ordine = { dispute_status: null, internal_dispute_status: null, delivered_at: new Date().toISOString() };
    expect((await chiama(R, { orderId: ID })).status).toBe(409);
    expect(stato.rilascio).not.toHaveBeenCalled();
  });
  it('tutto a posto: parte il bonifico', async () => {
    const r = await chiama(R, { orderId: ID });
    expect(r.status).toBe(200);
    expect(stato.rilascio).toHaveBeenCalledWith(ID);
  });
});
