import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/cn';

describe('cn (className utility)', () => {
  it('joins multiple classes', () => {
    expect(cn('btn', 'btn-primary')).toBe('btn btn-primary');
  });

  it('filters falsy values', () => {
    expect(cn('btn', false, null, undefined, 0)).toBe('btn');
  });

  it('handles conditional classes', () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn('btn', isActive && 'active', isDisabled && 'disabled')).toBe('btn active');
  });

  it('returns empty string for all-falsy', () => {
    expect(cn(false, null, undefined)).toBe('');
  });

  it('returns empty string for no args', () => {
    expect(cn()).toBe('');
  });
});
