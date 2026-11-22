/**
 * @vitest-environment jsdom
 */
/**
 * R11-008 — Il conteggio della griglia riceve anche «aperti ora» (e il voto): la griglia montata
 * deve passare a `contaProdottiDellaGriglia` l'elenco dei negozi aperti, e non partire senza.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({ domande: [] as Array<Record<string, unknown>>, aperti: ['s1'] as string[] }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async (nome: string) => ({
      data: nome === 'negozi_aperti_adesso' ? mondo.aperti.map((seller_id) => ({ seller_id })) : [],
      error: null,
    }),
  },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async () => [],
  contaProdottiDellaGriglia: async (_db: unknown, d: Record<string, unknown>) => { mondo.domande.push(d); return 7; },
  idsCheInPromoScendonoSotto: async () => [],
  inizioFinestraNovita: () => '2026-11-07T00:00:00.000Z',
}));
vi.mock('@/components/ProductCard', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

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
  return { smonta: () => act(() => root.unmount()) };
}

describe('R11-008 · il conteggio riceve «aperti ora»', () => {
  it('con soloNovita e onlyOpenStores il conteggio chiede solo i negozi aperti', async () => {
    mondo.domande = [];
    mondo.aperti = ['s1', 's2'];
    const g = await monta({ soloNovita: true, onlyOpenStores: true });
    expect(mondo.domande.length).toBeGreaterThan(0);
    for (const d of mondo.domande) expect(d.apertiOra).toEqual(['s1', 's2']);
    g.smonta();
  });
  it('senza il filtro il conteggio non lo porta', async () => {
    mondo.domande = [];
    const g = await monta({ soloNovita: true });
    expect(mondo.domande.length).toBeGreaterThan(0);
    for (const d of mondo.domande) expect(d.apertiOra).toBeUndefined();
    g.smonta();
  });
});
