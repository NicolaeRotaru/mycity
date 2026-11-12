/**
 * R12-006 — Il documento delle decisioni del sito diceva ancora «commissione
 * all'8% più 15 euro al mese, da decidere» (ADR-006, «proposed»), mentre la
 * decisione vera è il 10% (MARKETPLACE_FEE_BPS). Chi lo apriva a mano leggeva 8%.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKETPLACE_FEE_BPS } from '@/lib/constants';

const doc = readFileSync(join(process.cwd(), 'docs/decisions.md'), 'utf8');
const sezione = (titolo: string) => {
  const i = doc.indexOf(titolo);
  return doc.slice(i, doc.indexOf('\n## ', i + 1));
};

describe('R12-006 le decisioni superate lo dicono', () => {
  it('ADR-006 (8%) è superata e rimanda al 10% del codice', () => {
    const s = sezione('## ADR-006');
    expect(s).toMatch(/\*\*Stato\*\*: superseded/);
    expect(s).toContain(`${MARKETPLACE_FEE_BPS / 100}%`);
    expect(s).toContain('MARKETPLACE_FEE_BPS');
  });
  it('ADR-007 (credito di benvenuto) non è più «proposed»', () => {
    expect(sezione('## ADR-007')).toMatch(/\*\*Stato\*\*: superseded/);
  });
});
