import { describe, it, expect } from 'vitest';
import { riepilogoFattorino } from '@/lib/guadagni/fattorino';

/** S01 — 263: il compenso pagato in parte col bonifico non si conta due volte. */
describe('263 — Guadagni del fattorino sul contrassegno coperto dal credito', () => {
  it('compenso 3 €, contante 1 €, residuo già bonificato: 2 € versati e 1 € in contanti', () => {
    const r = riepilogoFattorino([
      { payment_method: 'cod', rider_fee_cents: 300, shipping_cost: 3, rider_payout_status: 'TRANSFERRED', total_price: 1 },
    ]);
    expect(r.totale).toBe(3);
    expect(r.versati).toBeCloseTo(2, 5);
    expect(r.inContanti).toBeCloseTo(1, 5);
    expect(r.versati + r.inArrivo + r.inContanti).toBeCloseTo(r.totale, 5);
  });
  it('residuo non ancora bonificato: in arrivo', () => {
    const r = riepilogoFattorino([
      { payment_method: 'cod', rider_fee_cents: 300, shipping_cost: 3, rider_payout_status: 'HELD', total_price: 0 },
    ]);
    expect(r.inArrivo).toBe(3);
    expect(r.inContanti).toBe(0);
  });
  it('contante che basta: tutto in contanti, come prima', () => {
    const r = riepilogoFattorino([
      { payment_method: 'cod', rider_fee_cents: 300, shipping_cost: 3, rider_payout_status: null, total_price: 20 },
    ]);
    expect(r.inContanti).toBe(3);
    expect(r.versati).toBe(0);
  });
});
