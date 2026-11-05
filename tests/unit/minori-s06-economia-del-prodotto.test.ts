import { describe, it, expect } from 'vitest';
import { sellerEconomics } from '@/lib/products/economics';

/** S06 · 2282 — Un prezzo non valido dà zero anche sulla consegna, come dice il commento. */
describe('2282 — sellerEconomics', () => {
  it('prezzo assente o zero: consegna 0, non 4 €', () => {
    expect(sellerEconomics(null).deliveryFee).toBe(0);
    expect(sellerEconomics(0).deliveryFee).toBe(0);
  });
  it('con un prezzo vero resta la consegna di un carrello con quel solo pezzo', () => {
    expect(sellerEconomics(12).deliveryFee).toBe(3);
  });
});
