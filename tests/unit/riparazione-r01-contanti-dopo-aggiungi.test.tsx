/**
 * @vitest-environment jsdom
 */
/**
 * R01-009 — La scheda prodotto prometteva «paghi alla consegna» accanto ad «Aggiungi al carrello»
 * anche quando quel pulsante portava il carrello sopra il tetto dei contanti.
 *
 * Il riquadro verde e «Compri sicuro: paghi solo quando arriva» stanno accanto ai due pulsanti:
 * «Compra ora» porta la riga di questo prodotto alla quantità scelta, «Aggiungi al carrello» la
 * SOMMA a quella che c'è. Con un pezzo da 2.600 € già nel carrello «Compra ora» resta a 2.600 €
 * (contanti sì), «Aggiungi» lo porta a 5.200 € (contanti no): la scheda prometteva i contanti lo
 * stesso, la persona premeva «Aggiungi» e la cassa poi li spegneva. Le promesse generiche valgono solo
 * se i contanti reggono su tutte e due le strade; il pulsante «Compra ora · paghi alla consegna» e il
 * ricordo di 'cod' restano della sua strada.
 *
 * Qui la scheda VERA con il carrello vero (localStorage, come lo legge `getCart`). Il tetto non si
 * tocca: si legge da lib/ordini/tetto-dei-contanti.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { TETTO_CONTANTI_CENTS } from '@/lib/ordini/tetto-dei-contanti';
import { formatPrice } from '@/lib/format';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
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

const scheda = (prezzo: number) => ({
  id: 'p-1', name: 'Bicicletta elettrica', description: null, price: prezzo, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 5, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Cicli Piacenza', is_approved: true, offers_express: null, store_hours: null },
});

type Riga = { id: string; name: string; price: number; quantity: number; sellerId?: string; storeName?: string };
const riga = (id: string, price: number, sellerId: string, quantity = 1): Riga => ({ id, name: id, price, quantity, sellerId, storeName: sellerId });

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.barra = [];
  mondo.metodiRicordati = [];
  mondo.sconto = 0;
});

async function apri(prezzo: number, carrello: Riga[] = []) {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  localStorage.setItem('cart', JSON.stringify(carrello));
  mondo.prodotto = scheda(prezzo);
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

function promesse(radice: HTMLElement) {
  const compraOra = Array.from(radice.querySelectorAll('button')).find((b) => /^(Compra ora|Apro la cassa)/.test(b.textContent ?? ''));
  return {
    testo: radice.textContent ?? '',
    compraOra: compraOra?.textContent ?? '',
    notaBarra: mondo.barra.at(-1)?.note as string | undefined,
    pulsante: compraOra!,
  };
}

const TETTO = formatPrice(TETTO_CONTANTI_CENTS / 100);
const lettiNelCarrello = () => (JSON.parse(localStorage.getItem('cart') ?? '[]') as Riga[]).reduce((t, r) => t + r.price * r.quantity, 0);
const aggiungi = (radice: HTMLElement) =>
  Array.from(radice.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('Aggiungi al carrello'))!;

describe('R01-009 · le promesse accanto ai due pulsanti valgono solo se i contanti reggono su tutte e due le strade', () => {
  it('un pezzo da 2.600 € già nel carrello: «Aggiungi» porta a 5.200 €, quindi niente riquadro verde e niente «Compri sicuro»; «Compra ora» li promette ancora', async () => {
    const radice = await apri(2600, [riga('p-1', 2600, 'neg-1')]);
    const p = promesse(radice);
    expect(p.testo, 'il riquadro verde promette i contanti accanto ad «Aggiungi», che porta il carrello a 5.200 €').not.toContain('Paghi in contanti alla consegna');
    expect(p.testo).toContain(`Sopra ${TETTO} non si`);
    expect(p.testo, '«Compri sicuro» promette i contanti accanto ad «Aggiungi»').not.toContain('paghi solo quando arriva');
    // La strada di «Compra ora» è una sola: la riga torna a un pezzo, 2.600 €, e i contanti reggono.
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra).toBeUndefined();
  });

  it('premo «Aggiungi al carrello»: il carrello va a 5.200 € e la scheda continua a NON promettere i contanti', async () => {
    const radice = await apri(2600, [riga('p-1', 2600, 'neg-1')]);
    await act(async () => { clicca(aggiungi(radice)); });
    for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(lettiNelCarrello(), '«Aggiungi» somma alla riga che c\'è').toBe(5200);
    const p = promesse(radice);
    expect(p.testo).not.toContain('Paghi in contanti alla consegna');
    expect(p.testo).not.toContain('paghi solo quando arriva');
    expect(p.notaBarra).toBeUndefined();
  });

  it('«Compra ora» con lo stesso pezzo già nel carrello ricorda ancora i contanti: la riga torna a 2.600 €', async () => {
    const radice = await apri(2600, [riga('p-1', 2600, 'neg-1')]);
    await act(async () => { clicca(promesse(radice).pulsante); });
    expect(lettiNelCarrello(), '«Compra ora» porta la riga alla quantità scelta, non la somma').toBe(2600);
    expect(mondo.metodiRicordati).toEqual(['cod']);
  });

  it('controprova: un pezzo da 1.000 € già nel carrello, anche aggiungendo si resta sotto il tetto: riquadro verde e «Compri sicuro» ci sono', async () => {
    const p = promesse(await apri(1000, [riga('p-1', 1000, 'neg-1')]));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.testo).toContain('Compri sicuro: paghi solo quando arriva.');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra).toBe('Paghi alla consegna');
  });

  it('carrello vuoto, 2.600 €: le due strade coincidono e le promesse restano tutte, come prima', async () => {
    const p = promesse(await apri(2600));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.testo).toContain('Compri sicuro: paghi solo quando arriva.');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
  });
});
