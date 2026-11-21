/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R02-013 — Nelle collezioni scelte a mano dal negozio (components/store-sections/CollectionSection.tsx)
 * la scheda del prodotto riceveva solo il prezzo pieno, senza lo sconto della promozione attiva: la
 * griglia per categoria lo mostrava, la collezione manuale no. Ora la collezione legge lo sconto dalla
 * stessa fonte della griglia e della cassa e lo passa a ProductCard (che disegna prezzo scontato e
 * pieno barrato).
 */
const mondo = vi.hoisted(() => ({
  righe: [] as Array<Record<string, unknown>>,
  sconti: {} as Record<string, number>,
  rpcRotta: false,
  schede: [] as Array<{ id: string; price: number; discountPercent?: number }>,
}));

vi.mock('@/lib/supabase/client', () => {
  const catena = {
    select: () => catena,
    eq: () => catena,
    in: async () => ({ data: mondo.righe, error: null }),
  };
  return {
    supabase: {
      from: () => catena,
      rpc: async (nome: string, argomenti: { p_products?: string[] }) => {
        if (nome !== 'product_active_discounts') return { data: null, error: { message: 'rpc sconosciuta' } };
        if (mondo.rpcRotta) throw new Error('rete giù');
        return {
          data: (argomenti.p_products ?? []).map((id) => ({ product_id: id, discount_percent: mondo.sconti[id] ?? 0 })),
          error: null,
        };
      },
    },
  };
});
vi.mock('@/components/ProductCard', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: (p: { id: string; name: string; price: number; discountPercent?: number }) => {
      mondo.schede.push({ id: p.id, price: p.price, discountPercent: p.discountPercent });
      return ce('div', { 'data-scheda': p.id }, p.name);
    },
  };
});
vi.mock('@/components/ProductGrid', () => ({ default: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mondo.righe = [
    { id: 'torta', name: 'Torta di riso', description: null, price: '12.00', images: [], stock: 5, has_variants: false, created_at: '2026-10-01T00:00:00Z' },
    { id: 'biscotti', name: 'Biscotti', description: null, price: 6, images: [], stock: 5, has_variants: false, created_at: '2026-10-01T00:00:00Z' },
  ];
  mondo.sconti = { torta: 25 };
  mondo.rpcRotta = false;
  mondo.schede = [];
});
afterEach(() => { document.body.innerHTML = ''; });

async function disegna() {
  const { default: CollectionSection } = await import('@/components/store-sections/CollectionSection');
  const ctx = { storeId: 's1', accent: '#C0492C', store: { store_name: 'Pane Quotidiano' } } as never;
  const config = { heading: 'Le torte della domenica', layout: 'grid', source: { kind: 'manual', productIds: ['torta', 'biscotti'] } } as never;
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { radice.render(createElement(QueryClientProvider, { client }, createElement(CollectionSection, { ctx, config }))); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => radice.unmount());
}

const ultima = (id: string) => [...mondo.schede].reverse().find((s) => s.id === id);

describe('R02-013 — la collezione scelta a mano mostra lo sconto della promozione', () => {
  it('la torta in promo al 25% arriva alla scheda con lo sconto, i biscotti senza', async () => {
    await disegna();
    expect(ultima('torta')).toEqual({ id: 'torta', price: 12, discountPercent: 25 });
    expect(ultima('biscotti')).toEqual({ id: 'biscotti', price: 6, discountPercent: 0 });
  });

  it('se lo sconto non si legge la collezione si vede lo stesso, a prezzo pieno', async () => {
    mondo.rpcRotta = true;
    await disegna();
    expect(ultima('torta')).toMatchObject({ id: 'torta', price: 12 });
    expect(ultima('torta')?.discountPercent ?? 0).toBe(0);
  });
});
