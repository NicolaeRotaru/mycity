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

const mondo = vi.hoisted(() => ({ pagina: [] as unknown[] }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async () => mondo.pagina,
}));
vi.mock('@/components/ProductCard', () => ({ default: () => null }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

const riga = (i: number) => ({ id: `p${i}`, name: `Pane ${i}`, price: 3, compare_at_price: null, images: [], seller_id: 's1', stock: 5, category_id: null, profiles: { store_name: 'Forno', store_hours: null } });

function paginaCon(rimaste: number, lette: number | null) {
  const p = Array.from({ length: rimaste }, (_, i) => riga(i));
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
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return { testo: radice.textContent ?? '', smonta: () => act(() => root.unmount()) };
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
});
