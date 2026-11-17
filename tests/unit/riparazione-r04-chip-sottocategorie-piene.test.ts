/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 17/11/2026 — La pagina di una categoria madre metteva un bottone per ogni sottocategoria,
 * anche per quelle senza prodotti: un clic e si arrivava al vuoto. Ora restano solo quelle con
 * qualcosa dentro, con la stessa lettura «categorie piene» di home, piede e indice. Se quella
 * lettura cade, si mostrano tutte come prima.
 */
type Opzioni = { queryKey: readonly unknown[] };
const g = globalThis as Record<string, unknown>;

const MADRE = {
  category: { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  madre: null,
  subcategories: [
    { id: 'c-forno', slug: 'forno', name: 'Forno', icon: null },
    { id: 'c-vini', slug: 'vini', name: 'Vini', icon: null },
  ],
};
// Una sottocategoria che ha a sua volta figlie: la pagina è a griglia, con i bottoni sopra.
const MEZZANA = {
  category: { id: 'c-forno', slug: 'forno', name: 'Forno', icon: null, parent_id: 'c-alim' },
  madre: { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  subcategories: [
    { id: 'c-pane', slug: 'pane', name: 'Pane', icon: null },
    { id: 'c-dolci', slug: 'dolci', name: 'Dolci', icon: null },
  ],
};
const PIENE = ['c-alim', 'c-forno', 'c-pane'];

afterEach(() => {
  delete g.__DATI_QUERY__;
  delete g.__ESITO_QUERY__;
});

function bottoniVerso(radice: Element, slug: string) {
  return [...radice.querySelectorAll(`a[href="/category/${slug}"]`)].map((a) => testoVisibile(a));
}

async function apri(albero: typeof MADRE | typeof MEZZANA, slug: string, pieneCadute = false) {
  g.__DATI_QUERY__ = function dati(o: Opzioni) {
    if (o.queryKey[0] === 'category') return albero;
    if (o.queryKey[0] === 'categories' && o.queryKey[1] === 'con-prodotti') return pieneCadute ? undefined : PIENE;
    return undefined;
  };
  g.__ESITO_QUERY__ = function esito(o: Opzioni) {
    return pieneCadute && o.queryKey[0] === 'categories' && o.queryKey[1] === 'con-prodotti'
      ? { isError: true, isSuccess: false, data: undefined }
      : null;
  };
  const mod = await monta('app/category/[slug]/page.tsx');
  return accendi(mod.default, { params: { slug } });
}

describe('i bottoni delle sottocategorie portano solo dove c’è qualcosa', () => {
  it('categoria madre: c’è il bottone verso la figlia piena, non quello verso la vuota', async () => {
    const s = await apri(MADRE, 'alimentari');
    expect(bottoniVerso(s.radice, 'forno')).toContain('Forno');
    expect(bottoniVerso(s.radice, 'vini')).toEqual([]);
    s.smonta();
  }, 60000);

  it('sottocategoria con figlie: stesso taglio', async () => {
    const s = await apri(MEZZANA, 'forno');
    expect(bottoniVerso(s.radice, 'pane')).toContain('Pane');
    expect(bottoniVerso(s.radice, 'dolci')).toEqual([]);
    s.smonta();
  }, 60000);

  it('se la lettura delle categorie piene cade, si mostrano tutte come prima', async () => {
    const s = await apri(MADRE, 'alimentari', true);
    expect(bottoniVerso(s.radice, 'forno')).toContain('Forno');
    expect(bottoniVerso(s.radice, 'vini')).toContain('Vini');
    s.smonta();
  }, 60000);
});
