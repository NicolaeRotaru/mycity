import { describe, it, expect } from 'vitest';
import { ORDER_STATUS_LABEL } from '@/lib/order-status';

describe('R01-003 lo stato assegnato dice fattorino', () => {
  it('ASSIGNED si legge «Fattorino in arrivo», non «Rider in arrivo»', () => {
    expect(ORDER_STATUS_LABEL.ASSIGNED).toBe('Fattorino in arrivo');
    expect(ORDER_STATUS_LABEL.ASSIGNED).not.toMatch(/rider/i);
  });
});
