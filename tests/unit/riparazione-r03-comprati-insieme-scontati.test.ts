/**
 * @vitest-environment jsdom
 */
/**
 * R03-010 — «Spesso comprati insieme» sulla scheda prodotto metteva nel carrello il prezzo pieno
 * anche con una promozione attiva, mentre «Completa con» del carrello (CartUpsell) lo sconta: il
 * carrello poi scriveva «il prezzo è cambiato». Ora la fascia fa lo stesso calcolo di CartUpsell
 * (fetchActiveDiscounts + discountedUnitCents): con lo sconto il carrello riceve il prezzo
 * scontato, senza sconto il pieno.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  sconti: [] as Array<{ product_id: string; discount_percent: number }>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async (nome: string) =>
      nome === 'product_active_discounts'
        ? { data: mondo.sconti, error: null }
        : { data: 0, error: null },
  },
}));
// La lettura dei prodotti dello stesso negozio: due prodotti senza varianti.
vi.mock('@/lib/queries/fasce-prodotti', () => ({
  leggiSpessoCompratiInsieme: async () => [
    { id: 'p-olio', name: 'Olio', price: 10, images: null, stock: 5, has_variants: false, seller_id: 'neg-1' },
    { id: 'p-sale', name: 'Sale', price: 2.5, images: null, stock: 5, has_variants: false, seller_id: 'neg-1' },
  ],
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, message: () => undefined, info: () => undefined }),
}));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({ trackAddToCart: () => undefined, trackRemoveFromCart: () => undefined }));

import { FrequentlyBoughtTogether } from '@/components/products/FrequentlyBoughtTogether';

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.sconti = [];
});

function Guscio() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(
    QueryClientProvider,
    { client: qc },
    createElement(FrequentlyBoughtTogether, { productId: 'p-pane', sellerId: 'neg-1', storeName: 'Bottega' }),
  );
}

async function apri() {
  schermo = accendi(Guscio);
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

const aggiungi = async (radice: HTMLElement, nome: string) => {
  const scheda = Array.from(radice.querySelectorAll('div')).find(
    (d) => d.querySelector('p')?.textContent === nome && d.querySelector('button'),
  )!;
  await act(async () => { clicca(scheda.querySelector('button')!); });
};

const prezzoNelCarrello = (id: string) =>
  (JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ id: string; price: number }>).find((r) => r.id === id)?.price;

describe('R03-010 · «spesso comprati insieme» mette nel carrello il prezzo di oggi', () => {
  it('con una promozione del 20% sull olio, il carrello riceve 8 €, non 10 €', async () => {
    mondo.sconti = [{ product_id: 'p-olio', discount_percent: 20 }];
    const radice = await apri();
    await aggiungi(radice, 'Olio');
    expect(prezzoNelCarrello('p-olio'), 'con la promo attiva il carrello deve ricevere il prezzo scontato').toBe(8);
  });

  it('senza promozione il carrello riceve il prezzo pieno', async () => {
    mondo.sconti = [{ product_id: 'p-olio', discount_percent: 20 }];
    const radice = await apri();
    await aggiungi(radice, 'Sale');
    expect(prezzoNelCarrello('p-sale')).toBe(2.5);
  });
});
