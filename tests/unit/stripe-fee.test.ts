import { describe, it, expect } from 'vitest';
import { computeApplicationFeeCents, MARKETPLACE_FEE_BPS } from '@/lib/stripe/client';

/**
 * Commissione marketplace: garantisce che la fee trattenuta sia esattamente
 * il 10% e correttamente arrotondata. Una regressione qui sposterebbe denaro tra
 * piattaforma e venditori. computeApplicationFeeCents e' una funzione pura.
 */
describe('computeApplicationFeeCents', () => {
  it('MARKETPLACE_FEE_BPS = 1000 (10%)', () => {
    expect(MARKETPLACE_FEE_BPS).toBe(1000);
  });

  it('10% di 100,00 € = 10,00 €', () => {
    expect(computeApplicationFeeCents(10000)).toBe(1000);
  });

  it('arrotonda al centesimo piu vicino', () => {
    expect(computeApplicationFeeCents(1)).toBe(0); // 0.10 -> 0
    expect(computeApplicationFeeCents(5)).toBe(1); // 0.50 -> 1 (round half up)
    expect(computeApplicationFeeCents(50)).toBe(5); // 5.00 -> 5
    expect(computeApplicationFeeCents(94)).toBe(9); // 9.40 -> 9
  });

  it('0 per importo 0', () => {
    expect(computeApplicationFeeCents(0)).toBe(0);
  });

  it('fee + payout ricostruiscono il totale', () => {
    const total = 12345;
    const fee = computeApplicationFeeCents(total);
    const payout = total - fee;
    expect(fee + payout).toBe(total);
    expect(fee).toBe(1235); // 1234.5 -> 1235
  });
});
