import { describe, it, expect } from 'vitest';
import { pluralize } from '@/lib/format';

/**
 * Test pluralize — utility italiana singolare/plurale.
 * Le stringhe UI sono ora gestite da next-intl (messages/it.json, en.json).
 * Vedi tests/unit/i18n.test.ts per la locale resolution.
 */
describe('pluralize', () => {
  it('returns singular for n=1', () => {
    expect(pluralize(1, 'prodotto', 'prodotti')).toBe('1 prodotto');
  });

  it('returns plural for n=0', () => {
    expect(pluralize(0, 'prodotto', 'prodotti')).toBe('0 prodotti');
  });

  it('returns plural for n>1', () => {
    expect(pluralize(5, 'prodotto', 'prodotti')).toBe('5 prodotti');
    expect(pluralize(100, 'prodotto', 'prodotti')).toBe('100 prodotti');
  });

  it('handles giorno/giorni', () => {
    expect(pluralize(1, 'giorno', 'giorni')).toBe('1 giorno');
    expect(pluralize(7, 'giorno', 'giorni')).toBe('7 giorni');
  });

  it('handles negative numbers deterministicamente', () => {
    expect(pluralize(-1, 'punto', 'punti')).toBe('-1 punti');
  });
});
