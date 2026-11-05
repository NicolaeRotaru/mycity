import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — il collegamento del negozio e del fattorino a Stripe.
 *  · 28: se il conto non si salva sul profilo, la rotta non manda a Stripe (503);
 *    refresh-status non risponde «collegato» se lo stato non si registra.
 *  · 2067: l'id si salva appena il conto nasce, prima del link: un link fallito
 *    non lascia un conto che il profilo non conosce.
 */
const st = vi.hoisted(() => ({
  scritturaCade: false,
  righe: 1,
  creati: 0,
  link: 0,
  linkCade: false,
  profilo: { approval_status: 'approved', stripe_account_id: null as string | null, store_name: 'Forno' },
  salvati: [] as string[],
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuthRateLimit: (_o: unknown, h: (c: { user: { id: string; email: string } }) => unknown) => () =>
    h({ user: { id: 'forno', email: 'forno@esempio.it' } }),
  withAuthRateLimit: (_o: unknown, h: (c: { user: { id: string; email: string } }) => unknown) => () =>
    h({ user: { id: 'forno', email: 'forno@esempio.it' } }),
}));
// Il modulo vero di lib/stripe/client, con la libreria Stripe finta sotto.
vi.mock('stripe', () => ({
  default: class {
    accounts = {
      create: async () => ((st.creati += 1), { id: 'acct_nuovo' }),
      retrieve: async (id: string) => {
        if (id === 'acct_vecchio') throw Object.assign(new Error('No such account'), { code: 'resource_missing', statusCode: 404 });
        return { id, charges_enabled: true, payouts_enabled: true, details_submitted: true };
      },
    };
    accountLinks = {
      create: async () => {
        st.link += 1;
        if (st.linkCade) throw new Error('rete');
        return { url: 'https://connect.stripe.com/x' };
      },
    };
  },
}));
vi.mock('@/lib/supabase/server', () => {
  const update = (v: Record<string, unknown>) => {
    const q: Record<string, unknown> = {};
    q.eq = () => q;
    q.select = async () => {
      if (st.scritturaCade) return { data: null, error: { message: 'timeout' } };
      if (v.stripe_account_id) st.salvati.push(String(v.stripe_account_id));
      return { data: Array.from({ length: st.righe }, () => ({ id: 'forno' })), error: null };
    };
    return q;
  };
  const client = {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: st.profilo, error: null }) }) }),
      update,
    }),
  };
  return { getServerSupabase: async () => client, getAdminSupabase: () => client };
});

import { POST as collegaNegozio } from '@/app/api/stripe/connect/onboarding/route';
import { POST as aggiornaStato } from '@/app/api/stripe/connect/refresh-status/route';

const chiama = async (f: unknown) => {
  const r = await (f as () => Promise<Response>)();
  return { status: r.status, corpo: await r.json() };
};

beforeEach(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_finta');
  Object.assign(st, { scritturaCade: false, righe: 1, creati: 0, link: 0, linkCade: false, salvati: [] });
  st.profilo = { approval_status: 'approved', stripe_account_id: null, store_name: 'Forno' };
});

describe('28 — il conto che non si salva non manda a Stripe', () => {
  it('scrittura del profilo caduta: 503 e nessun link', async () => {
    st.scritturaCade = true;
    const r = await chiama(collegaNegozio);
    expect(r.status).toBe(503);
    expect(st.link).toBe(0);
  });
  it('controprova: si salva e si manda a Stripe', async () => {
    const r = await chiama(collegaNegozio);
    expect(r.status).toBe(200);
    expect(st.salvati).toEqual(['acct_nuovo']);
  });
  it('refresh-status: nessun profilo aggiornato → 503, non «collegato»', async () => {
    st.profilo = { ...st.profilo, stripe_account_id: 'acct_x' };
    st.righe = 0;
    const r = await chiama(aggiornaStato);
    expect(r.status).toBe(503);
  });
});

describe('2067 — l id del conto si salva prima del link', () => {
  it('link fallito: il conto nato è già sul profilo, il tentativo dopo lo riusa', async () => {
    st.linkCade = true;
    const r = await chiama(collegaNegozio);
    expect(r.status).toBe(500);
    expect(st.salvati).toEqual(['acct_nuovo']);
  });
});

describe('633 — un conto che le chiavi nuove non conoscono si rifà', () => {
  it('«No such account» sul conto del profilo: nasce un conto nuovo e si salva', async () => {
    st.profilo = { ...st.profilo, stripe_account_id: 'acct_vecchio' };
    const r = await chiama(collegaNegozio);
    expect(r.status).toBe(200);
    expect(st.creati).toBe(1);
    expect(st.salvati).toEqual(['acct_nuovo']);
  });
  it('controprova: un conto che esiste si riusa', async () => {
    st.profilo = { ...st.profilo, stripe_account_id: 'acct_buono' };
    const r = await chiama(collegaNegozio);
    expect(r.status).toBe(200);
    expect(st.creati).toBe(0);
  });
});
