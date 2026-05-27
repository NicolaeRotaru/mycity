import { describe, it, expect } from 'vitest';
import { cartTotal, cartCount, type CartItem } from '@/lib/cart';

/**
 * Unit test per lib/cart: calcoli totale/count (puri, isolati).
 * Le funzioni IO-bound (getCart, saveCart) toccano localStorage → test E2E.
 */

const mkItem = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: 'prod-1',
  name: 'Pomodori ciliegino',
  price: 3.5,
  quantity: 1,
  ...overrides,
});

describe('cartTotal', () => {
  it('returns 0 for empty cart', () => {
    expect(cartTotal([])).toBe(0);
  });

  it('sums price * quantity for single item', () => {
    expect(cartTotal([mkItem({ price: 5, quantity: 2 })])).toBe(10);
  });

  it('sums multiple items', () => {
    const cart: CartItem[] = [
      mkItem({ id: '1', price: 3, quantity: 2 }),
      mkItem({ id: '2', price: 5, quantity: 1 }),
      mkItem({ id: '3', price: 1.5, quantity: 4 }),
    ];
    // 3*2 + 5*1 + 1.5*4 = 6 + 5 + 6 = 17
    expect(cartTotal(cart)).toBe(17);
  });

  it('handles decimal precision', () => {
    const cart = [mkItem({ price: 0.1, quantity: 3 })];
    // 0.1 * 3 = 0.30000000000000004 in JS - real bug
    expect(cartTotal(cart)).toBeCloseTo(0.3, 5);
  });
});

describe('cartCount', () => {
  it('returns 0 for empty cart', () => {
    expect(cartCount([])).toBe(0);
  });

  it('sums quantities across items', () => {
    const cart = [
      mkItem({ id: '1', quantity: 3 }),
      mkItem({ id: '2', quantity: 2 }),
      mkItem({ id: '3', quantity: 1 }),
    ];
    expect(cartCount(cart)).toBe(6);
  });

  it('treats single item with qty=1 as count 1', () => {
    expect(cartCount([mkItem({ quantity: 1 })])).toBe(1);
  });
});
