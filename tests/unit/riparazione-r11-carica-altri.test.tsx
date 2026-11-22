/**
 * @vitest-environment jsdom
 */
/**
 * R11-012 R11-007 — «Carica altri» non sparisce quando la pagina perde righe al filtro dei negozi.
 * La lettura dà alla pagina `righeLette` (non enumerabile); la griglia montata deve decidere
 * «ce n'è un'altra» su quelle, non sulle righe rimaste.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  pagina: [] as unknown[],
  // Se valorizzata, la lettura risponde per finestra (come il database) e ricorda le finestre chieste.
  perFinestra: null as null | ((finestra: [number, number]) => unknown[]),
  finestre: [] as Array<[number, number]>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async (_c: unknown, d: { finestra: [number, number] }) => {
    mondo.finestre.push(d.finestra);
    return mondo.perFinestra ? mondo.perFinestra(d.finestra) : mondo.pagina;
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

function paginaCon(rimaste: number, lette: number | null, da = 0) {
  const p = Array.from({ length: rimaste }, (_, i) => riga(da + i));
  if (lette !== null) Object.defineProperty(p, 'righeLette', { value: lette, enumerable: false });
  return p;
}

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ProductGrid, { limit: 4 } as never)));
  });
  for (let i = 0; i < 30; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return {
    client,
    radice,
    get testo() { return radice.textContent ?? ''; },
    nomi: () => Array.from(radice.querySelectorAll('[data-nome]')).map((e) => e.getAttribute('data-nome')),
    pulsante: () => Array.from(radice.querySelectorAll('button')).find((b) => b.textContent?.includes('Carica altri')) as HTMLButtonElement | undefined,
    premi: async (b: HTMLElement) => {
      await act(async () => { b.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    },
    smonta: () => act(() => root.unmount()),
  };
}

describe('R11-012 R11-007 · «Carica altri» e le righe scartate in fondo', () => {
  it('pagina piena al database, una riga scartata: il pulsante resta', async () => {
    mondo.pagina = paginaCon(3, 4);
    const g = await monta();
    expect(g.testo).toContain('Carica altri prodotti');
    g.smonta();
  });
  it('l ultima pagina vera: il pulsante non c è', async () => {
    mondo.pagina = paginaCon(2, 2);
    const g = await monta();
    expect(g.testo).not.toContain('Carica altri prodotti');
    g.smonta();
  });
  it('una pagina senza il conto delle righe lette vale la sua lunghezza', async () => {
    mondo.pagina = paginaCon(4, null);
    const g = await monta();
    expect(g.testo).toContain('Carica altri prodotti');
    g.smonta();
  });

  it('premendo «Carica altri» si chiede la finestra dopo (non ultima.length) e i prodotti nuovi compaiono', async () => {
    mondo.finestre = [];
    // Ogni finestra da 4 righe ne perde 1 al filtro dei negozi: 3 mostrate, 4 lette.
    mondo.perFinestra = ([da]) => paginaCon(3, 4, da);
    const g = await monta();
    expect(g.nomi()).toEqual(['Pane 0', 'Pane 1', 'Pane 2']);
    await g.premi(g.pulsante() as HTMLElement);
    expect(mondo.finestre).toEqual([[0, 3], [4, 7]]);
    expect(g.nomi()).toEqual(['Pane 0', 'Pane 1', 'Pane 2', 'Pane 4', 'Pane 5', 'Pane 6']);
    await g.premi(g.pulsante() as HTMLElement);
    expect(mondo.finestre).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(g.nomi()).toContain('Pane 8');
    g.smonta();
    mondo.perFinestra = null;
  });
  it('la prima pagina tutta filtrata: niente «Nessun prodotto», la griglia va a prendere la pagina dopo da sola', async () => {
    mondo.finestre = [];
    mondo.perFinestra = ([da]) => (da === 0 ? paginaCon(0, 4) : paginaCon(2, 2, da));
    const g = await monta();
    expect(mondo.finestre).toEqual([[0, 3], [4, 7]]);
    expect(g.nomi()).toEqual(['Pane 4', 'Pane 5']);
    expect(g.testo).not.toContain('Nessun prodotto');
    expect(g.pulsante()).toBeUndefined();
    g.smonta();
    mondo.perFinestra = null;
  });
  it('più pagine tutte filtrate di fila: continua finché trova righe, e si ferma alla fine senza giri infiniti', async () => {
    mondo.finestre = [];
    mondo.perFinestra = ([da]) => (da < 8 ? paginaCon(0, 4) : paginaCon(0, 1));
    const g = await monta();
    expect(mondo.finestre).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(g.testo).toContain('Nessun prodotto');
    g.smonta();
    mondo.perFinestra = null;
  });
  it('se una lettura sbaglia il giro si ferma (nessun giro infinito)', async () => {
    mondo.finestre = [];
    mondo.perFinestra = ([da]) => {
      if (da === 0) return paginaCon(0, 4);
      throw new Error('rete giù');
    };
    const g = await monta();
    expect(mondo.finestre).toEqual([[0, 3], [4, 7]]);
    g.smonta();
    mondo.perFinestra = null;
  });
  it('una rilettura con una riga in meno (prefisso uguale) tiene il conto delle righe lette: il pulsante resta', async () => {
    mondo.finestre = [];
    mondo.perFinestra = () => paginaCon(3, 4);
    const g = await monta();
    expect(g.pulsante()).toBeTruthy();
    mondo.perFinestra = () => paginaCon(2, 4);
    await act(async () => { await g.client.invalidateQueries(); });
    for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(g.nomi()).toEqual(['Pane 0', 'Pane 1']);
    expect(g.pulsante(), 'la condivisione strutturale ha ricopiato la pagina e perso righeLette').toBeTruthy();
    g.smonta();
    mondo.perFinestra = null;
  });
});
