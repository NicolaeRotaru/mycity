// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
  varianti: [] as Array<Record<string, unknown>>,
  barra: [] as Array<Record<string, unknown>>,
  avvisi: [] as string[],
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
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ src, alt, onError }: { src: string; alt: string; onError?: (e: unknown) => void }) => ce('img', { src, alt, onError }) };
});
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});
vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    error: (m: string) => { mondo.avvisi.push(m); },
    info: () => undefined,
  }),
}));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
}));
// Le domande della scheda: il prodotto e le sue varianti, il resto vuoto.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (o: { queryKey: readonly unknown[] }) => {
    const k = o.queryKey;
    if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
    if (k[0] === 'product-active-discount') return { data: mondo.sconto, isError: false };
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

const scheda = {
  id: 'p-1', name: 'Pane', description: null, price: 3, images: ['https://example.com/cancellata.jpg', 'https://example.com/altra.jpg'],
  seller_id: 'neg-1', status: 'active', created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 4, attributes: null,
  unit: null, compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null, categories: null,
  profiles: { id: 'neg-1', store_name: 'Forno', is_approved: true, offers_express: null, store_hours: null },
};

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
});

async function apriLoZoom() {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const radice = schermo.radice;
  const ingrandisci = radice.querySelector('button[aria-label="Ingrandisci foto"]')!;
  await act(async () => { clicca(ingrandisci); });
  const zoom = () => radice.ownerDocument.querySelector('img.max-h-\\[90vh\\]') as HTMLImageElement | null;
  return zoom;
}

describe('R08-003 lo zoom a schermo intero con la foto cancellata (pagina vera)', () => {
  it('prima dell\'errore mostra la foto vera; dopo l\'evento error mostra il segnaposto, non l\'icona rotta', async () => {
    const zoom = await apriLoZoom();
    expect(zoom(), 'lo zoom non si è aperto').not.toBeNull();
    expect(zoom()!.getAttribute('src')).toContain('cancellata.jpg');
    await act(async () => { zoom()!.dispatchEvent(new window.Event('error')); });
    expect(zoom()!.getAttribute('src')).toBe('/foto-mancante.svg');
  });
  it('se la foto di ripiego stessa non risponde non si va in giro: resta il segnaposto', async () => {
    const zoom = await apriLoZoom();
    await act(async () => { zoom()!.dispatchEvent(new window.Event('error')); });
    await act(async () => { zoom()!.dispatchEvent(new window.Event('error')); });
    expect(zoom()!.getAttribute('src')).toBe('/foto-mancante.svg');
  });
});

const ROOT = process.cwd();
const leggi = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Le foto di prodotto che il sito mostra devono passare da FotoConRipiego (ripiego se la foto è cancellata),
// non da <Image> nuda.
describe('R08-003 foto di prodotto con ripiego', () => {
  for (const file of ['app/product/[id]/page.tsx', 'components/RecentlyViewed.tsx', 'components/cart/CartUpsell.tsx']) {
    it(`${file} non usa <Image> nuda`, () => {
      const src = leggi(file);
      expect(src).not.toMatch(/<Image[\s>]/);
      expect(src).toMatch(/<FotoConRipiego[\s>]/);
    });
  }
});

// Lo zoom a schermo intero è un <img> (foto grande, senza riquadro fisso): il ripiego sta nel suo onError.
describe('R08-003 lo zoom a schermo intero, nel sorgente', () => {
  it('l\'<img> dello zoom ha onError e il segnaposto', () => {
    const src = leggi('app/product/[id]/page.tsx');
    const i = src.indexOf('LARGHEZZA_MASSIMA)', src.indexOf('<img'));
    const blocco = src.slice(src.indexOf('<img'), src.indexOf('/>', i) + 2);
    expect(blocco).toMatch(/onError=/);
    expect(blocco).toMatch(/FOTO_MANCANTE/);
  });
});
