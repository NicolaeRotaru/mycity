/**
 * @vitest-environment jsdom
 */
/**
 * R16-012 · R16-013 — Con una promozione del negozio la vetrina scriveva un prezzo e la cassa ne faceva
 * pagare un altro, di un centesimo per pezzo.
 *
 * La cassa (lib/ordini/valida-carrello.ts, per tutte e due le rotte che creano l'ordine) fa pagare
 * `discountedUnitCents(prezzo pieno, sconto)` per pezzo: 1,15 € al -10% sono 1,03 €. Qui si guarda che
 * dicano lo stesso numero:
 * - il bollino della promo sulla scheda (`ActivePromoBadge`), che faceva il conto a mano senza
 *   arrotondare e scriveva 1,04 €;
 * - il carrello, che con una riga salvata a 1,035 € (lo scontato non arrotondato della vetrina di
 *   prima) teneva il suo prezzo perché la differenza era sotto il centesimo: due pezzi facevano
 *   2,07 € a video e 2,06 € in cassa.
 */
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { discountedUnitCents } from '@/lib/promotions';
import { formatPrice } from '@/lib/format';
import { accendi } from './aiuti/schermo';

const PIENO = 1.15;
const SCONTO = 10;
/** Quello che la cassa fa pagare per pezzo: la funzione delle rotte che creano l'ordine. */
const IN_CASSA = discountedUnitCents(PIENO, SCONTO) / 100;

const banco = vi.hoisted(() => ({
  prodotti: [] as Array<{ id: string; stock: number | null; price: number | null }>,
  sconti: new Map<string, number>(),
}));

vi.mock('next/link', () => ({ default: (p: { children?: unknown }) => p.children ?? null }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/components/cart/CartUpsell', () => ({ CartUpsell: () => null }));
vi.mock('@/components/ShareCartButton', () => ({ default: () => null }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/promotions', async (originale) => ({
  ...(await originale<typeof import('@/lib/promotions')>()),
  fetchActiveDiscounts: async () => new Map(banco.sconti),
}));
vi.mock('@/lib/queries/seller-public-profiles', () => ({ fetchSellerPublicMap: async () => new Map() }));
vi.mock('@/lib/supabase/client', () => {
  const lettura = (righe: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'in', 'eq', 'order', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: righe, error: null }).then(ok, ko);
    return q;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) },
      from: (t: string) => lettura(t === 'products' ? banco.prodotti : []),
      // Il bollino legge lo sconto attivo del prodotto da qui.
      rpc: async () => ({ data: banco.sconti.get('p-1') ?? 0, error: null }),
    },
  };
});

// L'import pigro del database, dentro il carrello, sfugge al vi.mock qui sopra: nasce il client vero,
// su un indirizzo finto. La lettura dei prodotti risponde col prezzo pieno del banco; tutte le altre
// cadono (la pagina si disegna lo stesso, come quando la rete cade davvero).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://supabase.finto.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'chiave-finta';
const reteDiPartenza = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  const url = String(typeof input === 'object' && input !== null && 'url' in input ? (input as { url: unknown }).url : input);
  if (url.includes('/rest/v1/products')) {
    const corpo = JSON.stringify(banco.prodotti);
    return {
      ok: true, status: 200, statusText: 'OK', headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => corpo, json: async () => JSON.parse(corpo),
    };
  }
  return { ok: false, status: 503, statusText: 'finto', headers: new Headers(), text: async () => '', json: async () => null };
}) as unknown as typeof fetch;

import ActivePromoBadge from '@/components/ActivePromoBadge';
import CartPage from '@/app/cart/page';

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  banco.prodotti = [];
  banco.sconti = new Map();
});

async function assesta() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe('R16-012 · il bollino della promo dice il prezzo della cassa', () => {
  it('1,15 € al -10%: la cassa fa pagare 1,03 € e il bollino scrive 1,03 €, non 1,04 €', async () => {
    expect(formatPrice(IN_CASSA), 'la prova non misura niente se la cassa non arriva a 1,03 €').toBe(formatPrice(1.03));
    banco.sconti = new Map([['p-1', SCONTO]]);
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(ActivePromoBadge, { productId: 'p-1', basePrice: PIENO })));
    });
    await vi.waitFor(() => { if (!box.textContent?.includes('In promo')) throw new Error('bollino non ancora a schermo'); }, { timeout: 2000 });
    const testo = box.textContent ?? '';
    expect(testo).toContain(`In promo -${SCONTO}%`);
    expect(testo, 'lo scontato del bollino è quello che la cassa fa pagare').toContain(formatPrice(IN_CASSA));
    expect(testo).not.toContain(formatPrice(1.04));
    // Il risparmio è la differenza vera fra pieno e pagato: 0,12 €.
    expect(testo).toContain(`Risparmi ${formatPrice(0.12)}`);
    act(() => root.unmount());
    box.remove();
  });
});

describe('R16-012 · il carrello conta il prezzo della cassa anche sotto il centesimo', () => {
  it('una riga salvata a 1,035 € (due pezzi) fa 2,06 € di subtotale, come la cassa, non 2,07 €', async () => {
    banco.prodotti = [{ id: 'p-1', stock: 50, price: PIENO }];
    banco.sconti = new Map([['p-1', SCONTO]]);
    // Lo scontato come lo salvava la vetrina di prima, senza arrotondare.
    const salvato = PIENO * (1 - SCONTO / 100);
    localStorage.setItem('cart', JSON.stringify([
      { id: 'p-1', name: 'Michetta', price: salvato, quantity: 2, sellerId: 'neg-pane', storeName: 'Pane Quotidiano' },
    ]));
    schermo = accendi(CartPage);
    await assesta();
    const s = schermo;
    const subtotale = () => {
      const etichetta = [...s.radice.querySelectorAll('span')].find((el) => el.textContent?.trim() === 'Subtotale');
      return etichetta?.nextElementSibling?.textContent?.trim();
    };
    // Si lascia arrivare la lettura dei prezzi di oggi: se il subtotale non cambia, la prova lo dice sotto.
    await vi.waitFor(() => { if (subtotale() !== formatPrice(2.06)) throw new Error('prezzi di oggi non ancora arrivati'); }, { timeout: 2000 })
      .catch(() => undefined);
    expect(Math.round(IN_CASSA * 100) * 2, 'in cassa due pezzi fanno 206 centesimi').toBe(206);
    expect(subtotale(), 'il subtotale del carrello è quello che la cassa fa pagare').toBe(formatPrice(2.06));
  });
});

afterAll(() => {
  globalThis.fetch = reteDiPartenza;
});
