/**
 * @vitest-environment jsdom
 */
/**
 * R02-020 · R02-021 — Con una promozione attiva la scheda mostrava 29,67 € (prezzo e barra in fondo),
 * ma al carrello passava il prezzo pieno, 34,90 €. Il carrello rilegge prezzo e promo dal database e,
 * trovando un prezzo diverso da quello salvato, scriveva «Buona notizia: il prezzo è sceso» su un
 * prezzo che il cliente aveva già visto scontato; la cassa «il prezzo è cambiato».
 *
 * Qui la scheda VERA, la promo del negozio ATTIVA sull'orologio finto (la regola di
 * `product_active_discount`: fra `starts_at` e `ends_at`), e fuori dalla sua finestra il prezzo pieno
 * di prima. Lo sconto si calcola con `discountedUnitCents`, la funzione di carrello e cassa, non toccata.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { discountedUnitCents } from '@/lib/promotions';
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

const PIENO = 34.9;
const SCONTO = 15;
/** Il prezzo che carrello e cassa calcolano da soli (app/cart/page.tsx, app/checkout/page.tsx). */
const PREZZO_DI_CARRELLO_E_CASSA = discountedUnitCents(PIENO, SCONTO) / 100;

const scheda = {
  id: 'p-1', name: 'Felpa di cotone', description: null, price: PIENO, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 8, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Boutique Piacenza', is_approved: true, offers_express: null, store_hours: null },
};

// La promo del negozio: tutto il negozio al -15% dal 20 al 27 novembre 2026.
const PROMO = { status: 'active', starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-27T22:59:59Z', discount_percent: SCONTO };

let schermo: ReturnType<typeof accendi> | null = null;
beforeEach(() => {
  // Solo l'orologio è finto: i giri di setTimeout della prova restano veri.
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.barra = [];
  mondo.metodiRicordati = [];
  mondo.promozione = null;
  vi.useRealTimers();
});

async function apri(adesso: string) {
  vi.setSystemTime(new Date(adesso));
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda;
  mondo.promozione = PROMO;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

const righe = () => JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ id: string; price: number; quantity: number }>;
/** La condizione con cui il carrello scrive «il prezzo è sceso / è cambiato» (app/cart/page.tsx). */
const ilCarrelloDiceCheECambiato = (salvato: number, oggi: number) => Math.abs(oggi - salvato) >= 0.01;
const pulsante = (radice: HTMLElement, testo: RegExp) =>
  Array.from(radice.querySelectorAll('button')).find((b) => testo.test(b.textContent ?? ''))!;

describe('R02-020 · R02-021 · con la promo attiva carrello e barra ricevono il prezzo che la scheda mostra', () => {
  it('controprova: la promo è attiva e la scheda mostra il prezzo scontato col pieno barrato', async () => {
    const radice = await apri('2026-11-22T10:00:00Z');
    expect(PREZZO_DI_CARRELLO_E_CASSA).toBe(29.67);
    expect(radice.textContent).toContain(formatPrice(29.67));
    expect(radice.textContent).toContain(`Prezzo pieno ${formatPrice(PIENO)}`);
  });

  it('«Aggiungi al carrello»: la riga entra a 29,67 €, e il carrello non scrive «il prezzo è sceso»', async () => {
    const radice = await apri('2026-11-22T10:00:00Z');
    await act(async () => { clicca(radice.querySelector('#acquisto-principale')!); });
    const [riga] = righe();
    expect(riga.price, 'al carrello è andato il prezzo pieno mentre la scheda mostrava quello in promo').toBe(29.67);
    expect(ilCarrelloDiceCheECambiato(riga.price, PREZZO_DI_CARRELLO_E_CASSA)).toBe(false);
  });

  it('la barra in fondo mostra lo stesso prezzo e il suo «Aggiungi» mette in carrello lo stesso prezzo', async () => {
    await apri('2026-11-22T10:00:00Z');
    const barra = mondo.barra.at(-1)!;
    expect(barra.price).toBe(29.67);
    await act(async () => { (barra.onAdd as () => void)(); });
    expect(righe()[0].price).toBe(barra.price);
  });

  it('«Compra ora»: anche lì la riga nasce al prezzo in promo', async () => {
    const radice = await apri('2026-11-22T10:00:00Z');
    await act(async () => { clicca(pulsante(radice, /^Compra ora/)); });
    expect(righe()[0].price).toBe(29.67);
  });

  it('fuori dalla finestra della promo (prima e dopo) resta tutto a prezzo pieno, come prima', async () => {
    for (const adesso of ['2026-11-19T10:00:00Z', '2026-11-28T10:00:00Z']) {
      const radice = await apri(adesso);
      expect(radice.textContent).not.toContain(formatPrice(29.67));
      expect(mondo.barra.at(-1)!.price).toBe(PIENO);
      await act(async () => { clicca(radice.querySelector('#acquisto-principale')!); });
      expect(righe()[0].price, adesso).toBe(PIENO);
      schermo?.smonta();
      schermo = null;
      localStorage.clear();
      mondo.barra = [];
    }
  });
});
