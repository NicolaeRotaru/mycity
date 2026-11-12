import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';

/**
 * R04-023 (prova leggera, testi) — Il business plan e i conti unitari
 * dicevano commissione all'8%, abbonamento a 15 €, piano gratis e mancia al
 * fattorino. Adesso dicono i numeri del codice e avvisano che le stime
 * derivate vanno rifatte.
 */
const PIANO = readFileSync('docs/business-plan.md', 'utf8');
const CONTI = readFileSync('docs/unit-economics.md', 'utf8');

describe('i documenti dicono i numeri del codice', () => {
  it('la commissione e\' quella di MARKETPLACE_FEE_BPS, non l\'8%', () => {
    const pct = `${MARKETPLACE_FEE_BPS / 100}%`;
    for (const doc of [PIANO, CONTI]) {
      expect(doc).toContain(pct);
      expect(doc).not.toMatch(/\b8% (sul GMV|commissione)|Take rate commissione \| 8%/);
    }
  });
  it('niente PRO a 15 €, niente piano gratuito, niente mancia', () => {
    expect(PIANO).not.toMatch(/€15\/mese/);
    expect(PIANO).not.toMatch(/\*\*Free tier\*\*/);
    expect(PIANO).not.toMatch(/10% tip/);
    expect(CONTI).not.toMatch(/Tip rider opzionale/);
  });
  it('in testa a tutti e due l\'avviso che sono superati in parte', () => {
    for (const doc of [PIANO, CONTI]) expect(doc.slice(0, 600)).toMatch(/Documento superato in parte/);
  });
});
