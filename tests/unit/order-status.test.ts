import { describe, it, expect } from 'vitest';
import {
  isPastStatus,
  isActiveStatus,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_ICON,
  ORDER_STATUS_COLOR,
  BUYER_TIMELINE,
  type OrderStatus,
} from '@/lib/order-status';

/**
 * Unit test per lib/order-status: timeline logic order lifecycle.
 *
 * Esperti consultati:
 * - Senior Backend: "Order status machine = critical path. Bug qui = ordini
 *   bloccati in stato fantasma. Test ogni transizione."
 */

describe('OrderStatus constants', () => {
  it('all statuses have label, icon, color', () => {
    const statuses: OrderStatus[] = [
      'NEW', 'ACCEPTED', 'READY', 'ASSIGNED',
      'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELED',
    ];
    for (const s of statuses) {
      expect(ORDER_STATUS_LABEL[s]).toBeTruthy();
      expect(ORDER_STATUS_ICON[s]).toBeDefined();
      expect(ORDER_STATUS_COLOR[s]).toBeDefined();
      expect(ORDER_STATUS_COLOR[s].bg).toContain('bg-');
      expect(ORDER_STATUS_COLOR[s].text).toContain('text-');
    }
  });

  it('BUYER_TIMELINE has 6 visible steps', () => {
    expect(BUYER_TIMELINE).toHaveLength(6);
    expect(BUYER_TIMELINE).not.toContain('CANCELED');
    expect(BUYER_TIMELINE).not.toContain('ASSIGNED');
  });
});

describe('isPastStatus', () => {
  it('NEW is past NEW (same step counts as completed)', () => {
    expect(isPastStatus('NEW', 'NEW')).toBe(true);
  });

  it('ACCEPTED is past NEW', () => {
    expect(isPastStatus('ACCEPTED', 'NEW')).toBe(true);
  });

  it('DELIVERED is past every prior step', () => {
    expect(isPastStatus('DELIVERED', 'NEW')).toBe(true);
    expect(isPastStatus('DELIVERED', 'ACCEPTED')).toBe(true);
    expect(isPastStatus('DELIVERED', 'READY')).toBe(true);
    expect(isPastStatus('DELIVERED', 'PICKED_UP')).toBe(true);
    expect(isPastStatus('DELIVERED', 'OUT_FOR_DELIVERY')).toBe(true);
  });

  it('NEW is NOT past ACCEPTED (not yet there)', () => {
    expect(isPastStatus('NEW', 'ACCEPTED')).toBe(false);
  });

  it('ACCEPTED is NOT past PICKED_UP', () => {
    expect(isPastStatus('ACCEPTED', 'PICKED_UP')).toBe(false);
  });

  it('READY is past ACCEPTED but not PICKED_UP', () => {
    expect(isPastStatus('READY', 'ACCEPTED')).toBe(true);
    expect(isPastStatus('READY', 'PICKED_UP')).toBe(false);
  });
});

describe('isActiveStatus', () => {
  it('returns true when current === step', () => {
    expect(isActiveStatus('NEW', 'NEW')).toBe(true);
    expect(isActiveStatus('DELIVERED', 'DELIVERED')).toBe(true);
  });

  it('returns false for non-matching statuses', () => {
    expect(isActiveStatus('NEW', 'ACCEPTED')).toBe(false);
    expect(isActiveStatus('DELIVERED', 'NEW')).toBe(false);
  });

  it('ASSIGNED collapses onto READY step', () => {
    // Il rider è stato assegnato ma non ha ancora ritirato.
    // Nella timeline buyer, mostriamo questo come "READY" attivo.
    expect(isActiveStatus('ASSIGNED', 'READY')).toBe(true);
  });

  it('ASSIGNED does NOT activate other steps', () => {
    expect(isActiveStatus('ASSIGNED', 'PICKED_UP')).toBe(false);
    expect(isActiveStatus('ASSIGNED', 'NEW')).toBe(false);
  });
});

describe('Timeline coherence with isPastStatus', () => {
  it('ASSIGNED counts as past READY (rider already accepted)', () => {
    expect(isPastStatus('ASSIGNED', 'READY')).toBe(true);
  });

  it('OUT_FOR_DELIVERY past all preparation steps', () => {
    expect(isPastStatus('OUT_FOR_DELIVERY', 'NEW')).toBe(true);
    expect(isPastStatus('OUT_FOR_DELIVERY', 'ACCEPTED')).toBe(true);
    expect(isPastStatus('OUT_FOR_DELIVERY', 'READY')).toBe(true);
    expect(isPastStatus('OUT_FOR_DELIVERY', 'PICKED_UP')).toBe(true);
  });
});
