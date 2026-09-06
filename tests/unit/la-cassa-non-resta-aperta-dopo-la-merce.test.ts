import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — LA CASSA POTEVA RESTARE APERTA VENTI MINUTI DOPO CHE LA MERCE ERA
 * GIÀ TORNATA IN VENDITA.
 *
 * Il commento in `createMultiSellerCheckoutSession` promette per iscritto che
 * «la sessione di pagamento scade quando scade la riserva della merce». Non era
 * vero fino in fondo: Stripe non accetta scadenze sotto la mezz'ora, e il
 * codice alzava la scadenza al minimo consentito con un `Math.max` invece di
 * fermarsi. Con una riserva che scadeva fra dieci minuti, la pagina di
 * pagamento scadeva ventuno minuti DOPO: in quella finestra il giro periodico
 * rimette il pezzo in vendita e restituisce il codice sconto, e intanto il
 * cliente può ancora pagare. Nasce l'ordine di merce già venduta a un altro.
 *
 * Oggi la riserva nasce a due ore, quindi sul percorso normale non capita: è
 * una rete che non tiene, non un buco aperto. Basta però accorciare la riserva
 * sul fresco — la richiesta naturale di un fornaio o di un fioraio — perché si
 * apra davvero. Questa prova è la rete.
 */

const sessioniCreate: Array<Record<string, unknown>> = [];

vi.mock('@/lib/env', () => ({
  env: { stripeSecretKey: () => 'sk_test_x', appUrl: () => 'https://mycity.test' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() },
}));

vi.mock('stripe', () => ({
  default: class {
    checkout = {
      sessions: {
        create: async (corpo: Record<string, unknown>) => {
          sessioniCreate.push(corpo);
          return { id: 'cs_test', url: 'https://stripe.test/cs_test' };
        },
      },
    };
    coupons = { create: async () => ({ id: 'coup_test' }) };
  },
}));

import {
  createMultiSellerCheckoutSession,
  RiservaTroppoCorta,
  MINIMO_SCADENZA_STRIPE_SEC,
} from '@/lib/stripe/client';

function carrello(scadenzaRiservaMs: number | undefined) {
  return {
    pendingCheckoutId: 'pc_1',
    groups: [
      {
        sellerId: 'seller-1',
        storeName: 'Pane Quotidiano',
        items: [{ productId: 'p1', name: 'Torta', quantity: 1, unitAmountCents: 2000 }],
      },
    ],
    shippingPerGroupCents: [0],
    deliveryFeePerGroupCents: [0],
    totalDiscountCents: 0,
    buyerEmail: 'b@x.com',
    buyerUserId: 'buyer-1',
    successUrl: 'https://mycity.test/ok',
    cancelUrl: 'https://mycity.test/ko',
    pendingExpiresAt: scadenzaRiservaMs,
  };
}

describe('la cassa non sopravvive alla riserva della merce', () => {
  beforeEach(() => {
    sessioniCreate.length = 0;
  });

  it('con dieci minuti di riserva la cassa non si apre affatto', async () => {
    const fraDieciMinuti = Date.now() + 10 * 60_000;

    await expect(
      createMultiSellerCheckoutSession(carrello(fraDieciMinuti) as never),
      'con dieci minuti di riserva si apriva lo stesso una cassa che scade ventuno minuti dopo che la merce è già tornata in vendita',
    ).rejects.toBeInstanceOf(RiservaTroppoCorta);

    expect(
      sessioniCreate.length,
      'la sessione Stripe è stata creata comunque: il cliente può ancora pagare merce rimessa in vendita',
    ).toBe(0);
  });

  it('quando la cassa si apre, non scade mai dopo la riserva', async () => {
    // Due ore: la riserva di oggi. Il percorso normale continua a funzionare.
    const scadenzaRiserva = Date.now() + 2 * 60 * 60_000;
    await createMultiSellerCheckoutSession(carrello(scadenzaRiserva) as never);

    expect(sessioniCreate.length).toBe(1);
    const expiresAt = sessioniCreate[0].expires_at as number;
    expect(expiresAt).toBeLessThanOrEqual(Math.floor(scadenzaRiserva / 1000));
  });

  it('appena sopra il minimo di Stripe la cassa si apre, e scade con la riserva', async () => {
    const scadenzaRiserva = Date.now() + (MINIMO_SCADENZA_STRIPE_SEC + 60) * 1000;
    await createMultiSellerCheckoutSession(carrello(scadenzaRiserva) as never);

    expect(sessioniCreate.length).toBe(1);
    expect(sessioniCreate[0].expires_at as number).toBeLessThanOrEqual(Math.floor(scadenzaRiserva / 1000));
  });
});
