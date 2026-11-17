/**
 * @vitest-environment jsdom
 */
/**
 * R28-007 — Con «negozi aperti ora» la griglia dei prodotti (ricerca, categoria) si rifà al passare
 * dell'ora di chiusura. Giovedì 29/10/2026 alle 12:59:30 a Piacenza il forno (9–13) è aperto; un minuto
 * dopo ha chiuso e il suo prodotto deve uscire senza ricaricare la pagina.
 * (L'elenco dei negozi, app/stores/page.tsx, è già coperto da riparazione-r23-aperti-ora-si-aggiorna.)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: [{ seller_id: 's1' }], error: null }) },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async () => [
    { id: 'p1', name: 'Pizza del Forno', price: 5, compare_at_price: null, images: [], seller_id: 's1', stock: 5, category_id: 'c1',
      profiles: { store_name: 'Forno Mattutino', store_hours: { thu: [['09:00', '13:00']] } } },
  ],
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

afterEach(() => vi.useRealTimers());

describe('R28-007 — i prodotti del negozio che chiude escono entro il minuto', () => {
  it('con «negozi aperti ora» acceso, passato l\'orario di chiusura il prodotto non c\'è più', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    // Si finge solo l'orologio e il battito: i timer veri servono alla lettura dei dati.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-10-29T11:59:30Z'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(ProductGrid, { onlyOpenStores: true } as never)));
    });
    for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(radice.textContent).toContain('Pizza del Forno');

    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(radice.textContent).not.toContain('Pizza del Forno');
    act(() => root.unmount());
  }, 60000);
});
