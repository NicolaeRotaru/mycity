/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { CHIAVE_CATEGORIE_PIENE } from '@/lib/queries/categorie-piene';

/**
 * 17/11/2026 — LA TENDINA «SFOGLIA PER CATEGORIA» E UNA RICARICA CADUTA.
 *
 * La tendina della ricerca mostra solo le categorie con qualcosa dentro. Ma se una ricarica di
 * «quali categorie sono piene» falliva, buttava via anche l'elenco già saputo (react-query 5 lo
 * tiene in mano anche in stato d'errore) e tornava a elencare le categorie vuote. Qui il SearchBar
 * vero si monta con il react-query vero e un database finto: la prima lettura riesce, la ricarica
 * cade, e la tendina deve restare quella delle categorie piene. Se invece non si è mai saputo
 * niente (prima lettura caduta), si mostrano tutte, come prima.
 */
const g = globalThis as Record<string, unknown>;

const CATEGORIE = [
  { id: 'c-alimentari', slug: 'alimentari', name: 'Alimentari', parent_id: null },
  { id: 'c-casa', slug: 'casa', name: 'Casa', parent_id: null },
  { id: 'c-moda', slug: 'moda', name: 'Moda', parent_id: null },
];
const PRODOTTI = [{ id: 'p-pane', category_id: 'c-alimentari', seller_id: 'n-forno' }];

let prodottiCaduti = false;

function database() {
  const catena = (tavola: string) => {
    const risposta = () => {
      if (tavola === 'categories') return { data: CATEGORIE, error: null };
      if (tavola === 'seller_public_profiles') return { data: [{ id: 'n-forno' }], error: null };
      if (tavola === 'products') {
        return prodottiCaduti ? { data: null, error: { message: 'TypeError: fetch failed' } } : { data: PRODOTTI, error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'limit', 'gt']) c[m] = () => c;
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risposta()).then(ok, ko);
    return c;
  };
  return { from: catena };
}

const nuovoClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

async function lascia(volte = 20) {
  for (let i = 0; i < volte; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function apriLaTendina(qc: QueryClient) {
  const mod = await monta('components/SearchBar.tsx', { veri: ['@tanstack/react-query'] });
  const SearchBar = mod.default as () => unknown;
  const schermo = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(SearchBar as never)));
  const campo = schermo.radice.querySelector('input') as HTMLInputElement;
  await act(async () => {
    campo.focus();
  });
  await lascia();
  const categorieInTendina = () =>
    Array.from(schermo.radice.querySelectorAll('a[href^="/category/"]')).map((a) => a.getAttribute('href'));
  return { schermo, categorieInTendina };
}

afterEach(() => {
  prodottiCaduti = false;
  delete g.__CLIENT_SUPABASE__;
  document.body.innerHTML = '';
});

describe('la tendina della ricerca e le categorie vuote', () => {
  it('ricarica caduta con le piene già note: la tendina non torna a elencare le vuote', async () => {
    g.__CLIENT_SUPABASE__ = database();
    const qc = nuovoClient();
    const { schermo, categorieInTendina } = await apriLaTendina(qc);
    expect(categorieInTendina(), 'la prima lettura deve dare solo Alimentari: la prova girerebbe a vuoto').toEqual(['/category/alimentari']);

    prodottiCaduti = true;
    await act(async () => {
      await qc.refetchQueries({ queryKey: CHIAVE_CATEGORIE_PIENE });
    });
    await lascia();
    const stato = qc.getQueryState(CHIAVE_CATEGORIE_PIENE);
    expect(stato?.status, 'la ricarica doveva cadere').toBe('error');
    expect(stato?.data, 'react-query tiene le piene già note').toEqual(['c-alimentari']);

    expect(categorieInTendina(), 'la ricarica caduta ha rimesso in tendina le categorie vuote').toEqual(['/category/alimentari']);
    schermo.smonta();
  }, 60000);

  it('prima lettura caduta, niente di saputo: si mostrano tutte, come prima', async () => {
    g.__CLIENT_SUPABASE__ = database();
    prodottiCaduti = true;
    const qc = nuovoClient();
    const { schermo, categorieInTendina } = await apriLaTendina(qc);
    expect(qc.getQueryState(CHIAVE_CATEGORIE_PIENE)?.status).toBe('error');
    expect(categorieInTendina()).toEqual(['/category/alimentari', '/category/casa', '/category/moda']);
    schermo.smonta();
  }, 60000);

  it('lettura riuscita: solo le piene', async () => {
    g.__CLIENT_SUPABASE__ = database();
    const qc = nuovoClient();
    const { schermo, categorieInTendina } = await apriLaTendina(qc);
    expect(categorieInTendina()).toEqual(['/category/alimentari']);
    schermo.smonta();
  }, 60000);
});
