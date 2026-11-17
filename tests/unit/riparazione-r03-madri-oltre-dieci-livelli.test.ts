import { describe, expect, it } from 'vitest';
import { conLeMadri } from '@/lib/queries/categorie-dei-negozi';

/**
 * 17/11/2026 — Il filtro per categoria della pagina «Negozi» aggiunge a ogni negozio le madri delle
 * sue categorie, ma risaliva al massimo dieci livelli: con un albero più profondo le madri più in
 * alto restavano fuori, e col filtro di una di loro il negozio spariva. Qui si risale fino alla
 * radice, e un giro chiuso (una categoria madre di sé stessa, anche passando da altre) si ferma.
 */
/** Una catena c0 (foglia) → c1 → … → c{n} (radice). */
function catena(livelli: number): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (let i = 0; i < livelli; i++) m.set(`c${i}`, `c${i + 1}`);
  m.set(`c${livelli}`, null);
  return m;
}

describe('il filtro per categoria dei negozi risale tutte le madri', () => {
  it('una catena di 14 livelli: la foglia si porta dietro tutte le madri, radice compresa', () => {
    const madreDi = catena(14);
    const tutte = conLeMadri(['c0'], madreDi);
    expect(tutte.size).toBe(15);
    for (let i = 0; i <= 14; i++) expect(tutte.has(`c${i}`)).toBe(true);
  });

  it('con due prodotti sulla stessa catena, a profondità diverse, le madri ci sono tutte lo stesso', () => {
    // La foglia prima: il secondo prodotto incontra subito categorie già viste e non deve fermarsi
    // su una risalita lasciata a metà.
    const madreDi = catena(14);
    expect([...conLeMadri(['c0', 'c3'], madreDi)].sort()).toEqual([...madreDi.keys()].sort());
  });

  it('un giro chiuso non blocca il filtro: si ferma, con tutte le categorie del giro', () => {
    const madreDi = new Map<string, string | null>([
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
      ['d', 'a'],
      ['e', 'e'],
    ]);
    expect([...conLeMadri(['d'], madreDi)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...conLeMadri(['e'], madreDi)]).toEqual(['e']);
  });

  it('una categoria senza madre resta sola, e una sconosciuta non porta dietro niente', () => {
    const madreDi = new Map<string, string | null>([['radice', null]]);
    expect([...conLeMadri(['radice', 'sconosciuta'], madreDi)].sort()).toEqual(['radice', 'sconosciuta']);
  });
});
