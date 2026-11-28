import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Collegare Stripe da un'anteprima che usa il database vero sostituiva il conto
 * del negozio con uno di prova.
 *
 * La chiave di prova non conosce i conti veri: `accounts.retrieve` sul conto
 * salvato nel profilo risponde «No such account» (resource_missing). Prima, in
 * quel caso, si creava un conto nuovo e lo si scriveva sul profilo al posto di
 * quello vero: il negozio non riceveva piu' i bonifici. Nell'anteprima, con una
 * chiave di prova, ora ci si ferma con un errore; fuori dall'anteprima, con la
 * chiave vera e senza conto salvato resta tutto com'era.
 *
 * Stripe e il salvataggio sul profilo sono finti: niente rete, niente database.
 */
const st = vi.hoisted(() => ({
  chiave: 'sk_test_finta',
  creati: 0,
  link: 0,
  salvati: [] as string[],
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { stripeSecretKey: () => st.chiave } }));
vi.mock('stripe', () => ({
  default: class {
    accounts = {
      create: async () => ((st.creati += 1), { id: 'acct_nuovo' }),
      // Il conto vero del negozio: la chiave in uso non lo conosce.
      retrieve: async (id: string) => {
        throw Object.assign(new Error(`No such account: '${id}'`), { code: 'resource_missing', statusCode: 404 });
      },
    };
    accountLinks = {
      create: async () => ((st.link += 1), { url: 'https://connect.stripe.test/onboarding' }),
    };
  },
}));

import { createConnectOnboardingLink } from '@/lib/stripe/client';

const collega = (existingAccount: string | null) =>
  createConnectOnboardingLink({
    sellerEmail: 'forno@esempio.it',
    sellerId: 'forno',
    existingAccount,
    returnUrl: 'https://mycity.test/ok',
    refreshUrl: 'https://mycity.test/riprova',
    ruolo: 'venditore',
    salvaConto: async (id) => {
      st.salvati.push(id);
    },
  });

beforeEach(() => {
  Object.assign(st, { chiave: 'sk_test_finta', creati: 0, link: 0, salvati: [] });
  vi.stubEnv('VERCEL_ENV', 'preview');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dall anteprima un conto gia salvato non lo sostituisce un conto creato con la chiave di prova', () => {
  it('anteprima, chiave di prova, conto vero sul profilo: nessun conto nuovo, niente scritto sul profilo', async () => {
    await expect(collega('acct_vero_del_negozio')).rejects.toThrow(/chiave di prova/);
    expect(st.creati, 'si crea un conto di prova al posto di quello vero').toBe(0);
    expect(st.salvati, 'il conto di prova finisce sul profilo al posto di quello vero').toEqual([]);
    expect(st.link).toBe(0);
  });

  it('vale anche per una chiave ristretta di prova (rk_test_)', async () => {
    st.chiave = 'rk_test_finta';
    await expect(collega('acct_vero_del_negozio')).rejects.toThrow();
    expect(st.creati).toBe(0);
    expect(st.salvati).toEqual([]);
  });

  it('controprova: nessun conto salvato, con la chiave di prova se ne crea uno e si salva', async () => {
    const esito = await collega(null);
    expect(st.creati).toBe(1);
    expect(st.salvati).toEqual(['acct_nuovo']);
    expect(esito.accountId).toBe('acct_nuovo');
  });

  // Onda 2 (R05-009) — Qui c'era la controprova opposta: fuori dall'anteprima, con la chiave di prova, un conto
  // sconosciuto si rifaceva. Era il difetto: lo sviluppo in locale (o un ambiente di prova) col database vero
  // sostituiva il conto vero del negozio. Il freno adesso vale per ogni chiave di prova
  // (tests/unit/riparazione-onda2-r05-009-freno-del-conto-di-prova.test.ts).
  it('fuori dall anteprima (sviluppo locale), con la chiave di prova, il conto sconosciuto non si sostituisce lo stesso', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    await expect(collega('acct_di_un_altro_conto_di_prova')).rejects.toThrow(/chiave di prova/);
    expect(st.creati).toBe(0);
    expect(st.salvati).toEqual([]);
  });

  it('controprova: sul sito vero, con la chiave vera, un conto sconosciuto si rifa come prima', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    st.chiave = 'sk_live_finta';
    const esito = await collega('acct_nato_in_prova');
    expect(st.creati).toBe(1);
    expect(st.salvati).toEqual(['acct_nuovo']);
    expect(esito.url).toContain('onboarding');
  });
});
