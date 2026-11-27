import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R06-009 (26/11/2026) — Le rotte del collegamento a Stripe (negozio e fattorino) e del
 * bonifico manuale avevano zero prove. Qui si provano con Stripe FINTO e con un database
 * finto: nessuna chiamata vera. Si usano gli involucri di autenticazione veri, così si
 * vede anche che ogni rotta è montata sull'involucro giusto.
 */

type Utente = { id: string; email: string } | null;
const stato: {
  utente: Utente;
  ruolo: { role: string; is_approved: boolean };
  profilo: { data: Record<string, unknown> | null; error: unknown };
  contoRighe: number;
  aggiornamenti: Array<{ tabella: string; valori: Record<string, unknown> }>;
  resoAperto: boolean;
} = {
  utente: null,
  ruolo: { role: 'seller', is_approved: true },
  profilo: { data: null, error: null },
  contoRighe: 1,
  aggiornamenti: [],
  resoAperto: false,
};

const stripeFinto = {
  accountsRetrieve: vi.fn(),
  linkOnboarding: vi.fn(),
  linkLogin: vi.fn(),
  rilascio: vi.fn(),
};

/** Un database finto: ogni metodo di filtro torna se stesso, la fine risolve col dato della tabella. */
function costruttore(tabella: string) {
  let aggiorna: Record<string, unknown> | null = null;
  const risultato = () => {
    if (aggiorna) {
      stato.aggiornamenti.push({ tabella, valori: aggiorna });
      return { data: Array.from({ length: stato.contoRighe }, (_, i) => ({ id: `r${i}` })), error: null };
    }
    if (tabella === 'profiles') return { data: { id: stato.utente?.id, ...stato.ruolo }, error: null };
    if (tabella === 'orders') {
      return { data: { dispute_status: null, internal_dispute_status: null, delivered_at: '2020-01-01T00:00:00Z' }, error: null };
    }
    if (tabella === 'returns') return { data: stato.resoAperto ? [{ id: 'r1' }] : [], error: null };
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'limit']) q[m] = () => q;
  q.update = (v: Record<string, unknown>) => { aggiorna = v; return q; };
  q.single = async () => risultato();
  q.maybeSingle = async () => risultato();
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato()).then(ok, ko);
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => stato.utente,
  // il client «della persona»: serve alle rotte per leggere il proprio profilo
  getServerSupabase: async () => ({
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) q[m] = () => q;
      q.single = async () => stato.profilo;
      return q;
    },
  }),
  getAdminSupabase: () => ({ from: (t: string) => costruttore(t) }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: async () => ({ allowed: true, retryAfterSec: 0 }),
  getClientIp: () => '203.0.113.9',
  __resetRateLimitBuckets: () => undefined,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', async (orig) => {
  const reale = await orig<typeof import('@/lib/env')>();
  return { ...reale, env: { ...reale.env, appUrl: () => 'https://mycity.test' } };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({ accounts: { retrieve: stripeFinto.accountsRetrieve } }),
  createConnectOnboardingLink: async (a: { salvaConto?: (id: string) => Promise<void> }) => {
    stripeFinto.linkOnboarding(a);
    await a.salvaConto?.('acct_finto');
    return { url: 'https://connect.stripe.test/onboarding/abc' };
  },
  createConnectLoginLink: async (id: string) => {
    stripeFinto.linkLogin(id);
    return { url: 'https://connect.stripe.test/login/abc' };
  },
}));
vi.mock('@/lib/stripe/payout', async (orig) => {
  const reale = await orig<typeof import('@/lib/stripe/payout')>();
  return { ...reale, releaseOrderPayout: (...a: unknown[]) => stripeFinto.rilascio(...a) };
});

import { POST as onboarding } from '@/app/api/stripe/connect/onboarding/route';
import { POST as refreshStatus } from '@/app/api/stripe/connect/refresh-status/route';
import { POST as login } from '@/app/api/stripe/connect/login/route';
import { POST as riderOnboarding } from '@/app/api/stripe/connect/rider-onboarding/route';
import { POST as payout } from '@/app/api/stripe/payout/route';

type Rotta = (req: NextRequest) => Promise<Response>;
const chiama = (rotta: unknown, percorso: string, intestazioni: Record<string, string> = {}, corpo?: unknown) =>
  (rotta as Rotta)(new NextRequest(`http://localhost${percorso}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...intestazioni },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  }));

const ORDINE = '11111111-1111-4111-8111-111111111111';
const ANONIMO: Utente = null;
const PERSONA: Utente = { id: 'u-1', email: 'negozio@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  stato.utente = PERSONA;
  stato.ruolo = { role: 'seller', is_approved: true };
  stato.profilo = { data: { approval_status: 'approved', stripe_account_id: null, store_name: 'Forno' }, error: null };
  stato.contoRighe = 1;
  stato.aggiornamenti = [];
  stato.resoAperto = false;
  process.env.INTERNAL_API_SECRET = 'segreto-di-prova';
});

describe('R06-009 · /api/stripe/connect/onboarding (negozio)', () => {
  const vai = () => chiama(onboarding, '/api/stripe/connect/onboarding');

  it('401 senza sessione', async () => {
    stato.utente = ANONIMO;
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('403 a un acquirente e a un negozio non approvato', async () => {
    stato.ruolo = { role: 'buyer', is_approved: false };
    expect((await vai()).status).toBe(403);
    stato.ruolo = { role: 'seller', is_approved: false };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('403 se la verifica KYC del negozio non è approvata', async () => {
    stato.profilo = { data: { approval_status: 'pending', stripe_account_id: null }, error: null };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('crea l\'account link con Stripe finto e salva il conto sul profilo', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/onboarding/abc' });
    const arg = stripeFinto.linkOnboarding.mock.calls[0][0];
    expect(arg).toMatchObject({
      sellerId: 'u-1',
      sellerEmail: 'negozio@example.com',
      existingAccount: null,
      ruolo: 'venditore',
      returnUrl: 'https://mycity.test/seller/dashboard?stripe=connected',
      refreshUrl: 'https://mycity.test/seller/dashboard?stripe=refresh',
    });
    expect(stato.aggiornamenti).toContainEqual({
      tabella: 'profiles',
      valori: expect.objectContaining({ stripe_account_id: 'acct_finto', stripe_payouts_enabled: false }),
    });
  });

  it('riusa il conto già collegato', async () => {
    stato.profilo = { data: { approval_status: 'approved', stripe_account_id: 'acct_vecchio' }, error: null };
    expect((await vai()).status).toBe(200);
    expect(stripeFinto.linkOnboarding.mock.calls[0][0].existingAccount).toBe('acct_vecchio');
  });

  it('503 se il conto non si è potuto salvare: non si manda a Stripe', async () => {
    stato.contoRighe = 0;
    expect((await vai()).status).toBe(503);
  });
});

describe('R06-009 · /api/stripe/connect/rider-onboarding (fattorino)', () => {
  const vai = () => chiama(riderOnboarding, '/api/stripe/connect/rider-onboarding');
  beforeEach(() => {
    stato.ruolo = { role: 'rider', is_approved: true };
    stato.profilo = { data: { stripe_account_id: null }, error: null };
  });

  it('401 senza sessione', async () => {
    stato.utente = ANONIMO;
    expect((await vai()).status).toBe(401);
  });

  it('403 a un acquirente e a un negozio', async () => {
    stato.ruolo = { role: 'buyer', is_approved: false };
    expect((await vai()).status).toBe(403);
    stato.ruolo = { role: 'seller', is_approved: true };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('crea il link per il fattorino, senza la capacità di incassare carte', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/onboarding/abc' });
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({
      ruolo: 'fattorino',
      returnUrl: 'https://mycity.test/rider/earnings?stripe=connected',
    });
  });
});

describe('R06-009 · /api/stripe/connect/login (cruscotto Stripe del negozio)', () => {
  const vai = () => chiama(login, '/api/stripe/connect/login');

  it('401 senza sessione', async () => {
    stato.utente = ANONIMO;
    expect((await vai()).status).toBe(401);
  });

  it('403 a un acquirente', async () => {
    stato.ruolo = { role: 'buyer', is_approved: false };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('403 se il negozio non ha ancora un conto collegato', async () => {
    stato.profilo = { data: { stripe_account_id: null }, error: null };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('con un conto collegato dà il link di accesso monouso', async () => {
    stato.profilo = { data: { stripe_account_id: 'acct_123' }, error: null };
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/login/abc' });
    expect(stripeFinto.linkLogin).toHaveBeenCalledWith('acct_123');
  });
});

describe('R06-009 · /api/stripe/connect/refresh-status', () => {
  const vai = () => chiama(refreshStatus, '/api/stripe/connect/refresh-status');

  it('401 senza sessione', async () => {
    stato.utente = ANONIMO;
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('senza conto collegato risponde «non collegato» e non chiama Stripe', async () => {
    stato.profilo = { data: { stripe_account_id: null }, error: null };
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: false, payouts_enabled: false });
    expect(stripeFinto.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('legge il conto da Stripe e aggiorna stripe_payouts_enabled sul profilo', async () => {
    stato.profilo = { data: { stripe_account_id: 'acct_123' }, error: null };
    stripeFinto.accountsRetrieve.mockResolvedValue({
      id: 'acct_123', charges_enabled: true, payouts_enabled: true, details_submitted: true,
      requirements: { currently_due: [], disabled_reason: null },
    });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, payouts_enabled: true, charges_enabled: true });
    expect(stripeFinto.accountsRetrieve).toHaveBeenCalledWith('acct_123');
    expect(stato.aggiornamenti).toEqual([{
      tabella: 'profiles',
      valori: { stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true },
    }]);
  });

  it('un conto non ancora abilitato scrive false, non true', async () => {
    stato.profilo = { data: { stripe_account_id: 'acct_123' }, error: null };
    stripeFinto.accountsRetrieve.mockResolvedValue({
      id: 'acct_123', charges_enabled: false, payouts_enabled: false, details_submitted: true,
      requirements: { currently_due: ['external_account'], disabled_reason: 'requirements.past_due' },
    });
    const res = await vai();
    expect(await res.json()).toMatchObject({ payouts_enabled: false, currently_due: ['external_account'] });
    expect(stato.aggiornamenti[0].valori.stripe_payouts_enabled).toBe(false);
  });

  it('503 se nessun profilo porta quel conto: non si risponde coi valori di Stripe', async () => {
    stato.profilo = { data: { stripe_account_id: 'acct_123' }, error: null };
    stato.contoRighe = 0;
    stripeFinto.accountsRetrieve.mockResolvedValue({ id: 'acct_123', payouts_enabled: true });
    expect((await vai()).status).toBe(503);
  });

  it('500 se Stripe stesso fallisce', async () => {
    stato.profilo = { data: { stripe_account_id: 'acct_123' }, error: null };
    stripeFinto.accountsRetrieve.mockRejectedValue(new Error('stripe giù'));
    expect((await vai()).status).toBe(500);
  });
});

describe('R06-009 · /api/stripe/payout (bonifico manuale)', () => {
  const vai = (intestazioni: Record<string, string> = { 'x-internal-secret': 'segreto-di-prova' }, corpo: unknown = { orderId: ORDINE }) =>
    chiama(payout, '/api/stripe/payout', intestazioni, corpo);

  it('senza x-internal-secret è rifiutato (403, non 401) e non paga', async () => {
    expect((await vai({})).status).toBe(403);
    expect((await vai({ 'x-internal-secret': 'sbagliato' })).status).toBe(403);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('503 se il segreto interno non è configurato: mai porta aperta', async () => {
    delete process.env.INTERNAL_API_SECRET;
    expect((await vai()).status).toBe(503);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('400 se l\'id dell\'ordine non è un UUID', async () => {
    expect((await vai(undefined, { orderId: 'non-un-uuid' })).status).toBe(400);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('409 e niente bonifico se c\'è un reso aperto', async () => {
    stato.resoAperto = true;
    expect((await vai()).status).toBe(409);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('bonifico riuscito: 200 col transferId nel contratto {ok, data}', async () => {
    stripeFinto.rilascio.mockResolvedValue({ ok: true, transferId: 'tr_1' });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { transferId: 'tr_1' } });
    expect(stripeFinto.rilascio).toHaveBeenCalledWith(ORDINE);
  });

  it('ordine rimborsato per intero: 200 senza trasferimento', async () => {
    stripeFinto.rilascio.mockResolvedValue({ ok: true, code: 'NOTHING_TO_PAY', reason: 'Rimborsato per intero' });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { transferId: null, nota: 'Rimborsato per intero' } });
  });

  it.each([
    ['NOT_FOUND', 404],
    ['INVALID_AMOUNT', 400],
    ['NOT_DELIVERED', 409],
    ['BAD_STATE', 409],
    ['SELLER_NOT_READY', 409],
    ['TRANSFER_FAILED', 500],
    ['RIDER_NOT_READY', 500],
  ])('il codice %s diventa %i', async (code, atteso) => {
    stripeFinto.rilascio.mockResolvedValue({ ok: false, code, reason: `motivo ${code}` });
    const res = await vai();
    expect(res.status).toBe(atteso);
    expect(JSON.stringify(await res.json())).toContain(`motivo ${code}`);
  });
});
