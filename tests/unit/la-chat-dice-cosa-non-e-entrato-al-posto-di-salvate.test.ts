import { describe, it, expect } from 'vitest';
import { esitoModificaDallaChat } from '@/lib/products/aiPatch';

/** 1/11/2026 — Se la rotta ha rifiutato un campo, la chat Assistenza non dice «salvate». */
describe('la frase della chat dopo «Applica»', () => {
  it('prezzo rifiutato: avviso col motivo, mai «salvate»', () => {
    const esito = esitoModificaDallaChat({
      ok: true,
      rifiutati: [{ campo: 'price', motivo: 'prezzo NON applicato (20.00 → 30.00 €: oltre il 30%)' }],
    });
    expect(esito.tipo).toBe('avviso');
    expect(esito.testo.toLowerCase()).not.toContain('salvate');
    expect(esito.testo).toContain('prezzo NON applicato');
  });

  it('nessun rifiuto: «Modifiche salvate»', () => {
    expect(esitoModificaDallaChat({ ok: true, rifiutati: [] })).toEqual({
      tipo: 'successo',
      testo: 'Modifiche salvate sul prodotto',
    });
  });
});
