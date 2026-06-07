import { describe, it, expect } from 'vitest';
import {
  isExpressEligible,
  expressEnabledToMode,
  modeToExpressEnabled,
} from '@/lib/products/express';

describe('isExpressEligible', () => {
  it('override true → sempre idoneo', () => {
    expect(isExpressEligible(true, false)).toBe(true);
    expect(isExpressEligible(true, true)).toBe(true);
  });

  it('override false → mai idoneo', () => {
    expect(isExpressEligible(false, true)).toBe(false);
    expect(isExpressEligible(false, false)).toBe(false);
  });

  it('null/undefined → eredita dal negozio', () => {
    expect(isExpressEligible(null, true)).toBe(true);
    expect(isExpressEligible(null, false)).toBe(false);
    expect(isExpressEligible(undefined, true)).toBe(true);
    expect(isExpressEligible(undefined, false)).toBe(false);
  });
});

describe('mappatura modalità Express', () => {
  it('express_enabled → modalità', () => {
    expect(expressEnabledToMode(true)).toBe('yes');
    expect(expressEnabledToMode(false)).toBe('no');
    expect(expressEnabledToMode(null)).toBe('inherit');
    expect(expressEnabledToMode(undefined)).toBe('inherit');
  });

  it('modalità → express_enabled', () => {
    expect(modeToExpressEnabled('yes')).toBe(true);
    expect(modeToExpressEnabled('no')).toBe(false);
    expect(modeToExpressEnabled('inherit')).toBeNull();
  });
});
