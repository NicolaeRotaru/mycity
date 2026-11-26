/**
 * @vitest-environment jsdom
 */
/**
 * R18-010 — Il prezzo al chilo usava il peso del prodotto base anche scegliendo un formato diverso:
 * un alimento da 500 g e da 1 kg, scegliendo 1 kg la riga «€/kg» restava calcolata sui 500 g.
 * Qui la scheda VERA con le varianti di peso.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
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
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[] }) => {
    const k = o.queryKey;
    if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
    // La promo la decide la funzione del database `product_active_discount` (migrazione 056): la
    // promozione del negozio vale se adesso sta fra `starts_at` e `ends_at`. Qui la stessa regola,
    // sull'orologio finto della prova.
    if (k[0] === 'product-active-discount') return { data: scontoAttivoAdesso(), isError: false };
    if (k[0] === 'product-variants') return { data: mondo.varianti, isError: false, refetch: () => undefined };
    return { data: undefined, isLoading: false, isError: false, refetch: () => undefined };
  },
  useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false }),
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
  id: 'p-1', name: 'Pasta artigianale', description: null, price: 10, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 8,
  attributes: { allergeni: ['glutine'], ingredienti: 'semola', peso: '500 g' }, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: true, tags: null,
  categories: { slug: 'alimentari' },
  profiles: { id: 'neg-1', store_name: 'Boutique Piacenza', is_approved: true, offers_express: null, store_hours: null },
};
const VARIANTI = [
  { id: 'v1', options: { peso: '500 g' }, label: '500 g', stock: 5 },
  { id: 'v2', options: { peso: '1 kg' }, label: '1 kg', stock: 5 },
];

let schermo: ReturnType<typeof accendi> | null = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { schermo?.smonta(); schermo = null; localStorage.clear(); mondo.barra = []; mondo.varianti = []; vi.useRealTimers(); });

async function apri(varianti: Array<Record<string, unknown>>, hasVariants = true) {
  vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = { ...scheda, has_variants: hasVariants };
  mondo.varianti = varianti;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}
const unitario = (r: HTMLElement) => r.querySelector('[data-testid="prezzo-unitario"]')?.textContent ?? null;
const scegli = async (r: HTMLElement, testo: string) => {
  const b = Array.from(r.querySelectorAll('button')).find((x) => x.textContent?.trim() === testo)!;
  await act(async () => { clicca(b); });
};

describe('R18-010 · il prezzo al chilo segue il formato scelto', () => {
  it('scegliendo 1 kg: 10 € al chilo; scegliendo 500 g: 20 € al chilo', async () => {
    const r = await apri(VARIANTI);
    await scegli(r, '1 kg');
    expect(unitario(r)).toContain(`${formatPrice(10)}/kg`);
    await scegli(r, '500 g');
    expect(unitario(r)).toContain(`${formatPrice(20)}/kg`);
  });

  it('senza varianti il prezzo al chilo resta quello del peso del prodotto', async () => {
    const r = await apri([], false);
    expect(unitario(r)).toContain(`${formatPrice(20)}/kg`);
  });
});
