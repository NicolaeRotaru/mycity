/**
 * @vitest-environment jsdom
 */
/**
 * R08-005 — Un pesto a 5,90 € «a confezione», 190 g: la scheda mostrava solo «5,90 €» senza il prezzo al
 * chilo (Codice del Consumo). Qui la scheda VERA con la quantità netta dichiarata dal negozio.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { formatPrice } from '@/lib/format';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  promozione: null as null | { status: string; starts_at: string; ends_at: string; discount_percent: number },
  barra: [] as Array<Record<string, unknown>>,
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
    if (k[0] === 'product-variants') return { data: [], isError: false, refetch: () => undefined };
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

const base = {
  id: 'p-1', name: 'Pesto genovese', description: null, price: 5.9, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 8, unit: 'confezione',
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: { name: 'Alimentari', slug: 'alimentari' },
  profiles: { id: 'neg-1', store_name: 'Bottega Piacenza', is_approved: true, offers_express: null, store_hours: null },
};
const dichiarazioni = { allergeni: 'Frutta a guscio', ingredienti: 'basilico, olio' };

let schermo = null as ReturnType<typeof accendi> | null;
const chiudi = () => { schermo?.smonta(); schermo = null; };
const norm = (t: string) => t.replace(/[\s\u00a0]+/g, ' ').trim();

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
afterEach(() => { schermo?.smonta(); schermo = null; localStorage.clear(); mondo.barra = []; vi.useRealTimers(); });

async function apri(extra: Record<string, unknown>, attributes: Record<string, unknown> | null) {
  vi.setSystemTime(new Date('2026-11-26T10:00:00Z'));
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = { ...base, ...extra, attributes };
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const riga = schermo.radice.querySelector('[data-testid="prezzo-unitario"]');
  return { radice: schermo.radice, riga: riga?.textContent?.replace(/[\s\u00a0]+/g, ' ').trim() ?? null };
}

describe('R08-005 la scheda di un alimento mostra il prezzo al chilo o al litro', () => {
  it('5,90 € per 190 g: sotto il prezzo c è «(31,05 €/kg)»', async () => {
    const { radice, riga } = await apri({}, { ...dichiarazioni, peso: '190 g' });
    expect(radice.textContent).toContain(formatPrice(5.9));
    expect(riga).toBe(norm(`(${formatPrice(31.05)}/kg)`));
  });
  it('ml e litri danno €/l, e i valori vecchi («1kg», «1,5 L») si leggono', async () => {
    expect((await apri({ price: 3 }, { ...dichiarazioni, peso: '1,5 L' })).riga).toBe(norm(`(${formatPrice(2)}/l)`));
    chiudi();
    expect((await apri({ price: 1.5, unit: 'pezzo' }, { ...dichiarazioni, peso: '500ml' })).riga).toBe(norm(`(${formatPrice(3)}/l)`));
    chiudi();
    expect((await apri({ price: 4, unit: null }, { ...dichiarazioni, peso: '1kg' })).riga).toBe(norm(`(${formatPrice(4)}/kg)`));
  });
  it('dato mancante o non valido: nessuna riga', async () => {
    for (const peso of [undefined, '', 'boh', '6 pezzi', '0 g']) {
      const { riga } = await apri({}, { ...dichiarazioni, ...(peso === undefined ? {} : { peso }) });
      expect(riga, String(peso)).toBeNull();
      chiudi();
    }
  });
  it('prezzo già al chilo (unità kg): niente doppia riga', async () => {
    expect((await apri({ unit: 'kg' }, { ...dichiarazioni, peso: '190 g' })).riga).toBeNull();
  });
  it('un prodotto che non è un alimento non mostra il prezzo al chilo', async () => {
    const { riga } = await apri({ name: 'Pentola', categories: { name: 'Casa', slug: 'casa' } }, { peso: '1,2 kg' });
    expect(riga).toBeNull();
  });
});
