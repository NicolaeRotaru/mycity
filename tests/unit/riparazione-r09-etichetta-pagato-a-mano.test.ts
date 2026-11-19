import { describe, it, expect } from 'vitest';
import { etichettaStatoBonifico } from '@/lib/admin/etichette';

/** R09-013 — il dettaglio ordine dell'amministrazione non mostra più il codice grezzo. */
describe('R09-013 etichetta del bonifico fatto a mano', () => {
  it('PAID_MANUALLY si legge «pagato a mano»', () => {
    expect(etichettaStatoBonifico('PAID_MANUALLY')).toBe('pagato a mano');
  });
  it('gli altri stati restano com\'erano', () => {
    expect(etichettaStatoBonifico('TRANSFERRED')).toBe('pagato al negozio');
    expect(etichettaStatoBonifico(null)).toBe('—');
  });
});
