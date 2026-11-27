import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('R12-004 — il commento del ritorno indietro dice quello che fa il codice', () => {
  const src = readFileSync(join(process.cwd(), 'scripts', 'prova-di-fumo.mjs'), 'utf8');
  it('non dice piu che un rilascio senza commit resta buono, come prima', () => {
    expect(src).not.toMatch(/resta buono,\s*\n\s*\*\s*come prima/);
  });
  it('dice che dal 24/11 l\'elenco da solo non sceglie piu', () => {
    expect(src).toMatch(/l'elenco da solo non sceglie piu' nessun rilascio/);
  });
});
