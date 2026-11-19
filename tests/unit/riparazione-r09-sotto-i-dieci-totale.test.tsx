/**
 * @vitest-environment jsdom
 */
/**
 * R09-004 — La pagina «Sotto i 10 €» scriveva «40 prodotti» (le schede caricate) con 106 in catalogo.
 * Il numero che la griglia passa a `onCount` deve essere il totale vero chiesto al database, che conta
 * con lo stesso filtro di prezzo della lettura (soglia esclusa).
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const chiamate = vi.hoisted(() => ({ conta: [] as Array<Record<string, unknown>> }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  inizioFinestraNovita: () => '2026-11-05T00:00:00.000Z',
  leggiProdottiDellaGriglia: async () =>
    Array.from({ length: 40 }, (_, i) => ({
      id: `p${i}`, name: `Prodotto ${i}`, price: 4, compare_at_price: null, images: [], seller_id: 's1', stock: 5, category_id: 'c1',
      created_at: '2026-11-01T00:00:00Z', profiles: { store_name: 'Forno', is_approved: true, store_hours: {} },
    })),
  contaProdottiDellaGriglia: async (_db: unknown, d: Record<string, unknown>) => {
    chiamate.conta.push(d);
    return 106;
  },
}));
vi.mock('@/components/ProductCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: { name: string }) => ce('span', null, p.name) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

describe('R09-004 — il numero sopra «Sotto i 10 €» è il totale, non le schede caricate', () => {
  it('con 40 schede e 106 prodotti, onCount riceve 106 e il conteggio usa la soglia esclusa', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    const onCount = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(ProductGrid, { prezzoSotto: 10, limit: 40, onCount } as never)));
    });
    for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(onCount).toHaveBeenCalled();
    expect(onCount.mock.calls.at(-1)?.[0]).toBe(106);
    expect(chiamate.conta.at(-1)?.maxPrice).toBeCloseTo(9.995, 5);
    act(() => root.unmount());
  }, 60000);
});
