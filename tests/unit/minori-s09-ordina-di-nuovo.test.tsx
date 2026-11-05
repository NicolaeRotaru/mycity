/**
 * @vitest-environment jsdom
 */
/**
 * S09 — «Ordina di nuovo» in home (components/home-sections/ReorderRail.tsx): schede 1717, 1736, 160.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const mondo = vi.hoisted(() => ({ data: null as unknown, chiamate: [] as unknown[][] }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mondo.data }) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: () => ce('img') };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children }: Record<string, unknown>) => ce('a', { href: String(href) }, children as never) };
});
vi.mock('@/lib/riordino', () => ({ riordina: async (a: unknown[]) => { mondo.chiamate.push(a); return 0; } }));

import ReorderRail from '@/components/home-sections/ReorderRail';

const riga = (id: string, nome: string, variante?: [string, string]) => ({
  product_id: id, quantity: 1, unit_price: 3, products: { name: nome, images: [] },
  variant_id: variante?.[0] ?? null, variant_label: variante?.[1] ?? null,
});
const ordine = (id: string, righe: unknown[]) => ({
  id, created_at: '2026-11-01', total_price: 10, seller_id: 'pane', seller: { store_name: 'Pane Quotidiano' }, order_items: righe,
});

async function monta() {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => { root.render(createElement(ReorderRail)); });
  return { radice, smonta: () => act(() => root.unmount()) };
}

beforeEach(() => { mondo.chiamate = []; });

describe('ReorderRail', () => {
  it('1717 — un solo ordine con pane, focaccia e grissini non diventa «la spesa che compri spesso»', async () => {
    mondo.data = { firstName: 'Elena', orders: [ordine('o1', [riga('pane', 'Pane'), riga('focaccia', 'Focaccia'), riga('grissini', 'Grissini')])] };
    const g = await monta();
    expect(g.radice.textContent).not.toMatch(/spesa della settimana|compri spesso/i);
    g.smonta();
  });

  it('1717 — i prodotti presi in almeno due ordini compaiono, senza un totale a prezzi vecchi', async () => {
    const tre = () => [riga('pane', 'Pane'), riga('focaccia', 'Focaccia'), riga('grissini', 'Grissini')];
    mondo.data = { firstName: 'Elena', orders: [ordine('o1', tre()), ordine('o2', tre())] };
    const g = await monta();
    const testo = g.radice.textContent ?? '';
    expect(testo).toContain('Quello che compri spesso');
    // La scheda dei prodotti frequenti (fino al suo pulsante) non dichiara più una cifra.
    expect(testo.slice(testo.indexOf('Quello che compri spesso'), testo.indexOf('Ricomprali tutti'))).not.toMatch(/€/);
    g.smonta();
  });

  it('1736/160 — «Riordina» passa il negozio e la variante', async () => {
    mondo.data = { firstName: null, orders: [ordine('o1', [riga('torta', 'Torta', ['v-grande', 'Grande'])])] };
    const g = await monta();
    const bottone = [...g.radice.querySelectorAll('button')].find((b) => b.textContent?.includes('Riordina'))!;
    await act(async () => { bottone.click(); });
    expect(mondo.chiamate[0]).toEqual([
      expect.objectContaining({ productId: 'torta', sellerId: 'pane', variantId: 'v-grande', variantLabel: 'Grande' }),
    ]);
    g.smonta();
  });
});
