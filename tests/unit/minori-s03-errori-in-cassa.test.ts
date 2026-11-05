import { describe, expect, it } from 'vitest';
import { friendlyError } from '@/lib/errors';

/** S03 — scheda 273: il motivo vero del rifiuto in cassa arriva anche se il negozio comincia con una cifra o le virgolette. */
describe('friendlyError e i nomi dei negozi', () => {
  for (const nome of ['3 Archi', '«Da Mario»', "'L Furnè", 'Pane Quotidiano']) {
    it(`«${nome}» adesso è chiuso: la frase arriva intera`, () => {
      const frase = `${nome} adesso è chiuso: la consegna veloce non si può. Scegli una fascia oraria.`;
      expect(friendlyError(new Error(frase))).toBe(frase);
    });
  }
});

describe('friendlyError non fa passare i codici tecnici', () => {
  it('«500 Internal Server Error» resta generico', () => {
    expect(friendlyError(new Error('500 Internal Server Error'))).not.toMatch(/Internal/);
  });
});
