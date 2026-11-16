// @vitest-environment jsdom
/**
 * R27-011 — Con una promozione attiva la fascia «di tendenza» in home scriveva il prezzo pieno,
 * mentre la scheda e la cassa mostrano quello scontato. Qui il componente VERO, con la lettura
 * dei prodotti e lo sconto finti: il prezzo stampato deve essere quello che si paga.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }),
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/queries/fasce-prodotti', () => ({
  leggiTendenze: async () => [
    { product_id: 'p1', view_count: 9, product: { id: 'p1', name: 'Pane', price: 20, images: [], profiles: null } },
    { product_id: 'p2', view_count: 7, product: { id: 'p2', name: 'Latte', price: 3, images: [], profiles: null } },
  ],
}));
const sconti = vi.hoisted(() => ({ mappa: new Map<string, number>(), rotto: false }));
vi.mock('@/lib/promotions', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => {
    if (sconti.rotto) throw new Error('rete');
    return sconti.mappa;
  },
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: TrendingNow } = await import('@/components/home/TrendingNow');

async function monta() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(TrendingNow))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { testo: div.textContent ?? '', root };
}

describe('R27-011 — «di tendenza» scrive il prezzo che si paga', () => {
  it('con il 25% su p1 mostra 15,00 e non 20,00; p2 resta 3,00', async () => {
    sconti.rotto = false;
    sconti.mappa = new Map([['p1', 25]]);
    const { testo, root } = await monta();
    expect(testo).toMatch(/15,00/);
    expect(testo).not.toMatch(/20,00/);
    expect(testo).toMatch(/3,00/);
    root.unmount();
  });
  it('se lo sconto non si legge la fascia c\'è lo stesso, a prezzo pieno', async () => {
    sconti.rotto = true;
    const { testo, root } = await monta();
    expect(testo).toMatch(/20,00/);
    root.unmount();
  });
});
