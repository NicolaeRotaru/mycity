/**
 * @vitest-environment jsdom
 */
/**
 * R01-009 (giro di correzione) — Con lo stesso pezzo da 2.600 € già nel carrello le due strade si
 * dividono: «Compra ora» resta a 2.600 € (contanti sì), «Aggiungi» va a 5.200 € (contanti no).
 * Il riquadro verde diceva allora «Sopra 4.999,99 € non si può pagare in contanti, e il pagamento con
 * carta oggi non è attivo» accanto a «Compra ora · paghi alla consegna»: letti insieme, «non puoi
 * comprare». Con la carta accesa diceva «paghi con carta adesso» accanto a «paghi alla consegna».
 * Quando le strade divergono il riquadro non parla del pagamento (ne parla il pulsante); quando sono
 * tutte e due sopra il tetto dice il rifiuto vero; quando reggono tutte e due promette, come prima.
 *
 * Qui la scheda VERA con il carrello vero (localStorage). La carta si accende con il suo interruttore
 * finto e la chiave finta: lib/funzioni-al-lancio.ts e lib/promesse-pubbliche.ts non si toccano.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';
import { TETTO_CONTANTI_CENTS } from '@/lib/ordini/tetto-dei-contanti';
import { formatPrice } from '@/lib/format';
import { promessaSpedizione } from '@/lib/promesse-pubbliche';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  sconto: 0,
  barra: [] as Array<Record<string, unknown>>,
  metodiRicordati: [] as string[],
  carta: false,
}));
const { nulla } = vi.hoisted(() => ({ nulla: () => null }));

// React 18 in node_modules non ha `use`: la pagina lo usa solo per leggere `params`.
vi.mock('react', async (importOriginal) => {
  const vero = await importOriginal<typeof import('react')>();
  return { ...vero, use: (p: { valore: unknown }) => p.valore };
});
// La carta al lancio è spenta (lib/funzioni-al-lancio.ts): qui si prova anche accesa, senza toccare il file.
vi.mock('@/lib/funzioni-al-lancio', async (importOriginal) => {
  const vero = await importOriginal<typeof import('@/lib/funzioni-al-lancio')>();
  return { ...vero, get CARTA_ACCESA() { return mondo.carta; } };
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
  mondo.carta = false;
  vi.unstubAllEnvs();
});

function carta(accesa: boolean) {
  mondo.carta = accesa;
  vi.stubEnv('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', accesa ? 'pk_test_123' : '');
}

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
const RIFIUTO = /non si (può pagare|paga) in contanti|carta oggi non è attivo|con carta adesso/i;

describe('R01-009 · quando «Compra ora» e «Aggiungi» divergono il riquadro non contraddice il pulsante', () => {
  for (const accesa of [false, true]) {
    const nome = accesa ? 'carta accesa' : 'carta spenta';

    it(`${nome}: 2.600 € dello stesso pezzo già nel carrello, niente promessa generica e niente «non si può pagare» accanto a «Compra ora · paghi alla consegna»`, async () => {
      carta(accesa);
      const p = promesse(await apri(2600, [riga('p-1', 2600, 'neg-1')]));
      expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
      expect(p.testo, 'il riquadro promette i contanti accanto ad «Aggiungi», che porta il carrello a 5.200 €').not.toContain('Paghi in contanti alla consegna');
      expect(p.testo, 'il riquadro dice che non si può pagare accanto a «Compra ora · paghi alla consegna»').not.toMatch(RIFIUTO);
      expect(p.testo).not.toContain(`Sopra ${TETTO}`);
      expect(p.testo).not.toContain('paghi solo quando arriva');
      // Il resto del riquadro resta: la consegna e il reso.
      expect(p.testo).toContain(promessaSpedizione().titolo);
      expect(p.testo).toContain('Reso entro 14 giorni');
    });

    it(`${nome}: tutte e due le strade sopra il tetto (2.600 € qui, 2.500 € di un altro negozio), il riquadro dice il rifiuto vero`, async () => {
      carta(accesa);
      const p = promesse(await apri(2600, [riga('telaio', 2500, 'neg-2')]));
      expect(p.compraOra).toBe('Compra ora');
      expect(p.testo).not.toContain('Paghi in contanti alla consegna');
      expect(p.testo).toContain(
        accesa
          ? `Sopra ${TETTO} non si paga in contanti: paghi con carta adesso`
          : `Sopra ${TETTO} non si può pagare in contanti, e il pagamento con carta oggi non è attivo`,
      );
    });

    it(`${nome}: tutte e due le strade sotto il tetto (1.000 € dello stesso pezzo già nel carrello), la promessa come prima`, async () => {
      carta(accesa);
      const p = promesse(await apri(1000, [riga('p-1', 1000, 'neg-1')]));
      expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
      expect(p.testo).toContain(accesa ? 'Paghi in contanti alla consegna, oppure con carta adesso' : 'Paghi in contanti alla consegna');
      expect(p.testo).toContain('Compri sicuro: paghi solo quando arriva.');
    });
  }

  it('controprova: l\'interruttore finto della carta arriva davvero alla frase', async () => {
    const { frasePagamento } = await import('@/lib/promesse-pubbliche');
    carta(false);
    expect(frasePagamento()).toBe('Paghi in contanti alla consegna');
    carta(true);
    expect(frasePagamento()).toBe('Paghi in contanti alla consegna, oppure con carta adesso');
  });
});
