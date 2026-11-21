/**
 * @vitest-environment jsdom
 */
/**
 * R01-009 (giro di correzione, parte b) — La scheda contava le altre righe del carrello al prezzo
 * salvato il giorno in cui erano entrate; la cassa lo rilegge dal prodotto, con la promo di oggi
 * (lib/ordini/valida-carrello.ts). Una riga salvata a 2.000 € in promo, oggi a 3.000 € perché la promo
 * è finita, con questo prodotto da 2.500 € fa più di 5.500 €: la scheda prometteva i contanti, la cassa
 * li spegneva. Adesso la scheda rilegge prezzo e promo delle altre righe come la pagina del carrello
 * (una lettura sola, rifatta solo quando cambiano i prodotti delle altre righe); finché non torna, o
 * se cade, vale il prezzo salvato.
 *
 * Qui la scheda VERA con il carrello vero (localStorage) e un catalogo finto di oggi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
  barra: [] as Array<Record<string, unknown>>,
  metodiRicordati: [] as string[],
  // Il catalogo di oggi, come lo leggono la cassa e la pagina del carrello.
  prezziOggi: {} as Record<string, number>,
  scontiOggi: {} as Record<string, number>,
  cade: false,
  letture: [] as string[][],
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
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (tabella: string) => ({
      select: () => ({
        in: async (_colonna: string, ids: string[]) => {
          if (tabella !== 'products') throw new Error(`tabella inattesa: ${tabella}`);
          mondo.letture.push([...ids]);
          if (mondo.cade) return { data: null, error: { message: 'rete caduta' } };
          return { data: ids.filter((i) => i in mondo.prezziOggi).map((i) => ({ id: i, price: mondo.prezziOggi[i] })), error: null };
        },
      }),
    }),
    rpc: async (nome: string, args: { p_products?: string[]; p_product?: string }) => {
      if (mondo.cade) return { data: null, error: { message: 'rete caduta' } };
      if (nome === 'product_active_discounts') {
        return { data: (args.p_products ?? []).map((p) => ({ product_id: p, discount_percent: mondo.scontiOggi[p] ?? 0 })), error: null };
      }
      return { data: mondo.scontiOggi[args.p_product ?? ''] ?? 0, error: null };
    },
  },
}));
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
  mondo.prezziOggi = {};
  mondo.scontiOggi = {};
  mondo.cade = false;
  mondo.letture = [];
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

const prezzoDellaRiga = () => (JSON.parse(localStorage.getItem('cart') ?? '[]') as Riga[]).find((r) => r.id === 'telaio')?.price;

describe('R01-009 · le altre righe del carrello contano al prezzo di oggi, come in cassa', () => {
  it('una riga salvata a 2.000 € che oggi costa 3.000 € (promo finita), con questo prodotto da 2.500 €: niente promessa dei contanti', async () => {
    mondo.prezziOggi = { telaio: 3000 };
    const p = promesse(await apri(2500, [riga('telaio', 2000, 'neg-2')]));
    expect(p.testo, 'la scheda conta la riga a 2.000 € mentre la cassa la fa pagare 3.000 €').not.toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra).toBeUndefined();
    expect(p.testo).not.toContain('paghi solo quando arriva');
    await act(async () => { p.pulsante.click(); });
    expect(mondo.metodiRicordati, '«Compra ora» ricorda i contanti che la cassa poi rifiuta').toEqual([]);
    expect(prezzoDellaRiga(), 'il carrello salvato non si tocca: il prezzo lo rilegge la cassa').toBe(2000);
  });

  it('al contrario: salvata a 3.000 €, oggi in promo al 50% (1.500 €), con 2.500 € qui si resta sotto il tetto e i contanti si promettono', async () => {
    mondo.prezziOggi = { telaio: 3000 };
    mondo.scontiOggi = { telaio: 50 };
    const p = promesse(await apri(2500, [riga('telaio', 3000, 'neg-2')]));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra).toBe('Paghi alla consegna');
  });

  it('se la lettura cade vale il prezzo salvato, come prima (cassa e rotta dei contanti restano il presidio)', async () => {
    mondo.prezziOggi = { telaio: 3000 };
    mondo.cade = true;
    const p = promesse(await apri(2500, [riga('telaio', 2000, 'neg-2')]));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
  });

  it('una lettura sola: niente lettura col solo questo prodotto nel carrello, una con altre righe, e si rifà solo quando cambiano i loro prodotti', async () => {
    await apri(2500, [riga('p-1', 2500, 'neg-1')]);
    expect(mondo.letture, 'nessuna altra riga: niente da rileggere').toEqual([]);
    schermo?.smonta();
    schermo = null;

    mondo.prezziOggi = { telaio: 2000, sella: 50 };
    const radice = await apri(2500, [riga('telaio', 2000, 'neg-2')]);
    expect(mondo.letture).toEqual([['telaio']]);
    // Cambia solo la quantità di una riga che c'è: stessi prodotti, nessuna nuova lettura.
    localStorage.setItem('cart', JSON.stringify([riga('telaio', 2000, 'neg-2', 2)]));
    await act(async () => { window.dispatchEvent(new Event('cart:updated')); });
    for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(mondo.letture).toEqual([['telaio']]);
    // Entra un prodotto nuovo: una lettura in più, per tutte le altre righe.
    localStorage.setItem('cart', JSON.stringify([riga('telaio', 2000, 'neg-2'), riga('sella', 50, 'neg-3')]));
    await act(async () => { window.dispatchEvent(new Event('cart:updated')); });
    for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(mondo.letture).toEqual([['telaio'], ['sella', 'telaio']]);
    expect(promesse(radice).compraOra).toBe('Compra ora · paghi alla consegna');
  });
});
