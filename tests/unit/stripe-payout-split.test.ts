import { describe, it, expect } from 'vitest';
import { computeApplicationFeeCents, computeSellerPayoutCents, computeOrderSplit } from '@/lib/stripe/client';

/**
 * Split del denaro di un ordine. DECISIONE DI REVENUE: la commissione (10%) grava
 * SOLO sul SUBTOTALE prodotti — mai su spedizione né sulla fee di consegna. Il
 * venditore incassa un netto pulito pari al 90% di ciò che vende. La spedizione è
 * il compenso del RIDER, versata a parte: NON finisce nel netto venditore. Una
 * regressione qui sposta denaro reale tra piattaforma, venditore e rider.
 */
describe('computeOrderSplit / computeSellerPayoutCents', () => {
  it('la commissione grava solo sul subtotale prodotti (non su spedizione/consegna)', () => {
    // €113 = €100 merce + €10 spedizione (rider) + €3 fee consegna (piattaforma)
    const totalCents = 11300;
    const deliveryFeeCents = 300;
    const shippingCents = 1000;

    const { subtotalCents, applicationFeeCents, sellerPayoutCents } = computeOrderSplit({
      totalCents,
      deliveryFeeCents,
      shippingCents,
    });

    expect(subtotalCents).toBe(10000); // 100,00 € di sola merce
    expect(applicationFeeCents).toBe(1000); // 10% di 100,00 € = 10,00 €
    expect(sellerPayoutCents).toBe(9000); // netto pulito = 90% del subtotale
  });

  it('computeSellerPayoutCents = netto di computeOrderSplit', () => {
    const args = { totalCents: 11300, deliveryFeeCents: 300, shippingCents: 1000 };
    expect(computeSellerPayoutCents(args)).toBe(computeOrderSplit(args).sellerPayoutCents);
  });

  it('riconciliazione: ogni centesimo è allocato una sola volta', () => {
    const totalCents = 12345;
    const deliveryFeeCents = 300;
    const shippingCents = 599;

    const { applicationFeeCents, sellerPayoutCents } = computeOrderSplit({
      totalCents,
      deliveryFeeCents,
      shippingCents,
    });

    // Invariante: sellerPayout + fee + deliveryFee + shipping === total
    expect(sellerPayoutCents + applicationFeeCents + deliveryFeeCents + shippingCents).toBe(totalCents);
  });

  it('senza spedizione né fee consegna, netto = subtotale - commissione', () => {
    const totalCents = 10000;
    const seller = computeSellerPayoutCents({ totalCents, deliveryFeeCents: 0, shippingCents: 0 });
    expect(seller).toBe(totalCents - computeApplicationFeeCents(totalCents)); // 9000
  });

  it('non va mai sotto zero (caso degenere: spedizione+fee > totale)', () => {
    expect(computeSellerPayoutCents({ totalCents: 100, deliveryFeeCents: 300, shippingCents: 1000 })).toBe(0);
  });
});

/**
 * Settlement COD: su un ordine in contanti, commissione e netto venditore si
 * calcolano sul SUBTOTALE prodotti del valore di vendita lordo (subtotale +
 * spedizione + fee − sconto, prima del credito wallet). La commissione resta sul
 * solo subtotale, identica al flusso carta.
 */
describe('settlement COD: commissione sul subtotale', () => {
  it('le 4 quote sommano al lordo; commissione solo sul subtotale', () => {
    // Lordo €113 = merce €100 + spedizione €10 + fee consegna €3.
    const grossCents = 11300;
    const deliveryFeeCents = 300;
    const shippingCents = 1000;

    const { subtotalCents, applicationFeeCents, sellerPayoutCents } = computeOrderSplit({
      totalCents: grossCents,
      deliveryFeeCents,
      shippingCents,
    });

    expect(applicationFeeCents).toBe(computeApplicationFeeCents(subtotalCents));
    expect(sellerPayoutCents + applicationFeeCents + deliveryFeeCents + shippingCents).toBe(grossCents);
    expect(sellerPayoutCents).toBe(9000);
  });
});
