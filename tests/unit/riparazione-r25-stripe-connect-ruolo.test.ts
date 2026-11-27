import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R25-007 (26/11/2026) — Il collegamento a Stripe e il bonifico manuale: le prove di prima
 * non vedevano il controllo di RUOLO sul cruscotto Stripe (/api/stripe/connect/login).
 * Il 403 all'acquirente nasceva dal conto mancante, non dal ruolo: cambiando l'involucro
 * del negozio con quello «chiunque abbia accesso» restavano tutte verdi.
 *
 * Qui ogni persona finta HA un conto Stripe, così il 403 dipende solo da chi è. Il
 * database finto rispetta i filtri (eq, in, is): ogni rotta legge il profilo di CHI
 * CHIAMA e non un altro, e senza il filtro sull'id le righe diventano due e la lettura
 * cade. Gli involucri di autenticazione sono quelli veri; Stripe e database sono finti,
 * nessuna chiamata vera.
 *
 * Il negozio «in attesa» finto ha anche la data della richiesta (`approval_requested_at`):
 * con quella l'involucro «anche in attesa» lo farebbe entrare, quindi il 403 dipende solo
 * dall'approvazione e non da una data che manca. L'amministratore ha `approval_status`
 * vuoto, come sul database vero (migrazione 119): l'involucro del negozio lo lascia
 * passare, e il collegamento a Stripe lo ferma solo il controllo della verifica.
 */

type Riga = Record<string, unknown>;
type Utente = { id: string; email: string | null } | null;

const stato: { utente: Utente; profili: Riga[] } = { utente: null, profili: [] };

const stripeFinto = {
  accountsRetrieve: vi.fn(),
  linkOnboarding: vi.fn(),
  linkLogin: vi.fn(),
  rilascio: vi.fn(),
};

/** Un database finto che applica davvero i filtri, come farebbe PostgREST. */
function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let aggiorna: Riga | null = null;
  const esegui = (): Riga[] => {
    const righe = (nome === 'profiles' ? stato.profili : []).filter((r) => filtri.every((f) => f(r)));
    if (aggiorna) for (const r of righe) Object.assign(r, aggiorna);
    return righe.map((r) => ({ ...r }));
  };
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.limit = () => q;
  q.eq = (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; };
  q.in = (c: string, v: unknown[]) => { filtri.push((r) => v.includes(r[c])); return q; };
  q.is = (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; };
  q.update = (v: Riga) => { aggiorna = v; return q; };
  q.single = async () => {
    const righe = esegui();
    return righe.length === 1
      ? { data: righe[0], error: null }
      : { data: null, error: { code: 'PGRST116', message: `${righe.length} righe invece di una` } };
  };
  q.maybeSingle = async () => {
    const righe = esegui();
    return righe.length <= 1 ? { data: righe[0] ?? null, error: null } : { data: null, error: { code: 'PGRST116', message: 'troppe righe' } };
  };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
    Promise.resolve({ data: esegui(), error: null }).then(ok, ko);
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => stato.utente,
  getServerSupabase: async () => ({ from: (t: string) => tabella(t) }),
  getAdminSupabase: () => ({ from: (t: string) => tabella(t) }),
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
  createConnectOnboardingLink: async (a: { existingAccount?: string | null; salvaConto?: (id: string) => Promise<void> }) => {
    stripeFinto.linkOnboarding(a);
    await a.salvaConto?.(a.existingAccount ?? 'acct_nuovo');
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

const IO = 'u-io';
/** La data della richiesta di approvazione: c'è, così «in attesa» è una richiesta mandata davvero. */
const IN_ATTESA_DAL = '2026-11-20T09:00:00.000Z';
/** Chi chiama: ogni ruolo ha già un conto Stripe suo, così il conto non decide niente. */
const io = (ruolo: string, altro: Riga = {}) => {
  stato.profili[0] = {
    id: IO, role: ruolo, is_approved: true, approval_status: 'approved',
    stripe_account_id: 'acct_mio', store_name: 'Forno', ...altro,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  stato.utente = { id: IO, email: 'io@example.com' };
  stato.profili = [
    {},
    // Un altro negozio, approvato e collegato: la rotta non deve mai leggere lui.
    { id: 'u-altro', role: 'seller', is_approved: true, approval_status: 'approved', stripe_account_id: 'acct_altrui', store_name: 'Altro' },
  ];
  io('seller');
  process.env.INTERNAL_API_SECRET = 'segreto-di-prova';
});

describe('R25-007 · /api/stripe/connect/login: il 403 viene dal ruolo, non dal conto mancante', () => {
  const vai = () => chiama(login, '/api/stripe/connect/login');

  it.each(['buyer', 'rider'])('un %s CON un conto Stripe riceve 403 e nessun link', async (ruolo) => {
    io(ruolo);
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('un negozio in attesa con la richiesta mandata, anche col conto, riceve 403', async () => {
    io('seller', { is_approved: false, approval_status: 'pending', approval_requested_at: IN_ATTESA_DAL });
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('il negozio approvato riceve il link del SUO conto, non quello di un altro', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(stripeFinto.linkLogin).toHaveBeenCalledTimes(1);
    expect(stripeFinto.linkLogin).toHaveBeenCalledWith('acct_mio');
  });
});

describe('R25-007 · /api/stripe/connect/onboarding: solo il negozio approvato, con la sua email', () => {
  const vai = () => chiama(onboarding, '/api/stripe/connect/onboarding');

  it.each(['buyer', 'rider'])('un %s con la verifica «approved» sul profilo riceve 403', async (ruolo) => {
    io(ruolo);
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('un negozio in attesa con la richiesta mandata riceve 403 e nessun collegamento', async () => {
    io('seller', { is_approved: false, approval_status: 'pending', approval_requested_at: IN_ATTESA_DAL });
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it("l'amministratore, senza verifica del negozio, riceve 403 e nessun conto Stripe a suo nome", async () => {
    io('admin', { is_approved: true, approval_status: null });
    const res = await vai();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'FORBIDDEN', message: expect.stringContaining('verifica KYC') } });
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('senza email non si apre il collegamento (401)', async () => {
    stato.utente = { id: IO, email: null };
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('il negozio approvato riparte dal SUO conto', async () => {
    expect((await vai()).status).toBe(200);
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({ sellerId: IO, existingAccount: 'acct_mio' });
  });
});

describe('R25-007 · /api/stripe/connect/rider-onboarding: solo il fattorino, con la sua email', () => {
  const vai = () => chiama(riderOnboarding, '/api/stripe/connect/rider-onboarding');
  beforeEach(() => io('rider'));

  it.each(['buyer', 'seller'])('un %s con un conto riceve 403', async (ruolo) => {
    io(ruolo);
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('senza email non si apre il collegamento (401)', async () => {
    stato.utente = { id: IO, email: null };
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('il fattorino riparte dal SUO conto', async () => {
    expect((await vai()).status).toBe(200);
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({ sellerId: IO, existingAccount: 'acct_mio', ruolo: 'fattorino' });
  });
});

describe('R25-007 · /api/stripe/connect/refresh-status: ognuno legge solo il proprio conto', () => {
  const vai = () => chiama(refreshStatus, '/api/stripe/connect/refresh-status');

  it('senza conto suo risponde «non collegato», anche se un altro profilo è collegato', async () => {
    io('seller', { stripe_account_id: null });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: false });
    expect(stripeFinto.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('il fattorino (anche lui collegato a Stripe) legge il SUO conto', async () => {
    io('rider');
    stripeFinto.accountsRetrieve.mockResolvedValue({
      id: 'acct_mio', charges_enabled: false, payouts_enabled: true, details_submitted: true,
      requirements: { currently_due: [], disabled_reason: null },
    });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, payouts_enabled: true });
    expect(stripeFinto.accountsRetrieve).toHaveBeenCalledTimes(1);
    expect(stripeFinto.accountsRetrieve).toHaveBeenCalledWith('acct_mio');
    expect(stato.profili[1]).not.toHaveProperty('stripe_payouts_enabled');
  });
});

describe('R25-007 · /api/stripe/payout: una sessione da negozio o da amministratore non basta', () => {
  it.each(['seller', 'admin'])('un %s collegato senza x-internal-secret riceve 403 e non paga', async (ruolo) => {
    io(ruolo);
    const res = await chiama(payout, '/api/stripe/payout', {}, { orderId: '11111111-1111-4111-8111-111111111111' });
    expect(res.status).toBe(403);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });
});
