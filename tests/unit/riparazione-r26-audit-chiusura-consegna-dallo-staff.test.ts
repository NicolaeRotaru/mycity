import { describe, it, expect } from 'vitest';
import { AZIONI_AUDIT, etichettaAzioneAudit, opzioniFiltroAudit } from '@/lib/audit-azioni';

describe("l'audit conosce la chiusura della consegna fatta dallo staff", () => {
  it('il catalogo la contiene con un\'etichetta italiana', () => {
    expect((AZIONI_AUDIT as readonly string[]).includes('order.delivery_closed_by_admin')).toBe(true);
    expect(etichettaAzioneAudit('order.delivery_closed_by_admin')).toBe('Consegna chiusa dallo staff');
  });
  it('compare tra le opzioni del filtro', () => {
    expect(opzioniFiltroAudit()).toContainEqual({
      valore: 'order.delivery_closed_by_admin',
      etichetta: 'Consegna chiusa dallo staff',
    });
  });
});
