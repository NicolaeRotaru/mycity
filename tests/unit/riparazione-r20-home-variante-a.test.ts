import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QUANDO_ARRIVA_SENZA_NEGOZIO } from '@/lib/promesse-pubbliche';

/** R20-009 — la variante A dell'hero non promette «in giornata» senza legarla agli orari del negozio. */
describe('R20-009 · titolo della home, variante A', () => {
  const src = readFileSync(join(process.cwd(), 'app/page.tsx'), 'utf8');
  const senzaCommenti = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const varianteA = senzaCommenti.slice(senzaCommenti.indexOf('  a: {'), senzaCommenti.indexOf('  b: {'));

  it('non dice più «Consegna in giornata.» da sola', () => {
    expect(varianteA).not.toMatch(/Consegna in giornata\./);
  });

  it('la consegna si dice con la frase della cassa e a negozio aperto', () => {
    expect(varianteA).toContain('QUANDO_ARRIVA_SENZA_NEGOZIO');
    expect(varianteA).toMatch(/a negozio aperto/);
    expect(QUANDO_ARRIVA_SENZA_NEGOZIO).toMatch(/in giornata/);
  });
});
