import { describe, it, expect } from 'vitest';
import { etichettaPronto, ORDER_STATUS_LABEL } from '@/lib/order-status';

/** R02-007 — a casa il pulsante «Pronto» dice «fattorino», come in tutto il resto del sito. */
describe('R02-007 · «Pronto per il fattorino»', () => {
  it('col ritiro in negozio spento dice fattorino, non rider', () => {
    expect(etichettaPronto(false)).toBe('Pronto per il fattorino');
    expect(etichettaPronto(false)).not.toMatch(/rider/i);
  });

  it('col ritiro acceso resta «Pronto per il ritiro»', () => {
    expect(etichettaPronto(true)).toBe('Pronto per il ritiro');
  });

  it('l etichetta dello stato READY segue (ritiro in negozio spento)', () => {
    expect(ORDER_STATUS_LABEL.READY).toBe(etichettaPronto());
    expect(ORDER_STATUS_LABEL.READY).not.toMatch(/rider/i);
  });
});
