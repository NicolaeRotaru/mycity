/**
 * @vitest-environment jsdom
 */
/**
 * R07-016 (12/11/2026) — la pagina «Sotto i 10 €» chiedeva `price <= 10` sul prezzo pieno:
 * mostrava i prodotti da 10,00 € e nascondeva quelli che in promozione costano meno di 10.
 * Ora la griglia taglia sul prezzo che si paga (come la cassa), soglia esclusa, e chiede al
 * database anche i prodotti che solo con la promozione ci stanno sotto.
 * (Il contatore che passa le righe caricate e non il totale resta a un'altra voce.)
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
  domande: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (nome: string) => (mondo.rpc[nome] ?? (async () => ({ data: [], error: null })))(),
  },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async (_s: unknown, d: Record<string, unknown>) => {
    mondo.domande.push(d);
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

const prodotto = (id: string, price: number) => ({ ...FOCACCIA, id, name: id, price });

beforeEach(() => {
  mondo.rpc = {};
  mondo.grigliaInErrore = false;
  mondo.schede = [];
  mondo.domande = [];
  mondo.prodotti = [prodotto('dieci-tondi', 10), prodotto('nove-e-mezzo', 9.5), prodotto('dodici-in-promo', 12), prodotto('trenta', 30)];
  mondo.rpc.product_active_discounts = async () => ({ data: [{ product_id: 'dodici-in-promo', discount_percent: 25 }], error: null });
});

describe('R07-016 · «sotto i 10 €» guarda il prezzo che si paga, 10 escluso', () => {
  it('10,00 € fuori, 9,50 € dentro, 12 € con −25% (9 €) dentro, 30 € fuori', async () => {
    const conti: number[] = [];
    const g = await monta({ limit: 40, prezzoSotto: 10, sort: 'price_asc', maxColumns: 4, onCount: (n: number) => conti.push(n) });
    const ultime = new Set(mondo.schede.slice(-10).map((s) => s.id));
    const visti = Array.from(ultime);
    expect(visti).toContain('nove-e-mezzo');
    expect(visti).toContain('dodici-in-promo');
    expect(visti).not.toContain('dieci-tondi');
    expect(visti).not.toContain('trenta');
    expect(conti.at(-1)).toBe(2);
    g.smonta();
  });

  it('al database si chiedono anche i prezzi pieni che solo in promozione scendono sotto 10', async () => {
    const g = await monta({ limit: 40, prezzoSotto: 10, sort: 'price_asc', maxColumns: 4 });
    const tetto = Number(mondo.domande.at(-1)?.maxPrice);
    expect(tetto).toBeGreaterThan(30);
    g.smonta();
  });
});
