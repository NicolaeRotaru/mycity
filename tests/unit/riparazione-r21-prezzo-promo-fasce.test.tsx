// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Con una promozione attiva i caroselli («Potrebbe piacerti», «Visti di recente», «Sponsorizzati»)
 * e la tendina della ricerca scrivevano il prezzo pieno, mentre la scheda e la cassa fanno pagare
 * quello scontato. Qui si guarda il prezzo scritto davvero, con 0,29 € al -50% (la cassa: 0,14 €).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stato = vi.hoisted(() => ({ sconti: new Map<string, number>(), rotti: false }));

vi.mock('@/lib/supabase/client', () => ({
  supabase: { from: () => ({}), rpc: () => Promise.resolve({ data: null, error: null }) },
}));
vi.mock('@/lib/promotions', async () => {
  const vero = await vi.importActual<typeof import('@/lib/promotions')>('@/lib/promotions');
  return {
    ...vero,
    fetchActiveDiscounts: () => (stato.rotti ? Promise.reject(new Error('giu')) : Promise.resolve(stato.sconti)),
  };
});
vi.mock('@/components/hooks/useUtente', () => ({ useUtente: () => ({ userId: 'u1', utente: { id: 'u1' }, caricamento: false }) }));
vi.mock('@/lib/consent', () => ({ readConsent: () => null, hasConsent: () => true }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/ui/FotoConRipiego', () => ({ default: () => null }));

const prodotto = (id: string) => ({ id, name: `P${id}`, price: 0.29, images: null, profiles: { store_name: 'N' } });
vi.mock('@/lib/queries/fasce-prodotti', () => ({
  leggiSimili: () => Promise.resolve([{ ...prodotto('a'), category_id: null, seller_id: 's' }]),
  leggiVistiDiRecente: () => Promise.resolve([
    { viewed_at: 'x', product: prodotto('a') },
    { viewed_at: 'x', product: prodotto('b') },
  ]),
  leggiSponsorizzati: () => Promise.resolve([{ id: 'sp', product_id: 'a', product: prodotto('a') }]),
}));
vi.mock('@/lib/queries/suggerimenti-ricerca', () => ({
  leggiSuggerimentiRicerca: () => Promise.resolve([{ kind: 'product', id: 'a', name: 'Pa', price: 0.29, image: null, store: 'N' }]),
}));

let chiudi: (() => void) | null = null;
afterEach(() => {
  chiudi?.();
  chiudi = null;
  stato.sconti = new Map();
  stato.rotti = false;
});

async function monta(modulo: string, props: Record<string, unknown>, scrivi?: string) {
  const { default: Componente } = await import(/* @vite-ignore */ modulo);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(QueryClientProvider, { client }, createElement(Componente, props)));
  });
  if (scrivi) {
    const campo = host.querySelector('input') as HTMLInputElement;
    await act(async () => {
      campo.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(campo, scrivi);
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
  }
  chiudi = () => {
    act(() => root?.unmount());
    host.remove();
    client.clear();
  };
  return host.textContent ?? '';
}

const FASCE: Array<[string, string, Record<string, unknown>, string?]> = [
  ['Potrebbe piacerti', '@/components/SimilarProducts', { productId: 'x' }],
  ['Visti di recente', '@/components/RecentlyViewed', {}],
  ['Sponsorizzati', '@/components/SponsoredCarousel', { placement: 'home_top' }],
  ['suggerimenti della ricerca', '@/components/SearchBar', {}, 'pa'],
];

describe('R21-011: le fasce scrivono il prezzo che si paga', () => {
  for (const [nome, modulo, props, scrivi] of FASCE) {
    it(`${nome}: 0,29 € al -50% si scrive 0,14 €`, async () => {
      stato.sconti = new Map([['a', 50], ['b', 50]]);
      const testo = await monta(modulo, props, scrivi);
      expect(testo).toContain('0,14');
      expect(testo).not.toContain('0,29');
    });
    it(`${nome}: senza lettura degli sconti resta il prezzo pieno`, async () => {
      stato.rotti = true;
      const testo = await monta(modulo, props, scrivi);
      expect(testo).toContain('0,29');
    });
  }
});
