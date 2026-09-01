import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R048) — OGNI CONTO NASCEVA «PERSONA FISICA», E CHIEDEVA ANCHE DI
 * POTER INCASSARE CARTE.
 *
 * `createConnectOnboardingLink` è la funzione che apre il conto Stripe di un
 * negozio o di un fattorino. Creava sempre il conto con
 * `business_type: 'individual'` e con due capacità: `card_payments` e
 * `transfers`. La stessa funzione la usano tutte e due le rotte.
 *
 * Due guai distinti:
 *
 * ① Un negozio costituito in società — a Piacenza sono tanti: SRL, SNC — parte
 *    dichiarato come persona fisica, e nella verifica si trova a dover
 *    dichiarare dati che non gli corrispondono. L'onboarding si arena, e
 *    finché non è completo l'ordine resta in PENDING_SELLER_ONBOARDING: il
 *    negozio non viene pagato. Il tipo di attività lo chiede Stripe durante la
 *    verifica, ed è l'unico posto in cui la persona giusta può rispondere.
 *
 * ② Chiedere `card_payments` a un fattorino gli impone una verifica molto più
 *    pesante del necessario. Nel modello scelto (Separate Charges & Transfers)
 *    l'incasso lo fa la piattaforma: al fattorino serve solo poter RICEVERE un
 *    bonifico. Più attrito, più abbandoni, compenso fermo.
 */

const contiCreati: Array<Record<string, unknown>> = [];

vi.mock('@/lib/env', () => ({
  env: { stripeSecretKey: () => 'sk_test_x' },
}));

vi.mock('stripe', () => ({
  default: class {
    accounts = {
      create: async (corpo: Record<string, unknown>) => {
        contiCreati.push(corpo);
        return { id: 'acct_nuovo' };
      },
    };
    accountLinks = {
      create: async () => ({ url: 'https://connect.stripe.test/onboarding' }),
    };
  },
}));

import { createConnectOnboardingLink } from '@/lib/stripe/client';

const comuni = {
  sellerEmail: 'chi@prova.it',
  sellerId: 'u1',
  existingAccount: null,
  returnUrl: 'https://mycity.test/ok',
  refreshUrl: 'https://mycity.test/riprova',
};

beforeEach(() => {
  contiCreati.length = 0;
});

describe('il conto Stripe che apriamo per chi lavora con noi', () => {
  it('non decide al posto suo che è una persona fisica', async () => {
    await createConnectOnboardingLink({ ...comuni, ruolo: 'venditore' });
    expect(
      contiCreati[0]?.business_type,
      'un negozio costituito in societa nasce dichiarato persona fisica: la verifica si arena e non viene pagato',
    ).toBeUndefined();
  });

  it('al fattorino chiede solo di poter RICEVERE i soldi, non di incassarli dai clienti', async () => {
    await createConnectOnboardingLink({ ...comuni, ruolo: 'fattorino' });
    const capacita = contiCreati[0]?.capabilities as Record<string, unknown>;
    expect(capacita?.transfers, 'senza «transfers» il compenso non gli arriva').toBeTruthy();
    expect(
      capacita?.card_payments,
      'al fattorino si chiede di poter incassare carte: una verifica molto piu pesante, per una cosa che non fara mai',
    ).toBeUndefined();
  });

  it('al negozio resta quello che aveva prima: la riparazione non gli cambia la verifica sotto i piedi', async () => {
    await createConnectOnboardingLink({ ...comuni, ruolo: 'venditore' });
    const capacita = contiCreati[0]?.capabilities as Record<string, unknown>;
    expect(capacita?.transfers).toBeTruthy();
    expect(capacita?.card_payments).toBeTruthy();
  });

  it('con un conto gia aperto non se ne crea un altro', async () => {
    const esito = await createConnectOnboardingLink({
      ...comuni,
      existingAccount: 'acct_esistente',
      ruolo: 'venditore',
    });
    expect(contiCreati).toHaveLength(0);
    expect(esito.accountId).toBe('acct_esistente');
  });
});
