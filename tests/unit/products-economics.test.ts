import { describe, it, expect } from 'vitest';
import {
  sellerEconomics,
  netToSeller,
  MARKETPLACE_FEE_RATE,
  PLATFORM_DELIVERY_FEE_EUR,
} from '@/lib/products/economics';

/**
 * Economia venditore: funzioni pure. È la sorgente unica del netto-venditore
 * usata sia dal motore AID "Migliora tutto" sia dalla UI, quindi va blindata.
 */
describe('sellerEconomics', () => {
  it('commissione 10% e netto sul prezzo', () => {
    const e = sellerEconomics(10);
    expect(e.price).toBe(10);
    expect(e.commission).toBe(1); // 10%
    expect(e.netToSeller).toBe(9);
    expect(e.feeRate).toBe(MARKETPLACE_FEE_RATE);
    expect(e.deliveryFee).toBe(PLATFORM_DELIVERY_FEE_EUR);
  });

  it('arrotonda a 2 decimali in modo stabile', () => {
    const e = sellerEconomics(4.9);
    expect(e.commission).toBe(0.49);
    expect(e.netToSeller).toBe(4.41);

    const e2 = sellerEconomics(9.99);
    expect(e2.commission).toBe(1); // 0.999 -> 1.00
    expect(e2.netToSeller).toBe(8.99);
  });

  it('prezzi non validi → tutto a zero (tranne fee/rate)', () => {
    for (const bad of [0, -5, NaN, null, undefined]) {
      const e = sellerEconomics(bad as number);
      expect(e.price).toBe(0);
      expect(e.commission).toBe(0);
      expect(e.netToSeller).toBe(0);
    }
  });

  it('fee consegna = €3.00 e non incide sul netto', () => {
    expect(PLATFORM_DELIVERY_FEE_EUR).toBe(3);
    expect(sellerEconomics(20).netToSeller).toBe(18); // netto ignora la fee consegna
  });

  it('netToSeller scorciatoia coerente', () => {
    expect(netToSeller(50)).toBe(45);
    expect(netToSeller(0)).toBe(0);
  });
});
