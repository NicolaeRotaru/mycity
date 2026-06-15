import { describe, it, expect } from 'vitest';
import { computeApplicationFeeCents, computeSellerPayoutCents } from '@/lib/stripe/client';

/**
 * Split del denaro di un ordine carta. La spedizione (shipping) è il compenso del
 * RIDER, versato a parte: NON deve finire nel netto del venditore, altrimenti
 * viene pagata due volte (al seller nel netto e al rider). Una regressione qui
 * sposta denaro reale tra piattaforma, venditore e rider.
 */
describe('computeSellerPayoutCents', () => {
  it('esclude la spedizione dal netto venditore', () => {
    // €113 = €100 merce + €10 spedizione (rider) + €3 fee consegna (piattaforma)
    const totalCents = 11300;
    const deliveryFeeCents = 300;
    const shippingCents = 1000;

    const seller = computeSellerPayoutCents({ totalCents, deliveryFeeCents, shippingCents });
    const fee = computeApplicationFeeCents(totalCents);

    expect(seller).toBe(totalCents - fee - deliveryFeeCents - shippingCents);
  });

  it('riconciliazione: ogni centesimo è allocato una sola volta', () => {
    const totalCents = 12345;
    const deliveryFeeCents = 300;
    const shippingCents = 599;

    const fee = computeApplicationFeeCents(totalCents);
    const seller = computeSellerPayoutCents({ totalCents, deliveryFeeCents, shippingCents });

    // Invariante: sellerPayout + fee + deliveryFee + shipping === total
    expect(seller + fee + deliveryFeeCents + shippingCents).toBe(totalCents);
  });

  it('senza spedizione né fee consegna, netto = totale - commissione', () => {
    const totalCents = 10000;
    const seller = computeSellerPayoutCents({ totalCents, deliveryFeeCents: 0, shippingCents: 0 });
    expect(seller).toBe(totalCents - computeApplicationFeeCents(totalCents));
  });

  it('non va mai sotto zero', () => {
    // spedizione + fee maggiori del totale (caso degenere): clamp a 0, mai negativo
    expect(computeSellerPayoutCents({ totalCents: 100, deliveryFeeCents: 300, shippingCents: 1000 })).toBe(0);
  });
});
