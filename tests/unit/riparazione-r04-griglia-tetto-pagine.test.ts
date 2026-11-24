/**
 * @vitest-environment jsdom
 */
/**
 * R04-010 — La griglia con le pagine tutte scartate dal filtro dei negozi andava a leggere da sola
 * la pagina dopo, e poi quella dopo ancora, senza un tetto: con un catalogo lungo di negozi fuori
 * vetrina leggeva tutto, pagina per pagina, con lo scheletro a schermo.
 *
 * Adesso il giro da solo si ferma a cinque pagine in tutto; poi la griglia non dice «nessun
 * prodotto» (ce ne sono altre) e lascia «Carica altri prodotti», una pagina per pressione.
 * La griglia vera si monta col react-query vero; la lettura risponde per finestra.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  perFinestra: (_f: [number, number]) => [] as unknown[],
  finestre: [] as Array<[number, number]>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async (_c: unknown, d: { finestra: [number, number] }) => {
    mondo.finestre.push(d.finestra);
    return mondo.perFinestra(d.finestra);
  },
}));
vi.mock('@/components/ProductCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ name }: { name: string }) => ce('span', { 'data-nome': name }, name) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

const riga = (i: number) => ({ id: `p${i}`, name: `Pane ${i}`, price: 3, compare_at_price: null, images: [], seller_id: 's1', stock: 5, category_id: null, profiles: { store_name: 'Forno', store_hours: null } });

/** Una pagina con `rimaste` righe dopo il filtro dei negozi, e `lette` righe date dal database. */
function paginaCon(rimaste: number, lette: number, da = 0) {
  const p = Array.from({ length: rimaste }, (_, i) => riga(da + i));
  Object.defineProperty(p, 'righeLette', { value: lette, enumerable: false });
  return p;
}

// Ogni griglia montata si smonta anche se la prova cade: un giro senza fine non sporca la prova dopo.
const montate: Array<() => void> = [];
afterEach(() => {
  while (montate.length > 0) act(() => montate.pop()!());
});

const aspetta = async (giri: number) => {
  for (let i = 0; i < giri; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  montate.push(() => root.unmount());
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ProductGrid, { limit: 4 } as never)));
  });
  await aspetta(60);
  return {
    get testo() { return radice.textContent ?? ''; },
    nomi: () => Array.from(radice.querySelectorAll('[data-nome]')).map((e) => e.getAttribute('data-nome')),
    pulsante: () => Array.from(radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Carica altri')) as HTMLButtonElement | undefined,
    premi: async (b: HTMLElement) => {
      await act(async () => { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      await aspetta(40);
    },
  };
}

describe('R04-010 · il giro da solo della griglia ha un tetto di pagine', () => {
  it('pagine piene e tutte scartate, senza fine: si ferma a cinque pagine, senza scheletro e senza «nessun prodotto»', async () => {
    mondo.finestre = [];
    mondo.perFinestra = () => paginaCon(0, 4);
    const g = await monta();
    expect(mondo.finestre, 'la griglia ha letto da sola oltre il tetto').toEqual([[0, 3], [4, 7], [8, 11], [12, 15], [16, 19]]);
    expect(g.testo).not.toContain('Nessun prodotto trovato');
    expect(g.testo).toContain('Ancora nessun prodotto da mostrare');
    expect(g.pulsante(), 'dopo il tetto serve il pulsante per andare avanti').toBeTruthy();
  });

  it('dopo il tetto ogni pressione legge UNA pagina, e se arrivano prodotti si vedono', async () => {
    mondo.finestre = [];
    mondo.perFinestra = () => paginaCon(0, 4);
    const g = await monta();
    await g.premi(g.pulsante() as HTMLElement);
    expect(mondo.finestre).toHaveLength(6);
    expect(mondo.finestre[5]).toEqual([20, 23]);
    mondo.perFinestra = ([da]) => paginaCon(2, 4, da);
    await g.premi(g.pulsante() as HTMLElement);
    expect(mondo.finestre).toHaveLength(7);
    expect(g.nomi()).toEqual(['Pane 24', 'Pane 25']);
  });

  it('sotto il tetto il giro da solo resta: alla terza pagina arrivano prodotti e si vedono', async () => {
    mondo.finestre = [];
    mondo.perFinestra = ([da]) => (da < 8 ? paginaCon(0, 4) : paginaCon(1, 1, da));
    const g = await monta();
    expect(mondo.finestre).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(g.nomi()).toEqual(['Pane 8']);
    expect(g.pulsante()).toBeUndefined();
  });
});
