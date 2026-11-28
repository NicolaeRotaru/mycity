import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * R12-011 (27/11/2026) — LE ROTTE DEL COLLEGAMENTO A STRIPE, CON UN DATABASE CHE GUARDA I FILTRI.
 *
 * La prova di prima (riparazione-r06-stripe-connect-rotte) aveva un database finto che
 * rispondeva lo stesso profilo qualunque fosse il filtro: una rotta che avesse letto o
 * scritto il profilo di un altro, o un reso di un altro ordine, restava verde. Qui le
 * stesse cose che voleva provare quella prova si provano con un database finto che
 * applica DAVVERO i filtri (eq, neq, in, is, limit) a tabelle con più righe: il mio
 * profilo accanto a quello di un altro negozio, il mio ordine accanto a un altro con un
 * reso aperto. `single()` con zero o due righe cade come cade PostgREST (PGRST116).
 *
 * Gli involucri di autenticazione sono quelli veri; Stripe e database sono finti, nessuna
 * chiamata vera. L'orologio è finto: l'attesa del bonifico si misura da una data fissa.
 *
 * Onda 2 (28/11/2026): il finto restituisce solo le colonne chieste in `select()`, registra ogni
 * aggiornamento coi valori esatti (`toEqual`, come faceva la prova di prima), e sul MIO ordine ci
 * sono un reclamo già chiuso, una contestazione in banca e un reclamo interno. Sei mutanti che la
 * versione di prima lasciava verdi (filtro di stato dei reclami tolto, contestazione e reclamo
 * interno ignorati, `delivered_at` non chiesto, un campo in più sul profilo) adesso sono rossi.
 * La prova di prima (riparazione-r06-stripe-connect-rotte) è tolta: tutti i suoi casi stanno qui.
 */

type Riga = Record<string, unknown>;
type Utente = { id: string; email: string | null } | null;

const stato: {
  utente: Utente;
  tabelle: Record<string, Riga[]>;
  /** Le righe che il database rifiuta di aggiornare (una regola, un grilletto): l'aggiornamento torna vuoto. */
  bloccate: Set<unknown>;
  /** Ogni aggiornamento chiesto, coi valori esatti: un campo in più scritto sul profilo si vede. */
  aggiornamenti: Array<{ tabella: string; valori: Riga }>;
} = { utente: null, tabelle: {}, bloccate: new Set(), aggiornamenti: [] };

const stripeFinto = {
  accountsRetrieve: vi.fn(),
  linkOnboarding: vi.fn(),
  linkLogin: vi.fn(),
  rilascio: vi.fn(),
};

/**
 * Una tabella finta che applica i filtri come PostgREST, e come PostgREST restituisce solo le
 * colonne chieste in `select()` (onda 2: prima tornava la riga intera, e una rotta che non chiedeva
 * `delivered_at` saltava l'ora d'attesa del bonifico senza che la prova se ne accorgesse).
 */
function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let aggiorna: Riga | null = null;
  let conSelect = false;
  let colonne: string[] | null = null;
  let tetto: number | null = null;
  const righe = (): Riga[] => {
    const tutte = stato.tabelle[nome] ?? [];
    const scelte = tutte.filter((r) => filtri.every((f) => f(r)));
    return tetto === null ? scelte : scelte.slice(0, tetto);
  };
  const proietta = (r: Riga): Riga =>
    colonne === null ? { ...r } : Object.fromEntries(colonne.filter((c) => c in r).map((c) => [c, r[c]]));
  const esegui = (): { data: unknown; error: unknown } => {
    if (aggiorna) {
      stato.aggiornamenti.push({ tabella: nome, valori: { ...aggiorna } });
      const toccate = righe().filter((r) => !stato.bloccate.has(r.id));
      for (const r of toccate) Object.assign(r, aggiorna);
      // Come supabase-js: senza .select() dopo l'aggiornamento non torna nessuna riga.
      return { data: conSelect ? toccate.map(proietta) : null, error: null };
    }
    return { data: righe().map(proietta), error: null };
  };
  const q: Record<string, unknown> = {};
  q.select = (elenco?: string) => {
    conSelect = true;
    const chieste = String(elenco ?? '*').split(',').map((c) => c.trim()).filter(Boolean);
    colonne = chieste.includes('*') ? null : chieste;
    return q;
  };
  q.eq = (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; };
  q.neq = (c: string, v: unknown) => { filtri.push((r) => r[c] !== v); return q; };
  q.in = (c: string, v: readonly unknown[]) => { filtri.push((r) => v.includes(r[c])); return q; };
  q.is = (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; };
  q.limit = (n: number) => { tetto = n; return q; };
  q.update = (v: Riga) => { aggiorna = v; return q; };
  q.single = async () => {
    const { data, error } = esegui();
    const elenco = (data ?? []) as Riga[];
    if (error) return { data: null, error };
    return elenco.length === 1
      ? { data: elenco[0], error: null }
      : { data: null, error: { code: 'PGRST116', message: `${elenco.length} righe invece di una` } };
  };
  q.maybeSingle = async () => {
    const { data, error } = esegui();
    const elenco = (data ?? []) as Riga[];
    if (error) return { data: null, error };
    return elenco.length <= 1
      ? { data: elenco[0] ?? null, error: null }
      : { data: null, error: { code: 'PGRST116', message: 'più di una riga' } };
  };
  q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko);
  return q;
}

vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => stato.utente,
  // Il client «della persona» e quello di servizio leggono lo stesso database finto: cosa
  // esce lo decidono solo i filtri scritti nella rotta.
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
const ALTRO = 'u-altro';
const ORDINE = '11111111-1111-4111-8111-111111111111';
const ALTRO_ORDINE = '22222222-2222-4222-8222-222222222222';
const ADESSO = new Date('2026-11-27T10:00:00.000Z');

const mio = () => stato.tabelle.profiles.find((r) => r.id === IO)!;
const altrui = () => stato.tabelle.profiles.find((r) => r.id === ALTRO)!;
/** Il mio profilo: si cambiano solo i campi dati, il resto resta quello del negozio approvato. */
const io = (campi: Riga) => Object.assign(mio(), campi);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  stato.utente = { id: IO, email: 'negozio@example.com' };
  stato.bloccate = new Set();
  stato.aggiornamenti = [];
  stato.tabelle = {
    profiles: [
      // Il profilo di un altro, approvato e collegato, MESSO PRIMA del mio: una rotta che lo
      // leggesse al posto del mio, o che lo aggiornasse, si vede.
      { id: ALTRO, role: 'seller', is_approved: true, approval_status: 'approved', stripe_account_id: 'acct_altrui', store_name: 'Altro', stripe_payouts_enabled: true },
      { id: IO, role: 'seller', is_approved: true, approval_status: 'approved', stripe_account_id: null, store_name: 'Forno' },
    ],
    orders: [
      { id: ALTRO_ORDINE, dispute_status: 'OPEN', internal_dispute_status: 'OPEN', delivered_at: '2026-11-27T09:59:00.000Z' },
      { id: ORDINE, dispute_status: null, internal_dispute_status: null, delivered_at: '2026-11-20T08:00:00.000Z' },
    ],
    // Resi e reclami aperti ci sono, ma su un altro ordine; sul mio solo un reso e un reclamo già chiusi.
    returns: [
      { id: 'reso-altrui', order_id: ALTRO_ORDINE, status: 'REQUESTED' },
      { id: 'reso-chiuso', order_id: ORDINE, status: 'REJECTED' },
    ],
    // Sul mio ordine un reclamo già CHIUSO: non deve fermare niente (si contano solo quelli aperti).
    disputes: [
      { id: 'reclamo-altrui', order_id: ALTRO_ORDINE, status: 'open' },
      { id: 'reclamo-chiuso', order_id: ORDINE, status: 'resolved_seller' },
    ],
  };
  process.env.INTERNAL_API_SECRET = 'segreto-di-prova';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('R12-011 · /api/stripe/connect/onboarding (negozio)', () => {
  const vai = () => chiama(onboarding, '/api/stripe/connect/onboarding');

  it('401 senza sessione', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('403 a un acquirente e a un negozio non approvato, anche se l’altro negozio è approvato', async () => {
    io({ role: 'buyer', is_approved: false });
    expect((await vai()).status).toBe(403);
    io({ role: 'seller', is_approved: false });
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('403 se la verifica KYC del MIO negozio non è approvata (quella dell’altro sì)', async () => {
    io({ approval_status: 'pending' });
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('crea il link con Stripe finto e salva il conto sul MIO profilo, non su quello dell’altro', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/onboarding/abc' });
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({
      sellerId: IO,
      sellerEmail: 'negozio@example.com',
      existingAccount: null,
      ruolo: 'venditore',
      returnUrl: 'https://mycity.test/seller/dashboard?stripe=connected',
      refreshUrl: 'https://mycity.test/seller/dashboard?stripe=refresh',
    });
    expect(mio()).toMatchObject({ stripe_account_id: 'acct_nuovo', stripe_payouts_enabled: false });
    expect(altrui()).toMatchObject({ stripe_account_id: 'acct_altrui', stripe_payouts_enabled: true });
    expect(stato.aggiornamenti).toEqual([{
      tabella: 'profiles',
      valori: { stripe_account_id: 'acct_nuovo', stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false },
    }]);
  });

  it('riparte dal MIO conto già collegato, non da quello dell’altro', async () => {
    io({ stripe_account_id: 'acct_vecchio' });
    expect((await vai()).status).toBe(200);
    expect(stripeFinto.linkOnboarding.mock.calls[0][0].existingAccount).toBe('acct_vecchio');
  });

  it('503 se il conto non si è potuto salvare sul mio profilo: il link non esce', async () => {
    stato.bloccate.add(IO);
    const res = await vai();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('connect.stripe.test');
    expect(altrui().stripe_account_id).toBe('acct_altrui');
  });
});

describe('R12-011 · /api/stripe/connect/rider-onboarding (fattorino)', () => {
  const vai = () => chiama(riderOnboarding, '/api/stripe/connect/rider-onboarding');
  beforeEach(() => io({ role: 'rider' }));

  it('401 senza sessione', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
  });

  it('403 a un acquirente e a un negozio', async () => {
    io({ role: 'buyer', is_approved: false });
    expect((await vai()).status).toBe(403);
    io({ role: 'seller', is_approved: true });
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkOnboarding).not.toHaveBeenCalled();
  });

  it('crea il link per il fattorino e salva il conto sul SUO profilo', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/onboarding/abc' });
    expect(stripeFinto.linkOnboarding.mock.calls[0][0]).toMatchObject({
      sellerId: IO,
      existingAccount: null,
      ruolo: 'fattorino',
      returnUrl: 'https://mycity.test/rider/earnings?stripe=connected',
    });
    expect(mio().stripe_account_id).toBe('acct_nuovo');
    expect(altrui().stripe_account_id).toBe('acct_altrui');
  });
});

describe('R12-011 · /api/stripe/connect/login (cruscotto Stripe del negozio)', () => {
  const vai = () => chiama(login, '/api/stripe/connect/login');

  it('401 senza sessione', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
  });

  it('403 a un acquirente, anche col conto collegato', async () => {
    io({ role: 'buyer', is_approved: false, stripe_account_id: 'acct_mio' });
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('403 se il MIO negozio non ha un conto, anche se quello dell’altro ce l’ha', async () => {
    expect((await vai()).status).toBe(403);
    expect(stripeFinto.linkLogin).not.toHaveBeenCalled();
  });

  it('con un conto collegato dà il link del MIO conto', async () => {
    io({ stripe_account_id: 'acct_mio' });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://connect.stripe.test/login/abc' });
    expect(stripeFinto.linkLogin).toHaveBeenCalledTimes(1);
    expect(stripeFinto.linkLogin).toHaveBeenCalledWith('acct_mio');
  });
});

describe('R12-011 · /api/stripe/connect/refresh-status', () => {
  const vai = () => chiama(refreshStatus, '/api/stripe/connect/refresh-status');

  it('401 senza sessione', async () => {
    stato.utente = null;
    expect((await vai()).status).toBe(401);
    expect(stripeFinto.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('senza un conto MIO risponde «non collegato» e non chiama Stripe, anche se l’altro è collegato', async () => {
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: false, payouts_enabled: false });
    expect(stripeFinto.accountsRetrieve).not.toHaveBeenCalled();
  });

  it('legge il MIO conto da Stripe e aggiorna il MIO profilo, non quello dell’altro', async () => {
    io({ stripe_account_id: 'acct_mio' });
    stripeFinto.accountsRetrieve.mockResolvedValue({
      id: 'acct_mio', charges_enabled: true, payouts_enabled: true, details_submitted: true,
      requirements: { currently_due: [], disabled_reason: null },
    });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true, payouts_enabled: true, charges_enabled: true });
    expect(stripeFinto.accountsRetrieve).toHaveBeenCalledTimes(1);
    expect(stripeFinto.accountsRetrieve).toHaveBeenCalledWith('acct_mio');
    expect(mio()).toMatchObject({ stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true });
    expect(altrui()).not.toHaveProperty('stripe_charges_enabled');
    // Esattamente i tre flag, niente di più: un campo in più scritto sul profilo è un difetto.
    expect(stato.aggiornamenti).toEqual([{
      tabella: 'profiles',
      valori: { stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true },
    }]);
  });

  it('un conto non ancora abilitato scrive false sul mio profilo, e l’altro resta com’era', async () => {
    io({ stripe_account_id: 'acct_mio' });
    stripeFinto.accountsRetrieve.mockResolvedValue({
      id: 'acct_mio', charges_enabled: false, payouts_enabled: false, details_submitted: true,
      requirements: { currently_due: ['external_account'], disabled_reason: 'requirements.past_due' },
    });
    const res = await vai();
    expect(await res.json()).toMatchObject({ payouts_enabled: false, currently_due: ['external_account'] });
    expect(mio().stripe_payouts_enabled).toBe(false);
    expect(altrui().stripe_payouts_enabled).toBe(true);
  });

  it('503 se nessun profilo porta il conto che Stripe ha risposto: non si risponde coi suoi valori', async () => {
    io({ stripe_account_id: 'acct_mio' });
    stripeFinto.accountsRetrieve.mockResolvedValue({ id: 'acct_sconosciuto', payouts_enabled: true });
    expect((await vai()).status).toBe(503);
    expect(mio()).not.toHaveProperty('stripe_payouts_enabled');
    expect(altrui().stripe_payouts_enabled).toBe(true);
  });

  it('500 se Stripe stesso fallisce', async () => {
    io({ stripe_account_id: 'acct_mio' });
    stripeFinto.accountsRetrieve.mockRejectedValue(new Error('stripe giù'));
    expect((await vai()).status).toBe(500);
  });
});

describe('R12-011 · /api/stripe/payout (bonifico manuale)', () => {
  const vai = (intestazioni: Record<string, string> = { 'x-internal-secret': 'segreto-di-prova' }, corpo: unknown = { orderId: ORDINE }) =>
    chiama(payout, '/api/stripe/payout', intestazioni, corpo);

  it('senza x-internal-secret, o con quello sbagliato, è rifiutato (403) e non paga', async () => {
    expect((await vai({})).status).toBe(403);
    expect((await vai({ 'x-internal-secret': 'sbagliato' })).status).toBe(403);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('503 se il segreto interno non è configurato: mai porta aperta', async () => {
    delete process.env.INTERNAL_API_SECRET;
    expect((await vai()).status).toBe(503);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('400 se l’id dell’ordine non è un UUID', async () => {
    expect((await vai(undefined, { orderId: 'non-un-uuid' })).status).toBe(400);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('resi, reclami e contestazioni di UN ALTRO ordine, e un reso già chiuso del mio, non fermano il bonifico', async () => {
    stripeFinto.rilascio.mockResolvedValue({ ok: true, transferId: 'tr_1' });
    const res = await vai();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: { transferId: 'tr_1' } });
    expect(stripeFinto.rilascio).toHaveBeenCalledWith(ORDINE);
  });

  it('409 e niente bonifico se c’è un reso aperto sul MIO ordine', async () => {
    stato.tabelle.returns.push({ id: 'reso-mio', order_id: ORDINE, status: 'SHIPPED_BACK' });
    expect((await vai()).status).toBe(409);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('409 e niente bonifico se c’è un reclamo aperto sul MIO ordine', async () => {
    stato.tabelle.disputes.push({ id: 'reclamo-mio', order_id: ORDINE, status: 'under_review' });
    expect((await vai()).status).toBe(409);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
  });

  it('409 e niente bonifico se c’è una contestazione in banca aperta sul MIO ordine; vinta, si paga', async () => {
    const mioOrdine = stato.tabelle.orders.find((o) => o.id === ORDINE)!;
    mioOrdine.dispute_status = 'OPEN';
    expect((await vai()).status).toBe(409);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
    mioOrdine.dispute_status = 'WON';
    stripeFinto.rilascio.mockResolvedValue({ ok: true, transferId: 'tr_1' });
    expect((await vai()).status).toBe(200);
  });

  it('409 e niente bonifico se c’è un reclamo interno aperto sul MIO ordine; risolto, si paga', async () => {
    const mioOrdine = stato.tabelle.orders.find((o) => o.id === ORDINE)!;
    mioOrdine.internal_dispute_status = 'OPEN';
    expect((await vai()).status).toBe(409);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
    mioOrdine.internal_dispute_status = 'RESOLVED';
    stripeFinto.rilascio.mockResolvedValue({ ok: true, transferId: 'tr_1' });
    expect((await vai()).status).toBe(200);
  });

  it('409 se il MIO ordine è stato consegnato meno di un’ora fa (orologio finto)', async () => {
    stato.tabelle.orders.find((o) => o.id === ORDINE)!.delivered_at = '2026-11-27T09:30:00.000Z';
    expect((await vai()).status).toBe(409);
    expect(stripeFinto.rilascio).not.toHaveBeenCalled();
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
