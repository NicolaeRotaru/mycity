/**
 * @vitest-environment jsdom
 */
/**
 * R02-022 — Un capo con più di cento combinazioni di taglia e colore perdeva le ultime in silenzio.
 *
 * Il taglio silenzioso era doppio, tutto in lib/products/variants.ts: prima i tetti per asse (3 assi,
 * 30 valori: 35 colori per 3 taglie diventavano 90 combinazioni, e il conto diceva 90, sotto il tetto,
 * quindi nessun avviso), poi il tetto sul totale (100). Adesso i tetti per asse non ci sono più: fino a
 * 100 combinazioni ci sono TUTTE, e il cliente compra anche il colore numero 35. Sopra 100 il conto
 * (`contaCombinazioni`) lo dice per intero, e il modulo del negozio non applica gli assi (la modifica in
 * components/seller/ProductForm.tsx è di un'altra sessione).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { MAX_VARIANTS, buildCombinations, contaCombinazioni, reconcileVariants } from '@/lib/products/variants';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
  varianti: [] as Array<Record<string, unknown>>,
  barra: [] as Array<Record<string, unknown>>,
  metodiRicordati: [] as string[],
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

const nomi = (prefisso: string, n: number) => Array.from({ length: n }, (_, i) => `${prefisso}${i + 1}`);
const TAGLIE_3 = ['S', 'M', 'L'];
const COLORI_35 = nomi('Colore', 35);

describe('R02-022 · il conto dice tutte le combinazioni volute, e sopra il tetto il modulo lo sa', () => {
  it('35 colori per 3 taglie sono 105, sopra il tetto di 100: il conto non le riduce in silenzio a 90', () => {
    const tipi = [{ name: 'Taglia', values: TAGLIE_3 }, { name: 'Colore', values: COLORI_35 }];
    expect(contaCombinazioni(tipi), 'il conto taglia i colori a 30 e resta sotto il tetto: nessun avviso').toBe(105);
    expect(contaCombinazioni(tipi) > MAX_VARIANTS).toBe(true);
  });

  it('6 taglie per 17 colori sono 102: il conto è 102, e le combinazioni create restano al massimo 100', () => {
    const tipi = [{ name: 'Taglia', values: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] }, { name: 'Colore', values: nomi('Colore', 17) }];
    expect(contaCombinazioni(tipi)).toBe(102);
    expect(buildCombinations(tipi)).toHaveLength(MAX_VARIANTS);
  });

  it('sotto il tetto ci sono TUTTE: 35 colori per 2 taglie sono 70 varianti, colore 35 compreso', () => {
    const tipi = [{ name: 'Taglia', values: ['M', 'L'] }, { name: 'Colore', values: COLORI_35 }];
    expect(contaCombinazioni(tipi)).toBe(70);
    const combo = buildCombinations(tipi);
    expect(combo, 'i colori dal 31 al 35 spariscono dal negozio').toHaveLength(70);
    expect(combo).toContainEqual({ Taglia: 'L', Colore: 'Colore35' });
    const varianti = reconcileVariants(tipi, [{ id: 'v-l-35', options: { Taglia: 'L', Colore: 'Colore35' }, label: 'L · Colore35', stock: 6 }]);
    expect(varianti).toHaveLength(70);
    expect(varianti.find((v) => v.options.Colore === 'Colore35' && v.options.Taglia === 'L')).toMatchObject({ id: 'v-l-35', stock: 6 });
  });

  it('anche il quarto asse resta: 4 assi da 2 valori sono 16 combinazioni con tutte e 4 le opzioni', () => {
    const tipi = ['Taglia', 'Colore', 'Manica', 'Collo'].map((name) => ({ name, values: ['a', 'b'] }));
    expect(contaCombinazioni(tipi)).toBe(16);
    const combo = buildCombinations(tipi);
    expect(combo).toHaveLength(16);
    expect(Object.keys(combo[15])).toEqual(['Taglia', 'Colore', 'Manica', 'Collo']);
  });

  it('come prima: 10 per 10 sono 100 senza tagli, e doppioni e valori vuoti non contano', () => {
    expect(buildCombinations([{ name: 'Taglia', values: nomi('t', 10) }, { name: 'Colore', values: nomi('c', 10) }])).toHaveLength(100);
    expect(contaCombinazioni([{ name: 'Taglia', values: ['S', 's', ' S ', '', 'M'] }, { name: 'Colore', values: [] }])).toBe(2);
  });
});

const scheda = {
  id: 'p-1', name: 'Maglia di lana', description: null, price: 39, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 400, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: true, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Maglieria Piacenza', is_approved: true, offers_express: null, store_hours: null },
};

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.barra = [];
});

describe('R02-022 · sulla scheda il cliente trova e compra anche il colore numero 35', () => {
  it('le varianti create dal negozio per 35 colori × 2 taglie: L + Colore35 ha il suo pulsante e va nel carrello', async () => {
    (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    const tipi = [{ name: 'Taglia', values: ['M', 'L'] }, { name: 'Colore', values: COLORI_35 }];
    // Quello che il modulo del negozio salva: `reconcileVariants` sugli assi scelti.
    mondo.varianti = reconcileVariants(tipi, []).map((v) => ({ ...v, id: `${v.options.Taglia}-${v.options.Colore}`, stock: 3 }));
    mondo.prodotto = scheda;
    schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const radice = schermo.radice;
    const valore = (gruppo: string, v: string) =>
      Array.from(radice.querySelectorAll(`[role="group"][aria-labelledby="opt-${gruppo}"] button`)).find((b) => b.firstChild?.textContent === v);
    expect(valore('Colore', 'Colore35'), 'il colore 35 non ha un pulsante: il negozio l ha perso in silenzio').toBeTruthy();
    await act(async () => { clicca(valore('Taglia', 'L')!); });
    await act(async () => { clicca(valore('Colore', 'Colore35')!); });
    const pulsante = radice.querySelector('#acquisto-principale')!;
    expect(pulsante.textContent).toMatch(/Aggiungi al carrello/);
    await act(async () => { clicca(pulsante); });
    const righe = JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ variantId?: string }>;
    expect(righe.map((r) => r.variantId)).toEqual(['L-Colore35']);
  });
});
