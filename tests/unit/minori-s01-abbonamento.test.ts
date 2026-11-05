import { describe, it, expect } from 'vitest';
import { frasePrezzoNegozi } from '@/app/seller/earnings/commissione';

/** S01 — 59: con l'abbonamento acceso la frase dice la regola firmata: parte dopo il primo incasso. */
describe('59 — la frase del canone quando l abbonamento si accende', () => {
  it('non dice «dopo l approvazione», dice «dopo il primo incasso»', () => {
    const f = frasePrezzoNegozi(true);
    expect(f).not.toMatch(/approvazione/);
    expect(f).toMatch(/primo incasso/);
  });
  it('spento resta come oggi', () => {
    expect(frasePrezzoNegozi(false)).toContain('Nessun canone finché non incassi con MyCity.');
  });
});
