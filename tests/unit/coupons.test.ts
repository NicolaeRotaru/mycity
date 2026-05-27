import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit test per lib/coupons.validateCoupon().
 *
 * Esperti consultati:
 * - Marketplace PM: "Coupon = leva conversione critica. Bug qui = sconti
 *   doppi (= perdita soldi) o validi quando scaduti."
 * - Senior Test Engineer: "Mock supabase con chainable interface .from().select().eq()
 *   per testare la pipeline di validazione senza DB live."
 */

// Helper per costruire chainable mock Supabase
function makeQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, () => unknown> = {};
  const methods = ['select', 'eq', 'in', 'gt', 'gte', 'lt', 'lte', 'order', 'limit'];
  for (const m of methods) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  return builder;
}

// Mock di lib/supabase/client
const ordersCountMock = vi.fn(() => Promise.resolve({ count: 0 }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ordersCountMock()),
          })),
        };
      }
      // Default: coupons table
      return makeQueryBuilder({ data: null, error: null });
    }),
  },
}));

import { validateCoupon } from '@/lib/coupons';
import { supabase } from '@/lib/supabase/client';

beforeEach(() => {
  vi.clearAllMocks();
  ordersCountMock.mockReturnValue(Promise.resolve({ count: 0 }) as never);
});

const mockCoupon = (overrides: Record<string, unknown> = {}) => ({
  id: 'cpn-1',
  code: 'TEST10',
  type: 'PERCENT' as const,
  value: 10,
  min_subtotal: 0,
  max_uses: null,
  uses_count: 0,
  first_order_only: false,
  expires_at: null,
  active: true,
  description: null,
  ...overrides,
});

const setCouponResponse = (data: unknown, error: unknown = null) => {
  vi.mocked(supabase.from).mockReturnValueOnce(
    makeQueryBuilder({ data, error }) as unknown as ReturnType<typeof supabase.from>,
  );
};

describe('validateCoupon - input validation', () => {
  it('returns error for empty code', async () => {
    const result = await validateCoupon('', 100, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/codice/i);
  });

  it('returns error for whitespace-only code', async () => {
    const result = await validateCoupon('   ', 100, null);
    expect(result.ok).toBe(false);
  });

  it('trims and uppercases code before query', async () => {
    setCouponResponse(null);
    await validateCoupon('  test10  ', 100, null);
    // Il chiamante interno fa uppercase + trim — verifichiamo che eq sia stato chiamato con TEST10
    const fromCall = vi.mocked(supabase.from).mock.calls[0];
    expect(fromCall[0]).toBe('coupons');
  });
});

describe('validateCoupon - coupon not found', () => {
  it('returns error if coupon does not exist', async () => {
    setCouponResponse(null);
    const result = await validateCoupon('NOTEXIST', 100, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/non valido/i);
  });

  it('returns error if supabase returns error', async () => {
    setCouponResponse(null, { message: 'DB error' });
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(false);
  });
});

describe('validateCoupon - expiration', () => {
  it('returns error if expired (expires_at in the past)', async () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    setCouponResponse(mockCoupon({ expires_at: past }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/scadut/i);
  });

  it('accepts if expires_at in the future', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    setCouponResponse(mockCoupon({ expires_at: future, type: 'PERCENT', value: 10 }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(true);
  });
});

describe('validateCoupon - max uses', () => {
  it('returns error if uses_count >= max_uses', async () => {
    setCouponResponse(mockCoupon({ max_uses: 10, uses_count: 10 }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/esaurit/i);
  });

  it('accepts if uses_count < max_uses', async () => {
    setCouponResponse(mockCoupon({ max_uses: 10, uses_count: 5 }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(true);
  });

  it('accepts if max_uses is null (unlimited)', async () => {
    setCouponResponse(mockCoupon({ max_uses: null, uses_count: 1000 }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(true);
  });
});

describe('validateCoupon - min subtotal', () => {
  it('returns error if subtotal < min_subtotal', async () => {
    setCouponResponse(mockCoupon({ min_subtotal: 50 }));
    const result = await validateCoupon('TEST', 30, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/minim/i);
  });

  it('accepts if subtotal == min_subtotal', async () => {
    setCouponResponse(mockCoupon({ min_subtotal: 50 }));
    const result = await validateCoupon('TEST', 50, null);
    expect(result.ok).toBe(true);
  });
});

describe('validateCoupon - discount calculation', () => {
  it('PERCENT 10% on €100 → €10 discount', async () => {
    setCouponResponse(mockCoupon({ type: 'PERCENT', value: 10 }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discount).toBe(10);
  });

  it('FIXED €5 on €100 → €5 discount', async () => {
    setCouponResponse(mockCoupon({ type: 'FIXED', value: 5 }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discount).toBe(5);
  });

  it('FIXED clamps to subtotal (no negative)', async () => {
    setCouponResponse(mockCoupon({ type: 'FIXED', value: 50 }));
    const result = await validateCoupon('TEST', 10, null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discount).toBe(10);
  });

  it('FREE_SHIPPING sets freeShipping=true, no discount', async () => {
    setCouponResponse(mockCoupon({ type: 'FREE_SHIPPING' }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.freeShipping).toBe(true);
      expect(result.discount).toBe(0);
    }
  });
});

describe('validateCoupon - first order only', () => {
  it('requires userId if first_order_only', async () => {
    setCouponResponse(mockCoupon({ first_order_only: true }));
    const result = await validateCoupon('TEST', 100, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/accede/i);
  });

  it('rejects if user already has orders', async () => {
    setCouponResponse(mockCoupon({ first_order_only: true }));
    ordersCountMock.mockReturnValue(Promise.resolve({ count: 1 }) as never);
    const result = await validateCoupon('TEST', 100, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/primo ordine/i);
  });

  it('accepts if user has zero orders', async () => {
    setCouponResponse(mockCoupon({ first_order_only: true, type: 'PERCENT', value: 5 }));
    ordersCountMock.mockReturnValue(Promise.resolve({ count: 0 }) as never);
    const result = await validateCoupon('TEST', 100, 'user-1');
    expect(result.ok).toBe(true);
  });
});
