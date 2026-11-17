/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { monta, testoVisibile } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';

/**
 * 17/11/2026 — Una categoria madre con la lettura dei prodotti caduta restava bianca: ogni fila
 * si nascondeva da sola e sotto i bottoni delle sottocategorie non c'era niente, né un messaggio
 * né un «riprova». Qui la pagina vera si monta con il database che non risponde sui prodotti.
 */
type Opzioni = { queryKey: readonly unknown[] };
const g = globalThis as Record<string, unknown>;

const ALBERO = {
  category: { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  madre: null,
  subcategories: [
    { id: 'c-forno', slug: 'forno', name: 'Forno', icon: null },
    { id: 'c-vini', slug: 'vini', name: 'Vini', icon: null },
  ],
};

afterEach(() => {
  delete g.__DATI_QUERY__;
  delete g.__ESITO_QUERY__;
});

function datiDellaPagina(o: Opzioni) {
  return o.queryKey[0] === 'category' ? ALBERO : undefined;
}
function prodottiGiu(o: Opzioni) {
  return o.queryKey[0] === 'products'
    ? { isError: true, isSuccess: false, data: undefined, error: new Error('rete giù') }
    : null;
}

async function pagina(prodottiCaduti: boolean) {
  g.__DATI_QUERY__ = datiDellaPagina;
  g.__ESITO_QUERY__ = prodottiCaduti ? prodottiGiu : null;
  const mod = await monta('app/category/[slug]/page.tsx');
  return accendi(mod.default, { params: { slug: 'alimentari' } });
}

describe('categoria madre con la lettura dei prodotti caduta', () => {
  it('dice che non riesce a caricare i prodotti e offre di riprovare', async () => {
    const s = await pagina(true);
    const testo = testoVisibile(s.radice);
    // La pagina c'è (titolo e sottocategorie)...
    expect(testo).toContain('Alimentari');
    expect(testo).toContain('Forno');
    // ...e sotto non resta il vuoto: c'è un messaggio d'errore con un modo per riprovare.
    expect(testo.toLowerCase()).toMatch(/non riesco a caricare/);
    const bottoni = [...s.radice.querySelectorAll('button')].map((b) => testoVisibile(b).toLowerCase());
    expect(bottoni.some((b) => b.includes('riprova'))).toBe(true);
    s.smonta();
  }, 60000);

  it('con la lettura riuscita non mostra nessun errore', async () => {
    const s = await pagina(false);
    expect(testoVisibile(s.radice).toLowerCase()).not.toMatch(/non riesco a caricare/);
    s.smonta();
  }, 60000);
});
