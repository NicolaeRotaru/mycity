/**
 * @vitest-environment jsdom
 */
/**
 * R02-006 — La scheda prodotto prometteva «paghi alla consegna» anche sopra il tetto dei contanti.
 *
 * Per un pezzo solo sopra 4.999,99 € la scheda non lo prometteva più, ma contava solo QUESTO prodotto
 * con la consegna minima. «Compra ora» però aggiunge al carrello che c'è e apre la cassa su tutto il
 * carrello, e la cassa e la rotta dei contanti guardano il lordo di tutto: con altra merce già nel
 * carrello, con più negozi (un euro per ogni negozio in più e per ogni negozio sotto i 10 €) o con la
 * veloce (un euro in più) la scheda prometteva i contanti e ricordava 'cod', e la cassa poi li spegneva.
 *
 * Qui la scheda VERA con il carrello vero (localStorage, come lo legge `getCart`). Il tetto non si
 * tocca: si legge da lib/ordini/tetto-dei-contanti.ts.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { TETTO_CONTANTI_CENTS } from '@/lib/ordini/tetto-dei-contanti';

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

describe('R02-006 · la scheda guarda il tetto dei contanti sul carrello che la cassa troverà', () => {
  it('controprova: il tetto è quello della cassa, 4.999,99 €', () => {
    expect(TETTO_CONTANTI_CENTS).toBe(499_999);
  });

  it('carrello vuoto, 2.600 €: i contanti si promettono e «Compra ora» li ricorda, come prima', async () => {
    const p = promesse(await apri(2600));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra).toBe('Paghi alla consegna');
    await act(async () => { clicca(p.pulsante); });
    expect(mondo.metodiRicordati).toEqual(['cod']);
  });

  it('2.600 € con 2.500 € di un altro negozio già nel carrello: 5.100 € di merce, nessuna promessa e niente «cod»', async () => {
    const p = promesse(await apri(2600, [riga('telaio', 2500, 'neg-2')]));
    expect(p.testo, 'il riquadro verde promette i contanti su un carrello da 5.100 € di merce').not.toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra).toBeUndefined();
    expect(p.testo).not.toContain('paghi solo quando arriva');
    await act(async () => { clicca(p.pulsante); });
    expect(mondo.metodiRicordati, '«Compra ora» apre la cassa sui contanti che la cassa poi rifiuta').toEqual([]);
  });

  it('2.600 € con 2.000 € dello stesso negozio: 4.600 € + 4 € di consegna, i contanti si possono', async () => {
    const p = promesse(await apri(2600, [riga('casco', 2000, 'neg-1')]));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
  });

  it('più negozi: 4.990 € + 5 € di un altro negozio sono 4.995 € di merce, e la consegna è 5 € (base, negozio in più, spesa piccola): 5.000 €, niente contanti', async () => {
    const p = promesse(await apri(4990, [riga('campanello', 5, 'neg-2')]));
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra).toBeUndefined();
    expect(p.testo).not.toContain('Paghi in contanti alla consegna');
  });

  it('la veloce costa un euro in più e in cassa si può scegliere: 4.996,50 € da soli fanno 5.000,50 €, niente contanti', async () => {
    const p = promesse(await apri(4996.5));
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra).toBeUndefined();
  });

  it('la barra in fondo aggiunge: con lo stesso prodotto già nel carrello la sua riga non promette i contanti, «Compra ora» sì', async () => {
    // «Compra ora» porta la riga a 1 pezzo (2.600 €); «Aggiungi» della barra la porta a 2 (5.200 €).
    const p = promesse(await apri(2600, [riga('p-1', 2600, 'neg-1')]));
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra, 'la barra promette i contanti su un carrello che con «Aggiungi» arriva a 5.200 €').toBeUndefined();
  });

  it('il carrello cambia a scheda aperta (un\'altra scheda, un altro acquisto): la promessa si rifà', async () => {
    const radice = await apri(2600);
    expect(promesse(radice).compraOra).toBe('Compra ora · paghi alla consegna');
    localStorage.setItem('cart', JSON.stringify([riga('telaio', 2500, 'neg-2')]));
    await act(async () => { window.dispatchEvent(new Event('cart:updated')); });
    const p = promesse(radice);
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra).toBeUndefined();
  });
});
