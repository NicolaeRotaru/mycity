import { describe, it, expect, vi } from 'vitest';

// Mock supabase client - non testiamo le RPC (sono integration test)
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import {
  eurosCentsToPoints,
  pointsToEurValue,
  nextTier,
  TIER_META,
  POINTS_PER_EURO,
  POINTS_REDEEM_RATE,
  POINTS_REDEEM_VALUE_CENTS,
} from '@/lib/loyalty';

/**
 * Unit test per lib/loyalty (parte pura — calcoli punti/tier).
 */

describe('Constants', () => {
  it('1 punto per €1 (POINTS_PER_EURO)', () => {
    expect(POINTS_PER_EURO).toBe(1);
  });

  it('100 punti = €5 (REDEEM_RATE)', () => {
    expect(POINTS_REDEEM_RATE).toBe(100);
    expect(POINTS_REDEEM_VALUE_CENTS).toBe(500);
  });
});

describe('eurosCentsToPoints', () => {
  it('€10.00 (1000 cents) = 10 punti', () => {
    expect(eurosCentsToPoints(1000)).toBe(10);
  });

  it('€0.50 (50 cents) = 0 punti (floor)', () => {
    expect(eurosCentsToPoints(50)).toBe(0);
  });

  it('€10.99 (1099 cents) = 10 punti (no rounding centesimi)', () => {
    expect(eurosCentsToPoints(1099)).toBe(10);
  });

  it('€0 = 0 punti', () => {
    expect(eurosCentsToPoints(0)).toBe(0);
  });

  it('€100 = 100 punti', () => {
    expect(eurosCentsToPoints(10000)).toBe(100);
  });
});

describe('pointsToEurValue', () => {
  it('100 punti = €5.00', () => {
    expect(pointsToEurValue(100)).toBe(5);
  });

  it('200 punti = €10.00', () => {
    expect(pointsToEurValue(200)).toBe(10);
  });

  it('50 punti = €0 (sotto soglia conversione)', () => {
    expect(pointsToEurValue(50)).toBe(0);
  });

  it('99 punti = €0', () => {
    expect(pointsToEurValue(99)).toBe(0);
  });

  it('500 punti = €25', () => {
    expect(pointsToEurValue(500)).toBe(25);
  });
});

describe('TIER_META', () => {
  it('has 4 tier with crescent thresholds', () => {
    expect(TIER_META.bronze.threshold).toBe(0);
    expect(TIER_META.silver.threshold).toBe(500);
    expect(TIER_META.gold.threshold).toBe(2000);
    expect(TIER_META.platinum.threshold).toBe(5000);
  });

  it('each tier has label, icon, color', () => {
    for (const tier of ['bronze', 'silver', 'gold', 'platinum'] as const) {
      expect(TIER_META[tier].label).toBeTruthy();
      expect(TIER_META[tier].icon).toBeDefined();
      expect(TIER_META[tier].color).toMatch(/^text-/);
    }
  });
});

describe('nextTier', () => {
  it('bronze → silver progression', () => {
    const result = nextTier(0, 'bronze');
    expect(result.tier).toBe('silver');
    expect(result.remaining).toBe(500);
  });

  it('halfway to silver', () => {
    const result = nextTier(250, 'bronze');
    expect(result.tier).toBe('silver');
    expect(result.remaining).toBe(250);
  });

  it('silver → gold', () => {
    const result = nextTier(500, 'silver');
    expect(result.tier).toBe('gold');
    expect(result.remaining).toBe(1500); // 2000 - 500
  });

  it('gold → platinum', () => {
    const result = nextTier(2000, 'gold');
    expect(result.tier).toBe('platinum');
    expect(result.remaining).toBe(3000); // 5000 - 2000
  });

  it('platinum has no next', () => {
    const result = nextTier(5000, 'platinum');
    expect(result.tier).toBeNull();
    expect(result.remaining).toBe(0);
  });

  it('clamps remaining to 0 when already past threshold', () => {
    const result = nextTier(1000, 'bronze'); // gia' oltre soglia silver
    expect(result.tier).toBe('silver');
    expect(result.remaining).toBe(0);
  });
});
