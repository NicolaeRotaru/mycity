import { describe, it, expect } from 'vitest';
import { isVerifiedStore } from '@/lib/store-trust';

describe('isVerifiedStore', () => {
  it('returns false for null/undefined', () => {
    expect(isVerifiedStore(null)).toBe(false);
    expect(isVerifiedStore(undefined)).toBe(false);
  });

  it('returns false for demo/unapproved or payout off', () => {
    expect(isVerifiedStore({ is_approved: false, stripe_charges_enabled: true, stripe_payouts_enabled: true })).toBe(false);
    expect(isVerifiedStore({ is_approved: true, stripe_charges_enabled: false, stripe_payouts_enabled: true })).toBe(false);
    expect(isVerifiedStore({ is_approved: true, stripe_charges_enabled: true, stripe_payouts_enabled: false })).toBe(false);
    expect(isVerifiedStore({ is_approved: true })).toBe(false);
  });

  it('returns true only when approved and Stripe charges+payouts are on', () => {
    expect(
      isVerifiedStore({
        is_approved: true,
        stripe_charges_enabled: true,
        stripe_payouts_enabled: true,
      }),
    ).toBe(true);
  });
});
