/**
 * @vitest-environment jsdom
 */
/**
 * R18-007 — La scheda prodotto lasciata aperta oltre la fine della promozione continuava a mostrare il
 * prezzo scontato: lo sconto si leggeva una volta sola. Qui la scheda VERA con la domanda dello sconto
 * vera (React Query) sull'orologio finto: a promo finita la scheda deve tornare al prezzo pieno
 * senza ricaricare la pagina.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { formatPrice } from '@/lib/format';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  promozione: null as null | { status: string; starts_at: string; ends_at: string; discount_percent: number },
  barra: [] as Array<Record<string, unknown>>,
  varianti: [] as Array<Record<string, unknown>>,
  metodiRicordati: [] as string[],
}));
const { nulla, scontoAttivoAdesso } = vi.hoisted(() => ({
  nulla: () => null,
  scontoAttivoAdesso: () => {
    const p = mondo.promozione;
    if (!p || p.status !== 'active') return 0;
    const adesso = Date.now();
    return Date.parse(p.starts_at) <= adesso && Date.parse(p.ends_at) >= adesso ? p.discount_percent : 0;
  },
}));

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
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({
  supabase: { rpc: async () => ({ data: scontoAttivoAdesso(), error: null }) },
}));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...vero,
    // Solo la domanda dello sconto è quella vera (con il suo refetch): il resto è fermo.
    useQuery: (o: { queryKey: readonly unknown[] }) => {
      const k = o.queryKey;
      if (k[0] === 'product-active-discount') return vero.useQuery(o as never);
      if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
      if (k[0] === 'product-variants') return { data: mondo.varianti, isError: false, refetch: () => undefined };
      return { data: undefined, isLoading: false, isError: false, refetch: () => undefined };
    },
    useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false }),
    useQueryClient: () => ({ invalidateQueries: () => undefined, setQueryData: () => undefined }),
  };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ isAuthenticated: true, profile: { id: 'cliente-1' }, isSeller: false, isAdmin: false }),
}));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => 'shop', useCanPurchase: () => true }));
vi.mock('@/components/hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: new Set(), lettoDavvero: true, toggle: { mutate: () => undefined } }),
}));
vi.mock('@/components/hooks/useExternalProduct', () => ({ useExternalProduct: () => ({}) }));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));
vi.mock('@/components/checkout/PaymentMethodSelector', () => ({
  ricordaMetodoScelto: (m: string) => { mondo.metodiRicordati.push(m); },
}));
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
const scheda = {
  id: 'p-1', name: 'Felpa di cotone', description: null, price: 10, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 8, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Boutique Piacenza', is_approved: true, offers_express: null, store_hours: null },
};
const PROMO = { status: 'active', starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-27T22:00:00Z', discount_percent: 20 };

let root: Root | null = null;
let box: HTMLElement | null = null;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => root?.unmount()); root = null; box?.remove(); box = null;
  mondo.promozione = null; vi.useRealTimers();
});

describe('R18-007 · la promo scade con la scheda aperta', () => {
  it('aperta durante la promo mostra 8 €; dopo la fine, senza ricaricare, torna a 10 €', async () => {
    vi.setSystemTime(new Date('2026-11-27T21:50:00Z'));
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    mondo.prodotto = scheda;
    mondo.promozione = PROMO;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    box = document.createElement('div');
    document.body.appendChild(box);
    await act(async () => {
      root = createRoot(box!);
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(ProductPage, { params: { valore: { id: 'p-1' } } } as never)));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(box.textContent).toContain(`Prezzo pieno ${formatPrice(10)}`);
    expect(box.textContent).toContain(formatPrice(8));
    // Passa mezz'ora: la promo è finita alle 22:00. La scheda resta aperta.
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    expect(new Date().toISOString()).toBe('2026-11-27T22:20:00.100Z');
    expect(box.textContent, 'la scheda mostra ancora lo sconto a promo finita').not.toContain('Prezzo pieno');
    expect(box.textContent).not.toContain(formatPrice(8));
  });
});
