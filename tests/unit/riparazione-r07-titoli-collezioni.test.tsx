/**
 * @vitest-environment jsdom
 */
/**
 * R07-009 (12/11/2026) — nelle pagine Regali, Novità e I più recensiti i titoli
 * saltavano dall'h1 della testata all'h3 del nome di ogni prodotto. La griglia
 * delle pagine collezione ora porta un h2 (visibile solo al lettore di schermo) prima delle
 * schede; quella della vetrina, che ha già il suo h2, no.
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
vi.mock('@/components/ProductCard', async () => {
  const { createElement } = await import('react');
  return {
  default: (p: Record<string, unknown>) => {
    mondo.schede.push(p);
    return createElement('h3', null, String(p.name));
  },
  };
});
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
  return { radice, smonta: () => act(() => root.unmount()) };
}

beforeEach(() => {
  mondo.rpc = {};
  mondo.prodotti = [FOCACCIA];
  mondo.grigliaInErrore = false;
  mondo.schede = [];
});

describe('R07-009 · fra l h1 della pagina e l h3 dei prodotti c è un h2', () => {
  it('griglia di una pagina collezione (senza title): il primo titolo è un h2, prima del primo h3', async () => {
    const g = await monta({ limit: 40, sort: 'newest', maxColumns: 4, titoloNascosto: 'I prodotti nuovi' });
    const titoli = Array.from(g.radice.querySelectorAll('h1,h2,h3,h4')).map((e) => e.tagName);
    expect(titoli).toContain('H3');
    expect(titoli[0]).toBe('H2');
    g.smonta();
  });

  it('la griglia della vetrina, che ha già il suo h2 sopra, non ne aggiunge un secondo', async () => {
    const g = await monta({ sellerId: 's1', maxColumns: 4 });
    expect(g.radice.querySelectorAll('h2').length).toBe(0);
    g.smonta();
  });
});
