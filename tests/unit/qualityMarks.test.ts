import { describe, it, expect } from 'vitest';
import { deriveQualityMarks } from '@/lib/products/qualityMarks';

describe('deriveQualityMarks', () => {
  it('rileva DOP dal nome prodotto', () => {
    const marks = deriveQualityMarks({ name: 'Coppa Piacentina DOP 200g' });
    expect(marks.map((m) => m.key)).toContain('DOP');
    expect(marks.find((m) => m.key === 'DOP')?.tone).toBe('origin');
  });

  it('DOCG non genera un falso positivo DOC (word-boundary)', () => {
    const keys = deriveQualityMarks({ name: 'Gutturnio DOCG' }).map((m) => m.key);
    expect(keys).toContain('DOCG');
    expect(keys).not.toContain('DOC');
  });

  it('non matcha sigle minuscole dentro parole comuni', () => {
    // "documento" non deve attivare DOC; "doppio" non deve attivare DOP.
    const keys = deriveQualityMarks({ description: 'Allega il documento, formato doppio.' }).map((m) => m.key);
    expect(keys).not.toContain('DOC');
    expect(keys).not.toContain('DOP');
  });

  it('legge i booleani certificazione dagli attributi (true e "Sì")', () => {
    const keys = deriveQualityMarks({
      attributes: { bio: true, vegano: 'Sì', senza_glutine: false },
    }).map((m) => m.key);
    expect(keys).toContain('bio');
    expect(keys).toContain('vegano');
    expect(keys).not.toContain('senza_glutine');
  });

  it('riconosce le parole chiave nei tag liberi', () => {
    const keys = deriveQualityMarks({ tags: ['biologico', 'km0', 'estate'] }).map((m) => m.key);
    expect(keys).toContain('bio');
    expect(keys).toContain('km0');
  });

  it('deduplica bool bio + tag "biologico" in un solo marchio', () => {
    const marks = deriveQualityMarks({ attributes: { bio: true }, tags: ['biologico'] });
    expect(marks.filter((m) => m.key === 'bio')).toHaveLength(1);
  });

  it('ordina i marchi origin prima di natural/diet', () => {
    const marks = deriveQualityMarks({
      name: 'Salame Nostrano DOP',
      attributes: { senza_glutine: true, bio: true },
    });
    expect(marks[0].tone).toBe('origin');
  });

  it('input vuoto o nullo → nessun marchio', () => {
    expect(deriveQualityMarks({})).toEqual([]);
    expect(deriveQualityMarks({ tags: null, attributes: null })).toEqual([]);
    expect(deriveQualityMarks({ attributes: 'non-un-oggetto', tags: 42 })).toEqual([]);
  });
});
