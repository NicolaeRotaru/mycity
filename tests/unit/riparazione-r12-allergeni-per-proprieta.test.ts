/**
 * R12-023 — L'obbligo di allergeni e ingredienti valeva solo finché la
 * categoria principale si chiamava esattamente «alimentari». Ora segue la
 * proprietà della radice (migrazione 363); senza la colonna resta il nome.
 * Il guardiano del database: tests/sql/rls/riparazione-r12-allergeni-per-proprieta.test.sql.
 */
import { describe, it, expect } from 'vitest';
import { getAttributesForCategory, statoAlCaricamentoDaFile } from '@/lib/category-attributes';

const albero = (radice: string, obbligo?: boolean) => [
  { id: 'r', slug: radice, parent_id: null, ...(obbligo === undefined ? {} : { richiede_dichiarazioni_alimentari: obbligo }) },
  { id: 'pane', slug: 'panificio', parent_id: 'r' },
];
const obbligatori = (cats: ReturnType<typeof albero>) =>
  getAttributesForCategory(cats, 'pane').fields.filter((f) => f.required).map((f) => f.key);

describe('R12-023 l obbligo degli allergeni segue la categoria', () => {
  it('una radice nuova «gastronomia» con l obbligo chiede allergeni e ingredienti', () => {
    expect(obbligatori(albero('gastronomia', true))).toEqual(expect.arrayContaining(['allergeni', 'ingredienti']));
  });

  it('e il caricamento da file la fa nascere bozza senza dichiarazioni', () => {
    expect(statoAlCaricamentoDaFile(albero('spesa-fresca', true), 'pane', {}).status).toBe('draft');
  });

  it('senza la colonna (database prima della 363) vale il nome, come prima', () => {
    expect(obbligatori(albero('alimentari'))).toEqual(expect.arrayContaining(['allergeni', 'ingredienti']));
    expect(obbligatori(albero('libri'))).toEqual([]);
  });

  it('una radice senza l obbligo resta senza campi obbligatori alimentari', () => {
    expect(obbligatori(albero('gastronomia', false))).not.toContain('allergeni');
  });

  it('l obbligo di una categoria in mezzo all albero vale anche se la radice non ce l ha (collaudo K03)', () => {
    const cats = [
      { id: 'r', slug: 'negozio', parent_id: null },
      { id: 'a', slug: 'alimentari', parent_id: 'r', richiede_dichiarazioni_alimentari: true },
      { id: 'pane', slug: 'panificio', parent_id: 'a' },
    ];
    expect(getAttributesForCategory(cats, 'pane').fields.filter((f) => f.required).map((f) => f.key))
      .toEqual(expect.arrayContaining(['allergeni', 'ingredienti']));
  });
});
