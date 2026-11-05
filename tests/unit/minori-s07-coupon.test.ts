import { describe, expect, it } from 'vitest';
import { validateCoupon } from '@/lib/coupons';

const BENVENUTO = {
  id: 'c1', code: 'BENVENUTO10', type: 'PERCENT', value: 10, active: true,
  expires_at: null, max_uses: null, uses_count: 0, min_subtotal: 0,
  first_order_only: true, description: null,
};

/** Client finto: i coupon rispondono, la lettura degli ordini cade. */
function clientConOrdiniCheCadono() {
  return {
    from(tabella: string) {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'or', 'not', 'is']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: tabella === 'coupons' ? BENVENUTO : null, error: null });
      q.then = (res: (r: unknown) => unknown) =>
        Promise.resolve({ count: null, error: { message: 'timeout' } }).then(res);
      return q;
    },
  };
}

describe('S07 · il codice «solo primo ordine» non passa quando la lettura degli ordini cade', () => {
  it('senza risposta sugli ordini il codice non si accetta', async () => {
    const r = await validateCoupon('benvenuto10', 20, 'u-maria', clientConOrdiniCheCadono() as never);
    expect(r.ok).toBe(false);
  });
});

describe('S07 · «Spedizione gratuita» col ritiro in negozio', () => {
  const GRATIS = { ...BENVENUTO, code: 'GRATIS', type: 'FREE_SHIPPING', value: 0, first_order_only: false };
  function client() {
    return {
      from() {
        const q: Record<string, unknown> = {};
        for (const m of ['select', 'eq']) q[m] = () => q;
        q.maybeSingle = async () => ({ data: GRATIS, error: null });
        return q;
      },
    };
  }
  it('col ritiro il codice non si accetta (e quindi non si consuma)', async () => {
    const r = await validateCoupon('gratis', 20, 'u-maria', client() as never, { ritiroInNegozio: true });
    expect(r.ok).toBe(false);
  });
  it('con la consegna il codice resta valido', async () => {
    const r = await validateCoupon('gratis', 20, 'u-maria', client() as never, { ritiroInNegozio: false });
    expect(r.ok && r.freeShipping).toBe(true);
  });
});
