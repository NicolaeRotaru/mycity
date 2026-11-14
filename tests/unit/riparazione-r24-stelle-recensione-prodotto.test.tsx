/**
 * @vitest-environment jsdom
 */
/**
 * R24-003 — Nella scheda prodotto le stelle della recensione partivano già a 5 (e tornavano a 5
 * dopo l'invio): chi scriveva solo il commento lasciava cinque stelle senza averle scelte. E chi
 * recensiva una seconda volta leggeva «Questo valore è già stato usato», senza capire che la sua
 * recensione c'era già. Qui la scheda VERA, col modulo della recensione.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
  barra: [] as Array<Record<string, unknown>>,
  avvisi: [] as string[],
  inviate: 0,
  recensione: null as null | { onSuccess?: () => void; onError?: (e: unknown) => void },
  // Acceso, `mutate` fa come il database vero: la prima scrittura entra, la seconda urta il vincolo.
  database: false,
  scritte: 0,
  // Quanti invii devono ancora fallire per la rete, prima di arrivare al database.
  guasti: 0,
}));
const { nulla } = vi.hoisted(() => ({ nulla: () => null }));

// React 18 in node_modules non ha `use`: la pagina lo usa solo per leggere `params`.
vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, back: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/product/p-1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: (m: string) => { mondo.avvisi.push(`ok:${m}`); },
    error: (m: string) => { mondo.avvisi.push(`err:${m}`); },
    info: () => undefined,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
  trackErrorShown: () => undefined,
}));
// Le domande della scheda: il prodotto, il resto vuoto (anche «può recensire?», quindi il modulo c'è).
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[] }) => {
    const k = o.queryKey;
    if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
    if (k[0] === 'product-active-discount') return { data: mondo.sconto, isError: false };
    return { data: undefined, isLoading: false, isError: false, refetch: () => undefined };
  },
  // L'unica mutazione della scheda è la recensione: si contano gli invii e si tengono le risposte.
  useMutation: (o: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
    mondo.recensione = o;
    type Esiti = { onSuccess?: () => void; onError?: (e: unknown) => void };
    const mutate = (_v?: unknown, chiamata?: Esiti) => {
      mondo.inviate += 1;
      if (!mondo.database) return;
      const guasto = mondo.guasti > 0;
      if (guasto) mondo.guasti -= 1;
      else mondo.scritte += 1;
      const doppione = mondo.scritte > 1;
      // Come react-query: prima le risposte della mutazione, poi quelle della singola chiamata.
      void Promise.resolve().then(() => {
        if (guasto) {
          const e = new Error('Failed to fetch');
          o.onError?.(e);
          chiamata?.onError?.(e);
        } else if (doppione) {
          const e = Object.assign(new Error('duplicate key value violates unique constraint "reviews_product_user_unique"'), { code: '23505' });
          o.onError?.(e);
          chiamata?.onError?.(e);
        } else {
          o.onSuccess?.();
          chiamata?.onSuccess?.();
        }
      });
    };
    return { mutate, mutateAsync: async () => undefined, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: () => undefined, setQueryData: () => undefined }),
}));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: true, profile: { id: 'cliente-1' }, isSeller: false, isAdmin: false }),
}));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => 'shop', useCanPurchase: () => true }));
vi.mock('@/components/hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: new Set(), lettoDavvero: true, toggle: { mutate: () => undefined } }),
}));
vi.mock('@/components/hooks/useExternalProduct', () => ({ useExternalProduct: () => ({}) }));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));
vi.mock('@/components/checkout/PaymentMethodSelector', () => ({ ricordaMetodoScelto: () => undefined }));
// La barra in fondo è di un'altra voce: qui si guarda solo il prezzo che la scheda le passa.
vi.mock('@/components/StickyAddToCart', () => ({
  default: (p: Record<string, unknown>) => { mondo.barra.push(p); return null; },
}));
vi.mock('@/components/ContactSellerButton', () => ({ default: nulla }));
vi.mock('@/components/ProductViewTracker', () => ({ default: nulla }));
vi.mock('@/components/ProductQA', () => ({ default: nulla }));
vi.mock('@/components/RecentlyViewed', () => ({ default: nulla }));
vi.mock('@/components/QuandoSiVede', () => ({ default: nulla }));
vi.mock('@/components/SimilarProducts', () => ({ default: nulla }));
vi.mock('@/components/ActivePromoBadge', () => ({ default: nulla }));
vi.mock('@/components/AddToListButton', () => ({ default: nulla }));
vi.mock('@/components/PhotoReviewUpload', () => ({ default: nulla }));
vi.mock('@/components/products/SellerCard', () => ({ SellerCard: nulla }));
vi.mock('@/components/products/VendutoDa', () => ({ VendutoDa: nulla }));
vi.mock('@/components/Segnala', () => ({ Segnala: nulla }));
vi.mock('@/components/products/AllergensAccordion', () => ({ AllergensAccordion: nulla }));
vi.mock('@/components/products/FrequentlyBoughtTogether', () => ({ FrequentlyBoughtTogether: nulla }));
vi.mock('@/components/ui/DeliveryCutoff', () => ({ DeliveryCutoff: nulla }));
vi.mock('@/components/ui/SocialProof', () => ({ SocialProof: nulla }));

import ProductPage from '@/app/product/[id]/page';

const SCHEDA = {
  id: 'p-1', name: 'Focaccia', description: null, price: 4, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 20, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Forno Bianchi', is_approved: true, offers_express: null, store_hours: null },
};

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  mondo.avvisi = [];
  mondo.inviate = 0;
  mondo.recensione = null;
  mondo.database = false;
  mondo.scritte = 0;
  mondo.guasti = 0;
});

async function apri() {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = SCHEDA;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const gruppo = schermo.radice.querySelector('[role="group"][aria-label="Il tuo voto"]')!;
  const modulo = gruppo.closest('form')!;
  return {
    radice: schermo.radice,
    gruppo,
    modulo,
    pubblica: () => Array.from(modulo.querySelectorAll('button')).find((b) => /Pubblica recensione/.test(b.textContent ?? '')) as HTMLButtonElement,
    stella: (n: number) => gruppo.querySelector(`button[aria-label="${n} ${n === 1 ? 'stella' : 'stelle'}"]`) as HTMLButtonElement,
  };
}
const invia = async (modulo: HTMLFormElement) => {
  await act(async () => { modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
};

describe('R24-003 · la recensione del prodotto parte senza stelle', () => {
  it('nessuna stella scelta all apertura, «Pubblica» spento, e senza voto non parte niente', async () => {
    const m = await apri();
    expect(m.gruppo.querySelectorAll('button[aria-pressed="true"]').length, 'il modulo parte con un voto già scelto').toBe(0);
    expect(m.pubblica().disabled).toBe(true);
    expect(m.modulo.textContent).toContain('Tocca le stelle per votare');
    await invia(m.modulo);
    expect(mondo.inviate, 'una recensione è partita senza che si scegliesse un voto').toBe(0);
  });

  it('scelte 3 stelle si pubblica; dopo l invio le stelle tornano vuote, non a 5', async () => {
    const m = await apri();
    await act(async () => { clicca(m.stella(3)); });
    expect(m.gruppo.querySelectorAll('button[aria-pressed="true"]').length).toBe(3);
    expect(m.pubblica().disabled).toBe(false);
    await invia(m.modulo);
    expect(mondo.inviate).toBe(1);
    await act(async () => { mondo.recensione?.onSuccess?.(); });
    expect(m.gruppo.querySelectorAll('button[aria-pressed="true"]').length, 'dopo l invio il voto torna a 5').toBe(0);
  });

  it('una seconda recensione rifiutata dal database dice che c era già', async () => {
    const m = await apri();
    await act(async () => { clicca(m.stella(2)); });
    await invia(m.modulo);
    // Come lo restituisce supabase-js: un PostgrestError, cioè un Error col codice di Postgres.
    const doppione = Object.assign(new Error('duplicate key value violates unique constraint "reviews_product_user_unique"'), { code: '23505' });
    await act(async () => { mondo.recensione?.onError?.(doppione); });
    const detto = mondo.avvisi.join(' ');
    expect(detto, 'il cliente legge un errore che non spiega niente').toContain('Hai già recensito questo prodotto');
    expect(detto).not.toContain('già stato usato');
  });
});

describe('R24-003 · due invii nello stesso istante fanno una recensione sola', () => {
  const pausa = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

  it('IL CASO CHE ROMPEVA — doppio invio: una scrittura, «Grazie» e nessun «già recensito»', async () => {
    mondo.database = true;
    const m = await apri();
    await act(async () => { clicca(m.stella(4)); });
    await act(async () => {
      m.modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      m.modulo.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });
    for (let i = 0; i < 3; i++) await pausa();
    expect(mondo.scritte, 'il secondo invio ha mandato una seconda recensione').toBe(1);
    const detto = mondo.avvisi.join(' ');
    expect(detto, 'alla prima recensione il cliente legge «Hai già recensito»').not.toContain('già recensito');
    expect(detto).toContain('Grazie per la recensione');
  });

  it('dopo l’invio riuscito un altro invio non scrive, e dice che la recensione c’è già', async () => {
    mondo.database = true;
    const m = await apri();
    await act(async () => { clicca(m.stella(4)); });
    await invia(m.modulo);
    for (let i = 0; i < 3; i++) await pausa();
    await act(async () => { clicca(m.stella(2)); });
    await invia(m.modulo);
    for (let i = 0; i < 3; i++) await pausa();
    expect(mondo.scritte).toBe(1);
    expect(mondo.avvisi.join(' ')).toContain('Hai già recensito questo prodotto');
  });

  it('se l’invio non riesce si può riprovare', async () => {
    mondo.database = true;
    mondo.guasti = 1;
    const m = await apri();
    await act(async () => { clicca(m.stella(4)); });
    await invia(m.modulo);
    for (let i = 0; i < 3; i++) await pausa();
    expect(mondo.avvisi.some((a) => a.startsWith('err:')), 'il primo invio doveva fallire').toBe(true);
    await invia(m.modulo);
    for (let i = 0; i < 3; i++) await pausa();
    expect(mondo.scritte, 'dopo un errore il freno resta chiuso e il cliente non può riprovare').toBe(1);
    expect(mondo.avvisi.join(' ')).toContain('Grazie per la recensione');
  });
});
