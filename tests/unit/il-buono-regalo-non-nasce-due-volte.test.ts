import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R045) — LA DIFESA CONTRO IL BUONO DOPPIO ERA NEL DATABASE, MA IL
 * CODICE NON LA USAVA.
 *
 * Il codice di un buono regalo è calcolato dalla sessione di pagamento e dal
 * segreto del webhook. Se lo stesso pagamento viene rilavorato DOPO che quel
 * segreto è stato cambiato, il codice che ne esce è diverso — e siccome
 * l'unica difesa contro il doppione era proprio il codice, nasceva una seconda
 * carta sullo stesso incasso. Credito spendibile regalato, a carico nostro.
 *
 * La migrazione 119 aveva già messo la difesa giusta: una colonna
 * `stripe_session_id` con un indice unico, cioè «una sessione, un buono, punto».
 * Ma nella riga scritta dal codice quella colonna non c'era: l'indice non aveva
 * niente da confrontare e la protezione era spenta senza che nessuno lo sapesse.
 *
 * Questa prova rilavora lo stesso pagamento dopo un cambio di segreto, come
 * farebbe Stripe con una consegna ripetuta: prima nascevano due buoni, adesso
 * resta uno.
 */

type Buono = {
  code: string;
  amount_cents: number;
  stripe_session_id?: string | null;
};

const state: { buoni: Buono[]; segreto: string; email: number } = { buoni: [], segreto: 'segreto-vecchio', email: 0 };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', () => ({ env: { stripeWebhookSecret: () => state.segreto } }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => {
    state.email += 1;
    return { ok: true };
  }),
}));
vi.mock('@/lib/email/templates', () => ({
  giftCardRecipientTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  giftCardBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'gift_cards') {
        return {
          insert: (riga: Buono) => {
            // Il database vero ha due unicità: la chiave sul codice e l'indice
            // unico sulla sessione (migrazione 119). Qui valgono tutte e due.
            const doppioCodice = state.buoni.some((b) => b.code === riga.code);
            const doppiaSessione =
              riga.stripe_session_id != null &&
              state.buoni.some((b) => b.stripe_session_id === riga.stripe_session_id);
            if (doppioCodice || doppiaSessione) {
              return Promise.resolve({ error: { code: '23505', message: 'duplicate key' } });
            }
            state.buoni.push(riga);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { full_name: 'Nicola' } }) }) }) };
      }
      return {};
    },
  }),
}));

import { handleGiftCardPurchase } from '@/lib/stripe/webhook/giftcard';

function sessionePagata() {
  return {
    id: 'cs_test_1',
    metadata: { amount_cents: '5000', buyer_id: 'u1', recipient_email: 'a@b.com', recipient_name: 'Anna' },
    customer_details: { email: 'compratore@x.com' },
  } as unknown as Parameters<typeof handleGiftCardPurchase>[0];
}

beforeEach(() => {
  state.buoni = [];
  state.segreto = 'segreto-vecchio';
  state.email = 0;
});

describe('lo stesso pagamento rilavorato', () => {
  it('non produce un secondo buono nemmeno se nel frattempo e cambiato il segreto', async () => {
    await handleGiftCardPurchase(sessionePagata());
    expect(state.buoni.length).toBe(1);

    // Il segreto del webhook viene ruotato, e Stripe riconsegna lo stesso
    // evento: il codice calcolato adesso e diverso da quello di prima.
    state.segreto = 'segreto-nuovo';
    await handleGiftCardPurchase(sessionePagata());

    expect(
      state.buoni.length,
      'due buoni da 50 euro sullo stesso incasso: il secondo lo regaliamo noi',
    ).toBe(1);
  });

  it('la sessione resta scritta sul buono, altrimenti l indice unico non serve a niente', async () => {
    await handleGiftCardPurchase(sessionePagata());
    expect(state.buoni[0].stripe_session_id).toBe('cs_test_1');
  });

  it('un buono nuovo di una sessione diversa nasce regolarmente', async () => {
    await handleGiftCardPurchase(sessionePagata());
    const altra = { ...sessionePagata(), id: 'cs_test_2' } as Parameters<typeof handleGiftCardPurchase>[0];
    await handleGiftCardPurchase(altra);
    expect(state.buoni.length).toBe(2);
  });
});
