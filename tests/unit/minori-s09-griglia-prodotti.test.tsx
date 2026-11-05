/**
 * @vitest-environment jsdom
 */
/**
 * S09 — La griglia dei prodotti (components/ProductGrid.tsx), montata davvero.
 *  585 — se «chi è aperto» o «voto minimo» non si leggono, la griglia dice che non sa, non che i filtri sono stretti;
 *  427 — con la lettura in errore non si dichiara «0 prodotti»;
 *  279/584 — lo sconto della promozione arriva alla scheda anche fuori dalla vetrina;
 *  276 — col voto minimo, finché le medie non arrivano, non compare «Nessun prodotto trovato».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  rpc: {} as Record<string, () => Promise<{ data: unknown; error: unknown }>>,
  prodotti: [] as unknown[],
  grigliaInErrore: false,
  schede: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (nome: string) => (mondo.rpc[nome] ?? (async () => ({ data: [], error: null })))(),
  },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async () => {
    if (mondo.grigliaInErrore) throw new Error('rete giù');
    return mondo.prodotti;
  },
}));
vi.mock('@/components/ProductCard', () => ({
  default: (p: Record<string, unknown>) => {
    mondo.schede.push(p);
    return null;
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

const FOCACCIA = { id: 'p1', name: 'Focaccia', price: 10, compare_at_price: null, images: [], seller_id: 's1', stock: 5, category_id: 'c1', profiles: { store_name: 'Pane Quotidiano', store_hours: null } };

async function monta(props: Record<string, unknown>) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(ProductGrid, props as never)));
  });
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return { testo: radice.textContent ?? '', smonta: () => act(() => root.unmount()) };
}

beforeEach(() => {
  mondo.rpc = {};
  mondo.prodotti = [FOCACCIA];
  mondo.grigliaInErrore = false;
  mondo.schede = [];
});

describe('585 — un filtro che non si legge non diventa «filtri troppo stretti»', () => {
  it('negozi_aperti_adesso in errore', async () => {
    mondo.rpc.negozi_aperti_adesso = async () => ({ data: null, error: { message: 'giù' } });
    const g = await monta({ onlyOpenStores: true, emptyTitle: 'I filtri attivi sono troppo stretti' });
    expect(g.testo).not.toContain('troppo stretti');
    expect(g.testo).toContain('Non riesco a sapere chi è aperto adesso');
    g.smonta();
  });
  it('prodotti_con_voto_almeno in errore', async () => {
    mondo.rpc.prodotti_con_voto_almeno = async () => ({ data: null, error: { message: 'giù' } });
    const g = await monta({ minRating: 4, emptyTitle: 'I filtri attivi sono troppo stretti' });
    expect(g.testo).not.toContain('troppo stretti');
    expect(g.testo).toContain('Non riesco a leggere i voti');
    g.smonta();
  });
});

describe('427 — con la lettura in errore non si dichiara «0 prodotti»', () => {
  it('onCount non riceve 0', async () => {
    mondo.grigliaInErrore = true;
    const conti: number[] = [];
    const g = await monta({ onCount: (n: number) => conti.push(n) });
    expect(g.testo).toContain('Impossibile caricare i prodotti');
    expect(conti).not.toContain(0);
    g.smonta();
  });
});

describe('279/584 — lo sconto della promozione arriva alla scheda', () => {
  it('in una griglia di categoria (senza negozio)', async () => {
    mondo.rpc.product_active_discounts = async () => ({ data: [{ product_id: 'p1', discount_percent: 20 }], error: null });
    const g = await monta({ categoryId: 'c1' });
    expect(mondo.schede.at(-1)?.discountPercent).toBe(20);
    g.smonta();
  });
  it('nella vetrina, anche se la pagina ha già messo in memoria le sue promozioni', async () => {
    mondo.rpc.product_active_discounts = async () => ({ data: [{ product_id: 'p1', discount_percent: 15 }], error: null });
    const g = await monta({ sellerId: 's1' });
    expect(mondo.schede.at(-1)?.discountPercent).toBe(15);
    g.smonta();
  });
});

describe('276 — col voto minimo il prodotto filtrato dal database si vede', () => {
  it('senza aspettare le medie nel browser', async () => {
    mondo.rpc.prodotti_con_voto_almeno = async () => ({ data: [{ product_id: 'p1' }], error: null });
    mondo.rpc.product_rating_stats = () => new Promise(() => {}); // non arriva mai
    const g = await monta({ minRating: 4 });
    expect(g.testo).not.toContain('Nessun prodotto trovato');
    expect(mondo.schede.length).toBeGreaterThan(0);
    g.smonta();
  });
});
