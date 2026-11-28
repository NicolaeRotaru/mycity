import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * IL COLLEGAMENTO A STRIPE: OGNI CONTROLLO DI RUOLO SI VEDE DA SOLO.
 *
 * Le quattro rotte del collegamento (negozio, fattorino, cruscotto, stato del conto) con gli
 * involucri di autenticazione veri, Stripe finto e un database finto che ricorda su quale riga
 * legge e scrive. Ogni rifiuto qui ha un solo motivo possibile: l'acquirente che chiede il
 * cruscotto ha un conto collegato, quindi il 403 viene dal ruolo e non dal conto che manca.
 */

type Utente = { id: string; email: string | undefined } | null;
type Filtri = Array<[string, unknown]>;
const stato: {
  utente: Utente;
  ruolo: { role: string; is_approved: boolean };
  profilo: { data: Record<string, unknown> | null; error: unknown };
  contoRighe: number;
  stripeAcceso: boolean;
  letture: Array<{ colonne: string; filtri: Filtri }>;
  aggiornamenti: Array<{ valori: Record<string, unknown>; filtri: Filtri }>;
} = {
  utente: null, ruolo: { role: 'seller', is_approved: true }, profilo: { data: null, error: null },
  contoRighe: 1, stripeAcceso: true, letture: [], aggiornamenti: [],
};

const stripeFinto = {
  accountsRetrieve: vi.fn(),
  linkOnboarding: vi.fn(),
  linkLogin: vi.fn(),
  erroreOnboarding: null as Error | null,
};

/** Il client della persona: legge il suo profilo, e ricorda colonne e filtri. */
function clientDellaPersona() {
  return {
    from: () => {
      const lettura = { colonne: '', filtri: [] as Filtri };
      const q = {
        select(c: string) { lettura.colonne = c; return q; },
        eq(c: string, v: unknown) { lettura.filtri.push([c, v]); return q; },
        async single() { stato.letture.push(lettura); return stato.profilo; },
      };
      return q;
    },
  };
}

/** Il client di servizio: il ruolo per l'involucro, e le scritture sul profilo coi loro filtri. */
function clientDiServizio() {
  return {
    from: () => {
      let valori: Record<string, unknown> | null = null;
      const filtri: Filtri = [];
      const fine = () => {
        if (valori) {
          stato.aggiornamenti.push({ valori, filtri });
          return { data: Array.from({ length: stato.contoRighe }, (_, i) => ({ id: `r${i}` })), error: null };
        }
        return { data: { id: stato.utente?.id, ...stato.ruolo }, error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (c: string, v: unknown) => { filtri.push([c, v]); return q; };
      q.update = (v: Record<string, unknown>) => { valori = v; return q; };
      q.single = async () => fine();
      q.maybeSingle = async () => fine();
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(fine()).then(ok, ko);
      return q;
    },
  };
}

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => stato.utente,
  getServerSupabase: async () => clientDellaPersona(),
  getAdminSupabase: () => clientDiServizio(),
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
  isStripeConfigured: () => stato.stripeAcceso,
  getStripe: () => ({ accounts: { retrieve: stripeFinto.accountsRetrieve } }),
  createConnectOnboardingLink: async (a: { salvaConto?: (id: string) => Promise<void> }) => {
    stripeFinto.linkOnboarding(a);
    if (stripeFinto.erroreOnboarding) throw stripeFinto.erroreOnboarding;
    await a.salvaConto?.('acct_finto');
    return { url: 'https://connect.stripe.test/onboarding/abc' };
  },
  createConnectLoginLink: async (id: string) => {
    stripeFinto.linkLogin(id);
    return { url: 'https://connect.stripe.test/login/abc' };
  },
}));

import { POST as onboarding } from '@/app/api/stripe/connect/onboarding/route';
import { POST as refreshStatus } from '@/app/api/stripe/connect/refresh-status/route';
import { POST as login } from '@/app/api/stripe/connect/login/route';
import { POST as riderOnboarding } from '@/app/api/stripe/connect/rider-onboarding/route';

type Rotta = (req: NextRequest) => Promise<Response>;
const chiama = (rotta: unknown, percorso: string) =>
  (rotta as Rotta)(new NextRequest(`http://localhost${percorso}`, { method: 'POST', headers: { 'content-type': 'application/json' } }));

const PERSONA = { id: 'u-1', email: 'persona@example.com' };
const ACQUIRENTE = { role: 'buyer', is_approved: false };
const NEGOZIO = { role: 'seller', is_approved: true };
const NEGOZIO_NON_APPROVATO = { role: 'seller', is_approved: false };
const FATTORINO = { role: 'rider', is_approved: true };
const AMMINISTRATORE = { role: 'admin', is_approved: true };
/** Il profilo che passerebbe ogni controllo della rotta: approvato, con un conto collegato. */
const PROFILO_PIENO = { approval_status: 'approved', stripe_account_id: 'acct_123', store_name: 'Forno' };

const letturaDelProprioProfilo = () => expect(stato.letture).toEqual([expect.objectContaining({ filtri: [['id', 'u-1']] })]);

beforeEach(() => {
  vi.clearAllMocks();
  stato.utente = { ...PERSONA };
  stato.ruolo = { ...NEGOZIO };
  stato.profilo = { data: { ...PROFILO_PIENO }, error: null };
  stato.contoRighe = 1;
  stato.stripeAcceso = true;
  stato.letture = [];
  stato.aggiornamenti = [];
  stripeFinto.erroreOnboarding = null;
});

describe('/api/stripe/connect/login (cruscotto Stripe del negozio)', () => {
  const vai = () => chiama(login, '/api/stripe/connect/login');

  it('un acquirente CON un conto collegato riceve 403: lo ferma il ruolo, non il conto', async () => {
    stato.ruolo = { ...ACQUIRENTE };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('un negozio non approvato, col conto collegato, riceve 403', async () => {
    stato.ruolo = { ...NEGOZIO_NON_APPROVATO };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('negozio approvato senza conto: 403 e nessun link chiesto a Stripe', async () => {
    stato.profilo = { data: { ...PROFILO_PIENO, stripe_account_id: null }, error: null };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('profilo non letto: 404', async () => {
    stato.profilo = { data: null, error: { message: 'giù' } };
    expect((await vai()).status).toBe(404);
  });

  it('negozio approvato col conto: link monouso del SUO conto, letto dal SUO profilo', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/login/abc' });
    expect(stripeFinto.linkLogin).toHaveBeenCalledWith('acct_123');
    letturaDelProprioProfilo();
  });

  it('Stripe non configurato: 503 prima di tutto', async () => {
    stato.stripeAcceso = false;
    expect((await vai()).status).toBe(503);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });
});

describe('/api/stripe/connect/onboarding (negozio)', () => {
  const vai = () => chiama(onboarding, '/api/stripe/connect/onboarding');

  it('401 senza sessione', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('acquirente e fattorino, col profilo approvato, ricevono 403', async () => {
    for (const ruolo of [ACQUIRENTE, FATTORINO]) {
      stato.ruolo = { ...ruolo };
      expect((await vai()).status).toBe(403);
    }
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('negozio con la verifica non approvata: 403', async () => {
    stato.profilo = { data: { ...PROFILO_PIENO, approval_status: 'pending' }, error: null };
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('il percorso buono: il link, e il conto nuovo salvato sul profilo di chi chiama', async () => {
    stato.profilo = { data: { ...PROFILO_PIENO, stripe_account_id: null }, error: null };
    const res = await vai();
    expect(res.status).toBe(200);
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({ sellerId: 'u-1', existingAccount: null, ruolo: 'venditore' });
    expect(stato.aggiornamenti).toEqual([
      { valori: expect.objectContaining({ stripe_account_id: 'acct_finto', stripe_payouts_enabled: false }), filtri: [['id', 'u-1']] },
    ]);
    letturaDelProprioProfilo();
  });

  it('il conto nuovo non si è potuto salvare: 503', async () => {
    stato.contoRighe = 0;
    expect((await vai()).status).toBe(503);
  });

  it('conto del profilo sconosciuto alla chiave di prova: 409 con la spiegazione', async () => {
    stripeFinto.erroreOnboarding = Object.assign(new Error('No such account'), { name: 'ContoSconosciutoAllaChiaveDiProva' });
    expect((await vai()).status).toBe(409);
  });

  it('Stripe che sbaglia: 500; Stripe spento: 503', async () => {
    stripeFinto.erroreOnboarding = new Error('stripe giù');
    expect((await vai()).status).toBe(500);
    stato.stripeAcceso = false;
    expect((await vai()).status).toBe(503);
  });

  it('una sessione senza email non manda a Stripe', async () => {
    stato.utente = { id: 'u-1', email: undefined };
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });
});

describe('/api/stripe/connect/rider-onboarding (fattorino)', () => {
  const vai = () => chiama(riderOnboarding, '/api/stripe/connect/rider-onboarding');
  beforeEach(() => {
    stato.ruolo = { ...FATTORINO };
    stato.profilo = { data: { stripe_account_id: null }, error: null };
  });

  it('401 senza sessione', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
  });

  it('acquirente e negozio approvato ricevono 403', async () => {
    for (const ruolo of [ACQUIRENTE, NEGOZIO]) {
      stato.ruolo = { ...ruolo };
      expect((await vai()).status).toBe(403);
    }
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('il fattorino: link da fattorino, conto salvato sul suo profilo', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({ sellerId: 'u-1', ruolo: 'fattorino' });
    expect(stato.aggiornamenti[0].filtri).toEqual([['id', 'u-1']]);
    letturaDelProprioProfilo();
  });

  it('l amministratore passa', async () => {
    stato.ruolo = { ...AMMINISTRATORE };
    expect((await vai()).status).toBe(200);
  });

  it('conto non salvato: 503; Stripe spento: 503', async () => {
    stato.contoRighe = 0;
    expect((await vai()).status).toBe(503);
    stato.contoRighe = 1;
    stato.stripeAcceso = false;
    expect((await vai()).status).toBe(503);
  });
});

describe('/api/stripe/connect/refresh-status', () => {
  const vai = () => chiama(refreshStatus, '/api/stripe/connect/refresh-status');
  const contoAbilitato = {
    id: 'acct_123', charges_enabled: true, payouts_enabled: true, details_submitted: true,
    requirements: { currently_due: [], disabled_reason: null },
  };

  it('401 senza sessione, e Stripe non si chiama', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('legge il conto del PROPRIO profilo e scrive lo stato sul profilo che porta quel conto', async () => {
    stripeFinto.accountsRetrieve.mockResolvedValue(contoAbilitato);
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, payouts_enabled: true });
    letturaDelProprioProfilo();
    expect(stripeFinto.accountsRetrieve).toHaveBeenCalledWith('acct_123');
    expect(stato.aggiornamenti).toEqual([
      { valori: { stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true }, filtri: [['stripe_account_id', 'acct_123']] },
    ]);
  });

  it('vale per ogni ruolo collegato: anche il fattorino aggiorna il suo stato', async () => {
    stato.ruolo = { ...FATTORINO };
    stripeFinto.accountsRetrieve.mockResolvedValue(contoAbilitato);
    expect((await vai()).status).toBe(200);
  });

  it('profilo non letto: 404; Stripe spento: 503', async () => {
    stato.profilo = { data: null, error: { message: 'giù' } };
    expect((await vai()).status).toBe(404);
    stato.stripeAcceso = false;
    expect((await vai()).status).toBe(503);
  });

  it('nessun profilo porta quel conto: 503, non si risponde coi valori di Stripe', async () => {
    stato.contoRighe = 0;
    stripeFinto.accountsRetrieve.mockResolvedValue(contoAbilitato);
    expect((await vai()).status).toBe(503);
  });

  it('Stripe che sbaglia: 500', async () => {
    stripeFinto.accountsRetrieve.mockRejectedValue(new Error('stripe giù'));
    expect((await vai()).status).toBe(500);
  });
});
