/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * R02-010 — Il riquadro del negozio in evidenza nella home (components/home/HeroStoreCard.tsx)
 * stampava il prezzo pieno dei prodotti anche con una promozione attiva, mentre la griglia, la
 * scheda e la cassa applicano lo sconto. Un pane da 10,00 € con la promo del 20% si paga 8,00 €:
 * la vetrina deve dire 8,00 €, con 10,00 € barrato.
 */
const mondo = vi.hoisted(() => ({
  chiamate: [] as string[],
  sconto: 20,
  NEGOZIO: {
    id: 'pane-quotidiano', store_name: 'Pane Quotidiano', store_address: 'Via Roma 1, Piacenza',
    store_logo: null, store_media: [], store_hours: null,
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/' }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async (nome: string, argomenti: { p_products?: string[] }) => {
      mondo.chiamate.push(nome);
      if (nome === 'vetrina_home') {
        return {
          data: {
            store: mondo.NEGOZIO,
            products: [
              { id: 'pane', name: 'Pane di Altamura', price: 10, images: null },
              { id: 'focaccia', name: 'Focaccia', price: '4.50', images: null },
            ],
            reviews: null,
          },
          error: null,
        };
      }
      if (nome === 'product_active_discounts') {
        return {
          data: (argomenti.p_products ?? [])
            .filter((id) => id === 'pane')
            .map((id) => ({ product_id: id, discount_percent: mondo.sconto })),
          error: null,
        };
      }
      return { data: null, error: { message: `rpc sconosciuta ${nome}` } };
    },
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mondo.chiamate = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T08:30:00Z'));
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  }));
  vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: async () => ({ possibile: false }) }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

async function disegna(): Promise<HTMLElement> {
  const { default: HeroStoreCard } = await import('@/components/home/HeroStoreCard');
  const nodo = document.createElement('div');
  document.body.appendChild(nodo);
  const radice = createRoot(nodo);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { radice.render(createElement(QueryClientProvider, { client }, createElement(HeroStoreCard))); });
  for (let i = 0; i < 6; i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
  return nodo;
}

const spazi = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

describe('R02-010 — la vetrina della home mostra il prezzo che si paga', () => {
  it('il pane in promo al 20% si legge 8,00 €, con 10,00 € barrato come prezzo pieno', async () => {
    const nodo = await disegna();
    expect(spazi(nodo.textContent)).toContain('Pane di Altamura');
    const prezzi = Array.from(nodo.querySelectorAll('p')).filter((p) => /€/.test(p.textContent ?? ''));
    const pane = prezzi[0];
    // Il prezzo grande è quello scontato…
    expect(spazi(pane.firstChild?.textContent)).toBe('8,00 €');
    // …e il pieno resta solo barrato.
    const barrato = pane.querySelector('s');
    expect(barrato, 'il prezzo pieno va barrato').not.toBeNull();
    expect(spazi(barrato?.textContent)).toBe('Prezzo pieno 10,00 €');
  });

  it('un prodotto senza promozione resta al suo prezzo, senza barrato', async () => {
    const nodo = await disegna();
    const prezzi = Array.from(nodo.querySelectorAll('p')).filter((p) => /€/.test(p.textContent ?? ''));
    const focaccia = prezzi[1];
    expect(spazi(focaccia.textContent)).toBe('4,50 €');
    expect(focaccia.querySelector('s')).toBeNull();
  });

  it('lo sconto si chiede alla stessa fonte della cassa, una volta per tutta la vetrina', async () => {
    await disegna();
    expect(mondo.chiamate.filter((n) => n === 'product_active_discounts')).toHaveLength(1);
  });
});
