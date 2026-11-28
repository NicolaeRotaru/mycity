import { describe, it, expect } from 'vitest';
import { etichettaPronto, etichettaProntoGenerica, ORDER_STATUS_LABEL } from '@/lib/order-status';

/** R02-007 — a casa il pulsante «Pronto» dice «fattorino», come in tutto il resto del sito. */
describe('R02-007 · «Pronto per il fattorino»', () => {
  it('col ritiro in negozio spento dice fattorino, non rider', () => {
    expect(etichettaPronto(false)).toBe('Pronto per il fattorino');
    expect(etichettaPronto(false)).not.toMatch(/rider/i);
  });

  it('col ritiro acceso resta «Pronto per il ritiro»', () => {
    expect(etichettaPronto(true)).toBe('Pronto per il ritiro');
  });

  // R12-009 (28/11/2026) — Col ritiro acceso la targhetta generica dice «Pronto in negozio», vero per
  // le due strade; spento resta «Pronto per il fattorino».
  it('l etichetta dello stato READY segue l interruttore del ritiro', () => {
    expect(ORDER_STATUS_LABEL.READY).toBe(etichettaProntoGenerica());
    expect(ORDER_STATUS_LABEL.READY).not.toMatch(/rider/i);
  });
});
