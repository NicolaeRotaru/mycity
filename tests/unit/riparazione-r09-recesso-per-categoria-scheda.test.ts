/**
 * @vitest-environment jsdom
 */
/**
 * 27/11/2026 (R09-015) — LA SCHEDA PRODOTTO DICEVA «ESCLUSO DAL RECESSO» SOLO CON LA SPUNTA.
 *
 * Il fatto `legale.recesso-esclusi` esclude pane, dolci, salumi, latticini e gli altri freschi, e la
 * rotta dei resi lo sa dalla categoria (anche dal padre: una sottocategoria del Panificio resta pane).
 * Ma l'informazione PRIMA dell'acquisto (art. 49 c.1 lett. m Cod. Cons.) sulla scheda seguiva solo
 * la spunta `non_recedibile`, che parte spenta: il filone di un forno che non l'aveva toccata diceva
 * «Reso entro 14 giorni», e poi «Cambio idea» veniva rifiutato.
 *
 * Qui la scheda VERA: la sua lettura del recesso gira davvero, su una banca dati finta.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi } from './aiuti/schermo';
import { FRASE_RESO, FRASE_RESO_ESCLUSO } from '@/lib/promesse-pubbliche';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  righe: {} as Record<string, Array<Record<string, unknown>>>,
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
// La banca dati finta: risponde secondo la tabella e i filtri `eq` / `in`.
vi.mock('@/lib/supabase/client', () => {
  const tavola = (nome: string) => {
    const filtri: Array<(r: Record<string, unknown>) => boolean> = [];
    const righe = () => (mondo.righe[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
    const c: Record<string, unknown> = {
      select: () => c,
      eq: (k: string, v: unknown) => (filtri.push((r) => r[k] === v), c),
      in: (k: string, vs: unknown[]) => (filtri.push((r) => vs.includes(r[k])), c),
      order: () => c,
      limit: () => c,
      maybeSingle: async () => ({ data: righe()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve({ data: righe(), error: null }).then(ok, ko),
    };
    return c;
  };
  return { supabase: { from: tavola, auth: { getUser: async () => ({ data: { user: null } }) } } };
});
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
}));
// La lettura del recesso GIRA davvero (la sua queryFn), le altre rispondono dal mondo della prova.
vi.mock('@tanstack/react-query', async () => {
  const React = await import('react');
  return {
    useQuery: (o: { queryKey: readonly unknown[]; queryFn?: () => Promise<unknown> }) => {
      const k = o.queryKey;
      if (k[0] === 'product' && k[2] === 'recesso') {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const [data, setData] = React.useState<unknown>(undefined);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        React.useEffect(() => {
          void o.queryFn?.().then(setData);
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, []);
        return { data, isLoading: false, isError: false, refetch: () => undefined };
      }
      if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
      if (k[0] === 'product-active-discount') return { data: 0, isError: false };
      if (k[0] === 'product-variants') return { data: [], isError: false, refetch: () => undefined };
      return { data: undefined, isLoading: false, isError: false, refetch: () => undefined };
    },
    useMutation: () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false }),
    useQueryClient: () => ({ invalidateQueries: () => undefined, setQueryData: () => undefined }),
  };
});
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

/** Panificio → «Pane di casa» (una sottocategoria creata dal pannello), e il miele fuori dai freschi. */
const CATEGORIE = [
  { id: 'cat-panificio', slug: 'panificio', parent_id: null },
  { id: 'cat-pane-di-casa', slug: 'pane-di-casa', parent_id: 'cat-panificio' },
  { id: 'cat-miele', slug: 'alimentari-miele', parent_id: null },
];

function scheda(nome: string, categoria: string | null, nonRecedibile: boolean) {
  return {
    id: 'p-1', name: nome, description: null, price: 4.5, images: [], seller_id: 'neg-1', status: 'active',
    created_at: '2026-01-01T00:00:00Z', category_id: categoria, stock: 8, attributes: null, unit: null,
    compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
    categories: null, non_recedibile: nonRecedibile,
    profiles: { id: 'neg-1', store_name: 'Forno Piacenza', is_approved: true, offers_express: null, store_hours: null },
  };
}

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.righe = {};
  mondo.prodotto = null;
  vi.useRealTimers();
});

async function apri(prodotto: ReturnType<typeof scheda>): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = prodotto;
  mondo.righe = { products: [prodotto], categories: CATEGORIE };
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice.textContent ?? '';
}

describe('R09-015 — la scheda prodotto dice «escluso dal recesso» anche per la categoria', () => {
  it('IL CASO CHE ROMPEVA — il filone del Panificio, senza spunta, non promette il reso', async () => {
    const t = await apri(scheda('Filone', 'cat-pane-di-casa', false));
    expect(t, 'controprova: la scheda si deve disegnare').toContain('Filone');
    expect(t, 'il pane escluso per categoria non dice «escluso dal recesso» prima dell’acquisto').toContain(FRASE_RESO_ESCLUSO);
    expect(t).not.toContain(FRASE_RESO);
  }, 30_000);

  it('controprova: la torta con la spunta resta esclusa', async () => {
    const t = await apri(scheda('Torta su ordinazione', null, true));
    expect(t).toContain(FRASE_RESO_ESCLUSO);
  }, 30_000);

  it('controprova: il miele (categoria non fresca, senza spunta) tiene la frase generale', async () => {
    const t = await apri(scheda('Miele di acacia', 'cat-miele', false));
    expect(t).toContain(FRASE_RESO);
    expect(t).not.toContain(FRASE_RESO_ESCLUSO);
  }, 30_000);
});
