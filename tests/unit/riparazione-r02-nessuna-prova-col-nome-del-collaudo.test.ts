import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';

/**
 * R02-012 — Una prova si chiamava zz-collaudo-termini-chi: il nome diceva chi l'aveva scritta e quando,
 * non cosa protegge, e il prefisso «zz» la mandava in fondo all'elenco. Ora porta il nome di quello che
 * controlla: i Termini nominano chi gestisce il servizio anche senza le variabili del titolare.
 */
describe('R02-012 — la prova dei Termini ha il nome di quello che protegge', () => {
  it('il nome del collaudo non c’è più, quello che dice cosa protegge sì', () => {
    expect(existsSync('tests/unit/zz-collaudo-termini-chi.test.tsx')).toBe(false);
    expect(
      existsSync('tests/unit/riparazione-r02-i-termini-nominano-chi-gestisce-il-servizio-anche-senza-le-variabili-del-titolare.test.tsx'),
    ).toBe(true);
  });
});
