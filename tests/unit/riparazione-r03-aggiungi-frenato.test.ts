/**
 * @vitest-environment jsdom
 */
/**
 * R03-001 — Sulla scheda prodotto il freno contro il doppio tocco scarta la seconda aggiunta entro un
 * secondo. Prima la scartava in silenzio: chi ripremeva non capiva se il pezzo era entrato. Ora il
 * freno resta (un pezzo solo), ma il tocco scartato dice «Già aggiunto: controlla il carrello».
 *
 * Qui la scheda VERA, con l'orologio finto: due clic a 300 ms, poi un terzo dopo il secondo.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  avvisi: [] as Array<{ tipo: string; testo: string }>,
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
vi.mock('sonner', () => {
  const segna = (tipo: string) => (testo: string) => { mondo.avvisi.push({ tipo, testo: String(testo) }); };
  return {
    toast: Object.assign(segna('toast'), {
      success: segna('success'),
      error: segna('error'),
      info: segna('info'),
      warning: segna('warning'),
      message: segna('message'),
    }),
  };
});
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
    if (k[0] === 'product-active-discount') return { data: 0, isError: false };
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
vi.mock('@/components/checkout/PaymentMethodSelector', () => ({ ricordaMetodoScelto: () => undefined }));
vi.mock('@/components/StickyAddToCart', () => ({ default: nulla }));
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
  id: 'p-1', name: 'Filone', description: null, price: 4, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 50, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Forno', is_approved: true, offers_express: null, store_hours: null },
};

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  vi.useRealTimers();
  localStorage.clear();
  mondo.avvisi = [];
});

async function apri() {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

const quantitaNelCarrello = () =>
  (JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ id: string; quantity: number }>)
    .filter((r) => r.id === 'p-1')
    .reduce((s, r) => s + r.quantity, 0);

describe('R03-001 · il secondo «aggiungi» entro un secondo non sparisce in silenzio', () => {
  it('due clic a 300 ms: un pezzo solo, e il secondo dice che è già nel carrello', async () => {
    // Solo l'orologio: i setTimeout restano veri per lasciar girare gli effetti della scheda.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    const radice = await apri();
    const pulsante = radice.querySelector('#acquisto-principale')!;
    expect(pulsante.textContent).toMatch(/Aggiungi al carrello/);

    await act(async () => { clicca(pulsante); });
    expect(quantitaNelCarrello()).toBe(1);
    expect(mondo.avvisi.filter((a) => a.tipo === 'success')).toHaveLength(1);
    const avvisiDopoIlPrimo = mondo.avvisi.length;

    vi.setSystemTime(new Date('2026-11-17T10:00:00.300Z'));
    await act(async () => { clicca(pulsante); });
    expect(quantitaNelCarrello(), 'il freno deve restare: un pezzo solo').toBe(1);
    const nuovi = mondo.avvisi.slice(avvisiDopoIlPrimo);
    expect(nuovi, 'il tocco frenato deve dare un riscontro, non sparire in silenzio').toHaveLength(1);
    expect(nuovi[0].tipo).not.toBe('success');
    expect(nuovi[0].tipo).not.toBe('error');
    expect(nuovi[0].testo).toMatch(/già aggiunto/i);
    expect(nuovi[0].testo).toMatch(/carrello/i);

    // Controprova: passato il secondo, un nuovo tocco aggiunge davvero, con l'avviso di sempre.
    vi.setSystemTime(new Date('2026-11-17T10:00:01.500Z'));
    await act(async () => { clicca(pulsante); });
    expect(quantitaNelCarrello()).toBe(2);
    expect(mondo.avvisi.at(-1)?.tipo).toBe('success');
  });
});
