/**
 * @vitest-environment jsdom
 */
/**
 * R24-013 — Con una promozione attiva la scheda prodotto mostrava il prezzo scontato, ma al
 * carrello passava quello pieno: carrello e cassa, che rileggono il prezzo di oggi, avvisavano
 * «Il prezzo è cambiato da quando avevi messo nel carrello (10,00 € → 8,50 €)» a chi non aveva
 * visto cambiare niente. E la scheda della vetrina scontava senza arrotondare al centesimo come
 * la cassa: 0,62 € col 25% faceva leggere 0,46 € mentre la cassa ne chiede 0,47.
 *
 * Qui si montano la scheda prodotto e la scheda della vetrina VERE, si preme il loro pulsante
 * d'acquisto e si guarda cosa entra nel carrello. Quanto si paga non cambia: lo decide la cassa.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { discountedUnitCents } from '@/lib/promotions';
import { formatPrice } from '@/lib/format';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
  barra: [] as Array<Record<string, unknown>>,
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
  toast: Object.assign(() => undefined, { success: () => undefined, error: () => undefined, info: () => undefined }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
}));
// Le domande della scheda: il prodotto e lo sconto della promo, il resto vuoto.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[] }) => {
    const k = o.queryKey;
    if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
    if (k[0] === 'product-active-discount') return { data: mondo.sconto, isError: false };
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
import ProductCard from '@/components/ProductCard';

const scheda = (price: number) => ({
  id: 'p-1', name: 'Focaccia', description: null, price, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 20, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Forno Bianchi', is_approved: true, offers_express: null, store_hours: null },
});

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.barra = [];
  mondo.prodotto = null;
  mondo.sconto = 0;
});

const carrello = () => JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ id: string; price: number; quantity: number }>;

async function apriScheda(prezzo: number, sconto: number) {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  // jsdom non fa scorrere niente: la galleria delle foto chiama scrollTo al montaggio.
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda(prezzo);
  mondo.sconto = sconto;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

describe('R24-013 · la scheda prodotto mette nel carrello il prezzo che mostra', () => {
  it('con la promo al 15% su 10 €, «Aggiungi al carrello» mette 8,50 €, non 10 €', async () => {
    const radice = await apriScheda(10, 15);
    const pulsante = radice.querySelector('#acquisto-principale');
    expect(pulsante, 'controprova: la scheda si deve disegnare col suo pulsante').not.toBeNull();
    await act(async () => { clicca(pulsante!); });
    const righe = carrello();
    expect(righe).toHaveLength(1);
    expect(righe[0].price, 'al carrello è arrivato il prezzo pieno: cassa e carrello diranno «il prezzo è cambiato»').toBe(8.5);
    // La barra in fondo riceve lo stesso prezzo.
    expect(mondo.barra.at(-1)?.price).toBe(8.5);
  });

  it('i centesimi sono quelli della cassa (0,62 € col 25% → 0,47 €)', async () => {
    const radice = await apriScheda(0.62, 25);
    await act(async () => { clicca(radice.querySelector('#acquisto-principale')!); });
    expect(carrello()[0].price).toBe(discountedUnitCents(0.62, 25) / 100);
  });

  it('senza promo entra il prezzo pieno', async () => {
    const radice = await apriScheda(4.2, 0);
    await act(async () => { clicca(radice.querySelector('#acquisto-principale')!); });
    expect(carrello()[0].price).toBe(4.2);
  });
});

describe('R24-013 · la scheda della vetrina sconta al centesimo come la cassa', () => {
  it('0,62 € col 25%: si legge e si mette nel carrello 0,47 €, il numero della cassa', async () => {
    const atteso = discountedUnitCents(0.62, 25) / 100;
    expect(atteso).toBe(0.47);
    schermo = accendi(ProductCard, { id: 'p-2', name: 'Grissini', price: 0.62, images: [], stock: 9, sellerId: 'neg-1', storeName: 'Forno', discountPercent: 25 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const testo = schermo.radice.textContent ?? '';
    expect(testo, 'la vetrina mostra un centesimo diverso dalla cassa').toContain(formatPrice(atteso));
    expect(testo).not.toContain(formatPrice(0.46));
    const piu = Array.from(schermo.radice.querySelectorAll('button')).find((b) => /al carrello/i.test(b.getAttribute('aria-label') ?? ''));
    expect(piu, 'controprova: il «+» della scheda c è').toBeTruthy();
    await act(async () => { clicca(piu!); });
    expect(carrello()[0].price).toBe(atteso);
  });
});

