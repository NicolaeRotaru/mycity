/**
 * @vitest-environment jsdom
 *
 * R11-007 — Le collezioni scelte a mano dal negozio (components/store-sections/CollectionSection.tsx)
 * non passavano a ProductCard il prezzo barrato del venditore (`compare_at_price`): la griglia sì
 * (ProductGrid), la collezione manuale no. Lo stesso prodotto «da 15 € a 10 €» nella griglia, nella
 * collezione si leggeva solo «10 €».
 *
 * Il database finto risponde SOLO con le colonne chieste nel `select`, come quello vero: se la
 * collezione non chiede `compare_at_price`, il dato non arriva. La scheda è finta e annota quello
 * che riceve.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  righe: [] as Array<Record<string, unknown>>,
  schede: [] as Array<{ id: string; price: number; compareAtPrice?: number | null; discountPercent?: number }>,
}));

vi.mock('@/lib/supabase/client', () => {
  const domanda = () => {
    let colonne: string[] = [];
    const c: Record<string, unknown> = {};
    c.select = (testo: string) => { colonne = testo.split(',').map((x) => x.trim()); return c; };
    c.eq = () => c;
    // Come PostgREST: nella risposta solo le colonne chieste.
    c.in = async () => ({
      data: mondo.righe.map((r) => Object.fromEntries(colonne.filter((k) => k in r).map((k) => [k, r[k]]))),
      error: null,
    });
    return c;
  };
  return {
    supabase: {
      from: () => domanda(),
      rpc: async (nome: string, argomenti: { p_products?: string[] }) => {
        if (nome !== 'product_active_discounts') return { data: null, error: { message: 'rpc sconosciuta' } };
        return { data: (argomenti.p_products ?? []).map((id) => ({ product_id: id, discount_percent: 0 })), error: null };
      },
    },
  };
});
vi.mock('@/components/ProductCard', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: (p: { id: string; name: string; price: number; compareAtPrice?: number | null; discountPercent?: number }) => {
      mondo.schede.push({ id: p.id, price: p.price, compareAtPrice: p.compareAtPrice, discountPercent: p.discountPercent });
      return ce('div', { 'data-scheda': p.id }, p.name);
    },
  };
});
vi.mock('@/components/ProductGrid', () => ({ default: () => null }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mondo.righe = [
    { id: 'torta', name: 'Torta di riso', description: null, price: '10.00', compare_at_price: '15.00', images: [], stock: 5, has_variants: false, created_at: '2026-10-01T00:00:00Z' },
    { id: 'biscotti', name: 'Biscotti', description: null, price: 6, compare_at_price: null, images: [], stock: 5, has_variants: false, created_at: '2026-10-01T00:00:00Z' },
  ];
  mondo.schede = [];
});
afterEach(() => { document.body.innerHTML = ''; });

async function disegna(layout: 'grid' | 'carousel') {
  const { default: CollectionSection } = await import('@/components/store-sections/CollectionSection');
  const ctx = { storeId: 's1', accent: '#C0492C', store: { store_name: 'Pane Quotidiano' } } as never;
  const config = { heading: 'Le torte della domenica', layout, source: { kind: 'manual', productIds: ['torta', 'biscotti'] } } as never;
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { radice.render(createElement(QueryClientProvider, { client }, createElement(CollectionSection, { ctx, config }))); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => radice.unmount());
}

const ultima = (id: string) => [...mondo.schede].reverse().find((s) => s.id === id);

describe('R11-007 · la collezione scelta a mano passa il prezzo barrato del negozio', () => {
  it.each(['grid', 'carousel'] as const)('la torta «da 15 € a 10 €» arriva alla scheda col pieno barrato (%s)', async (layout) => {
    await disegna(layout);
    expect(ultima('torta'), 'la torta non è arrivata alla scheda').toBeDefined();
    expect(ultima('torta')?.compareAtPrice, 'la collezione non passa il prezzo barrato del venditore').toBe(15);
    expect(ultima('torta')?.price).toBe(10);
  });

  it('un prodotto senza prezzo barrato non ne riceve uno', async () => {
    await disegna('grid');
    expect(ultima('biscotti')).toBeDefined();
    expect(ultima('biscotti')?.compareAtPrice ?? null).toBeNull();
  });
});
