/**
 * @vitest-environment jsdom
 */
/**
 * R11-012 — `onCount` della griglia non sapeva dire «non so».
 *
 * La griglia chiama `onCount(n)` per la riga «N prodotti» che la pagina scrive fuori dalla griglia
 * (categoria, ricerca, collezioni, scheda «Prodotti» del negozio). Quando il conto non si sa — la
 * lettura è caduta, oppure la griglia è ferma al tetto delle pagine lette da sola senza il totale
 * del database (R04-010) — la griglia taceva: la pagina restava sul numero di prima, quello di una
 * ricerca o di un minuto diversi. Le pagine erano già pronte a togliere il numero con `null`
 * (R14-013), ma la griglia non lo passava mai.
 *
 * Qui la griglia vera, col react-query vero: prima un conto vero, poi una domanda nuova che si
 * ferma al tetto (o che cade) — l'ultima cosa detta a chi scrive il numero dev'essere «non so».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mondo = vi.hoisted(() => ({
  perRicerca: (_q: string | undefined, _f: [number, number]): unknown[] => [],
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: [], error: null }) },
}));
vi.mock('@/lib/queries/griglia-prodotti', () => ({
  leggiProdottiDellaGriglia: async (_c: unknown, d: { finestra: [number, number]; search?: string }) => mondo.perRicerca(d.search, d.finestra),
  contaProdottiDellaGriglia: async () => null,
}));
vi.mock('@/components/ProductCard', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ name }: { name: string }) => ce('span', { 'data-nome': name }, name) };
});
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

const riga = (i: number) => ({ id: `p${i}`, name: `Pane ${i}`, price: 3, compare_at_price: null, images: [], seller_id: 's1', stock: 5, category_id: null, profiles: { store_name: 'Forno', store_hours: null } });

/** Una pagina con `rimaste` righe dopo il filtro dei negozi, e `lette` righe date dal database. */
function paginaCon(rimaste: number, lette: number, da = 0) {
  const p = Array.from({ length: rimaste }, (_, i) => riga(da + i));
  Object.defineProperty(p, 'righeLette', { value: lette, enumerable: false });
  return p;
}

const montate: Root[] = [];
afterEach(() => {
  while (montate.length > 0) {
    const r = montate.pop()!;
    act(() => r.unmount());
  }
});

const aspetta = async (giri: number) => {
  for (let i = 0; i < giri; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
};

async function monta(onCount: (n: number | null) => void) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  montate.push(root);
  const disegna = async (search: string) => {
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(ProductGrid, { limit: 4, search, onCount } as never)));
    });
    await aspetta(60);
  };
  return { radice, disegna };
}

describe('R11-012 · la griglia dice «non so» a chi scrive il numero', () => {
  it('dopo un conto vero, una ricerca ferma al tetto senza totale: l’ultima parola è «non so», non il numero di prima', async () => {
    // «pane»: tre prodotti, l'elenco finisce lì. «olio»: pagine piene e tutte scartate, senza fine.
    mondo.perRicerca = (q, [da]) => (q === 'pane' ? paginaCon(3, 3, da) : paginaCon(0, 4));
    const onCount = vi.fn();
    const g = await monta(onCount);
    await g.disegna('pane');
    expect(onCount).toHaveBeenLastCalledWith(3);

    await g.disegna('olio');
    expect(g.radice.textContent, 'controprova: la griglia è ferma al tetto, «ce ne sono altre»').toContain('Ancora nessun prodotto da mostrare');
    expect(onCount, 'sopra «…ma ce ne sono altre» la pagina scriverebbe «0 prodotti»').not.toHaveBeenLastCalledWith(0);
    expect(onCount, 'la griglia tace e la pagina resta su «3 prodotti» di «pane»').toHaveBeenLastCalledWith(null);
  });

  it('dopo un conto vero, una lettura che cade: «non so», non il numero di prima', async () => {
    mondo.perRicerca = (q, [da]) => {
      if (q === 'pane') return paginaCon(3, 3, da);
      throw new Error('Failed to fetch');
    };
    const onCount = vi.fn();
    const g = await monta(onCount);
    await g.disegna('pane');
    expect(onCount).toHaveBeenLastCalledWith(3);

    await g.disegna('farina');
    expect(onCount, 'con la lettura caduta la pagina resta su «3 prodotti»').toHaveBeenLastCalledWith(null);
  });

  it('controprova: quando il conto si sa lo dice ancora, zero compreso', async () => {
    mondo.perRicerca = (q, [da]) => (q === 'pane' ? paginaCon(2, 2, da) : paginaCon(0, 1));
    const onCount = vi.fn();
    const g = await monta(onCount);
    await g.disegna('pane');
    expect(onCount).toHaveBeenLastCalledWith(2);
    await g.disegna('sale');
    expect(onCount, 'le pagine sono finite e non c’è niente: lo zero è vero').toHaveBeenLastCalledWith(0);
  });
});
