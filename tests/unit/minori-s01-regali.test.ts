import { describe, it, expect } from 'vitest';
import { categorieRegalabili } from '@/app/regali/categorie-regalabili';

/** S01 — 167: la pagina Regali vede anche i prodotti delle sottocategorie. */
describe('167 — le figlie delle categorie regalabili', () => {
  const righe = [
    { id: 'alim', slug: 'alimentari', name: 'Alimentari', parent_id: null },
    { id: 'salum', slug: 'salumeria', name: 'Salumeria', parent_id: 'alim' },
    { id: 'pane', slug: 'panificio', name: 'Panificio', parent_id: 'alim' },
    { id: 'ferr', slug: 'ferramenta', name: 'Ferramenta', parent_id: null },
    { id: 'viti', slug: 'viti', name: 'Viti', parent_id: 'ferr' },
  ];
  it('Salumeria e Panificio entrano con Alimentari, Ferramenta no', () => {
    const ids = categorieRegalabili(righe, new Set(['alimentari']), ['regal']);
    expect(ids.sort()).toEqual(['alim', 'pane', 'salum']);
  });
});
