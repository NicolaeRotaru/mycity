/**
 * @vitest-environment jsdom
 */
/**
 * R24-006 (giro di correzione) — Se la foto di un prodotto è stata cancellata dallo spazio delle
 * foto, la scheda e le miniature mostravano un riquadro bianco (o l'icona della foto rotta) invece
 * della foto di ripiego. Il primo giro l'aveva sistemato nelle schede della griglia, in cassa, in
 * «di tendenza» e nel carrello; il collaudo K06 l'ha trovato ancora nella foto grande della pagina
 * prodotto (app/product/[id]/page.tsx:708) e, accanto, nelle miniature sotto la foto (:772).
 *
 * Qui la pagina VERA: si lancia l'errore dell'immagine come lo lancia il browser e si legge la src.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

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
// La foto vera di next/image non serve: serve un <img> che porti l'errore del browser al
// componente, come fa next/image con onError.
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

const CANCELLATA = 'https://example.com/cancellata.jpg';
const BUONA = 'https://example.com/buona.jpg';

const scheda = {
  id: 'p-1', name: 'Maglia', description: null, price: 25, images: [CANCELLATA, BUONA], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 4, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Boutique', is_approved: true, offers_express: null, store_hours: null },
};

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.avvisi = [];
  mondo.barra = [];
});

async function apri() {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda;
  mondo.varianti = [];
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

// La foto grande porta il nome del prodotto come testo alternativo; le miniature sono mute
// (alt="") e stanno dentro i pulsanti «Mostra foto N».
const fotoGrandi = (radice: HTMLElement) => Array.from(radice.querySelectorAll('img')).filter((i) => !i.closest('button[aria-label^="Mostra foto"]') && /Maglia/.test(i.getAttribute('alt') ?? ''));
const miniature = (radice: HTMLElement) => Array.from(radice.querySelectorAll('button[aria-label^="Mostra foto"] img'));
const rompi = async (img: Element) => { await act(async () => { img.dispatchEvent(new Event('error')); }); };

describe('R24-006 · la pagina prodotto passa alla foto di ripiego quando la foto non risponde', () => {
  it('la foto grande cancellata diventa la foto di ripiego, la buona resta com è', async () => {
    const radice = await apri();
    const [prima, seconda] = fotoGrandi(radice);
    expect(prima?.getAttribute('src'), 'controprova: la foto grande parte dall indirizzo del negozio').toContain('example.com/cancellata');
    expect(seconda?.getAttribute('src')).toContain('example.com/buona');
    await rompi(prima!);
    const dopo = fotoGrandi(radice);
    expect(dopo[0]!.getAttribute('src'), 'la foto grande cancellata resta un riquadro vuoto').toBe('/foto-mancante.svg');
    expect(dopo[1]!.getAttribute('src'), 'una foto che risponde non va nascosta').toContain('example.com/buona');
  });

  it('la miniatura della foto cancellata diventa la foto di ripiego', async () => {
    const radice = await apri();
    const [prima, seconda] = miniature(radice);
    expect(prima?.getAttribute('src')).toContain('example.com/cancellata');
    await rompi(prima!);
    const dopo = miniature(radice);
    expect(dopo[0]!.getAttribute('src'), 'la miniatura cancellata resta l icona della foto rotta').toBe('/foto-mancante.svg');
    expect(dopo[1]!.getAttribute('src')).toContain('example.com/buona');
    expect(seconda).toBeTruthy();
  });
});
