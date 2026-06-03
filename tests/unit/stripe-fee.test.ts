import { describe, it, expect } from 'vitest';
import { computeApplicationFeeCents, MARKETPLACE_FEE_BPS } from '@/lib/stripe/client';

/**
 * Commissione marketplace: garantisce che la fee trattenuta sia esattamente
 * l'8% e correttamente arrotondata. Una regressione qui sposterebbe denaro tra
 * piattaforma e venditori. computeApplicationFeeCents e' una funzione pura.
 */
describe('computeApplicationFeeCents', () => {
  it('MARKETPLACE_FEE_BPS = 800 (8%)', () => {
    expect(MARKETPLACE_FEE_BPS).toBe(800);
  });

  it('8% di 100,00 € = 8,00 €', () => {
    expect(computeApplicationFeeCents(10000)).toBe(800);
  });

  it('arrotonda al centesimo piu vicino', () => {
    expect(computeApplicationFeeCents(1)).toBe(0); // 0.08 -> 0
    expect(computeApplicationFeeCents(13)).toBe(1); // 1.04 -> 1
    expect(computeApplicationFeeCents(50)).toBe(4); // 4.00 -> 4
    expect(computeApplicationFeeCents(94)).toBe(8); // 7.52 -> 8
  });

  it('0 per importo 0', () => {
    expect(computeApplicationFeeCents(0)).toBe(0);
  });

  it('fee + payout ricostruiscono il totale', () => {
    const total = 12345;
    const fee = computeApplicationFeeCents(total);
    const payout = total - fee;
    expect(fee + payout).toBe(total);
    expect(fee).toBe(988); // 987.6 -> 988
  });
});
