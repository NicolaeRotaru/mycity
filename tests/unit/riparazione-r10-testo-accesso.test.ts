import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// R10-006 — la schermata di accesso non promette più «100% commercianti locali verificati»:
// come in home dice «Commercianti locali».
describe('R10-006 testo della schermata di accesso', () => {
  const sorgente = readFileSync('components/ui/AuthShell.tsx', 'utf8');

  it('la frase assoluta non c\'è più', () => {
    expect(sorgente).not.toMatch(/100%\s*commercianti/i);
    expect(sorgente).not.toContain('commercianti locali verificati');
  });

  it('c\'è la frase della home', () => {
    expect(sorgente).toContain("text: 'Commercianti locali'");
  });
});
