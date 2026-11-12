import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R11-020 — Se il primo collegamento a Stripe si interrompe e poi cambiano email
 * o ruolo, negozio e fattorino leggevano «Errore Stripe» a ogni nuovo tentativo
 * per 24 ore: la chiave di idempotenza era fissa per persona (connect_<id>)
 * mentre email e capacità cambiano. Qui Stripe finto fa come quello vero: stessa
 * chiave con parametri diversi → errore.
 */

const stato = vi.hoisted(() => ({ chiavi: new Map<string, string>(), creati: 0 }));

vi.mock('stripe', () => ({
  default: class {
    accounts = {
      create: async (params: Record<string, unknown>, opz: { idempotencyKey: string }) => {
        const firma = JSON.stringify(params);
        const gia = stato.chiavi.get(opz.idempotencyKey);
        if (gia !== undefined && gia !== firma) {
          throw Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), { type: 'StripeIdempotencyError' });
        }
        stato.chiavi.set(opz.idempotencyKey, firma);
        stato.creati += 1;
        return { id: `acct_${stato.creati}` };
      },
      retrieve: async () => ({}),
    };
    accountLinks = { create: async () => ({ url: 'https://connect.stripe.test/onboarding' }) };
  },
}));
vi.mock('@/lib/env', () => ({ env: { stripeSecretKey: () => 'sk_test_x', appUrl: () => 'http://localhost' } }));

process.env.STRIPE_SECRET_KEY = 'sk_test_x';

import { createConnectOnboardingLink } from '@/lib/stripe/client';

const tenta = (email: string, ruolo: 'venditore' | 'fattorino') =>
  createConnectOnboardingLink({
    sellerEmail: email, sellerId: 'persona-1', existingAccount: null,
    returnUrl: 'http://localhost/r', refreshUrl: 'http://localhost/f', ruolo,
  });

beforeEach(() => {
  stato.chiavi.clear();
  stato.creati = 0;
});

describe('R11-020 — la chiave del conto Connect', () => {
  it('dopo un primo tentativo, cambiare email non dà errore', async () => {
    await tenta('vecchia@esempio.it', 'venditore');
    await expect(tenta('nuova@esempio.it', 'venditore'), '«Errore Stripe» per 24 ore').resolves.toMatchObject({ url: expect.any(String) });
  });

  it('cambiare ruolo non dà errore', async () => {
    await tenta('mario@esempio.it', 'venditore');
    await expect(tenta('mario@esempio.it', 'fattorino')).resolves.toMatchObject({ url: expect.any(String) });
  });

  it('lo stesso tentativo ripetuto resta lo stesso conto (niente conti orfani)', async () => {
    await tenta('mario@esempio.it', 'venditore');
    await tenta('mario@esempio.it', 'venditore');
    // Una chiave sola: Stripe vero restituisce lo stesso conto alla seconda chiamata.
    expect(stato.chiavi.size).toBe(1);
  });
});
