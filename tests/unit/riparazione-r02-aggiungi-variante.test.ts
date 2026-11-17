/**
 * @vitest-environment jsdom
 */
/**
 * R02-001 — Sulla scheda prodotto il freno contro il doppio tocco guardava solo il tempo: taglia S
 * aggiunta, poi M scelta e aggiunta entro un secondo → nel carrello restava solo S, e l'avviso diceva
 * «Già aggiunto», falso. Uguale con «+» sulla quantità. Ora il freno scarta solo il tocco ripetuto
 * sulla STESSA scelta (variante + quantità): una scelta diversa entro il secondo si aggiunge.
 *
 * Qui la scheda VERA, con l'orologio finto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  varianti: [] as Array<Record<string, unknown>>,
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
  id: 'p-1', name: 'Maglietta', description: null, price: 12, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 50, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: true, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Bottega', is_approved: true, offers_express: null, store_hours: null },
};
const taglie = [
  { id: 'v-s', options: { Taglia: 'S' }, label: 'S', stock: 10, position: 0 },
  { id: 'v-m', options: { Taglia: 'M' }, label: 'M', stock: 10, position: 1 },
];

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
  mondo.varianti = taglie;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

const righe = () =>
  (JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ id: string; variantId?: string; quantity: number }>)
    .filter((r) => r.id === 'p-1');
const pezzi = (variante: string) => righe().filter((r) => r.variantId === variante).reduce((s, r) => s + r.quantity, 0);

function taglia(radice: HTMLElement, val: string) {
  const b = Array.from(radice.querySelectorAll('[role="group"] button')).find((x) => x.textContent?.trim() === val);
  if (!b) throw new Error(`manca la taglia ${val}`);
  return b;
}
const alle = (ms: number) => vi.setSystemTime(new Date(Date.UTC(2026, 10, 17, 10, 0, 0, ms)));

describe('R02-001 · il freno guarda la scelta, non solo il tempo', () => {
  it('S aggiunta, poi M scelta a +400 ms e aggiunta a +800 ms: nel carrello S e M', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    alle(0);
    const radice = await apri();
    const pulsante = radice.querySelector('#acquisto-principale')!;

    await act(async () => { clicca(taglia(radice, 'S')); });
    await act(async () => { clicca(pulsante); });
    expect(pezzi('v-s')).toBe(1);

    alle(400);
    await act(async () => { clicca(taglia(radice, 'M')); });
    alle(800);
    await act(async () => { clicca(pulsante); });
    expect(pezzi('v-m'), 'la M scelta dopo deve entrare nel carrello').toBe(1);
    expect(pezzi('v-s')).toBe(1);
    expect(mondo.avvisi.filter((a) => a.tipo === 'success')).toHaveLength(2);
    expect(mondo.avvisi.some((a) => /già aggiunto/i.test(a.testo)), 'nessun «già aggiunto» falso').toBe(false);
  });

  it('la stessa scelta ripetuta entro un secondo resta una sola aggiunta', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    alle(0);
    const radice = await apri();
    const pulsante = radice.querySelector('#acquisto-principale')!;

    await act(async () => { clicca(taglia(radice, 'S')); });
    await act(async () => { clicca(pulsante); });
    alle(300);
    await act(async () => { clicca(pulsante); });
    alle(700);
    await act(async () => { clicca(pulsante); });
    expect(pezzi('v-s'), 'il doppio tocco sulla stessa scelta resta frenato').toBe(1);
    expect(mondo.avvisi.filter((a) => a.tipo === 'success')).toHaveLength(1);
    expect(mondo.avvisi.filter((a) => /già aggiunto/i.test(a.testo))).toHaveLength(2);
  });

  it('S da 1 aggiunta, poi «+» e di nuovo «aggiungi» entro 600 ms: entrano anche gli altri 2', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    alle(0);
    const radice = await apri();
    const pulsante = radice.querySelector('#acquisto-principale')!;

    await act(async () => { clicca(taglia(radice, 'S')); });
    await act(async () => { clicca(pulsante); });
    expect(pezzi('v-s')).toBe(1);
    alle(300);
    await act(async () => { clicca(radice.querySelector('[aria-label="Aumenta quantità"]')!); });
    alle(600);
    await act(async () => { clicca(pulsante); });
    expect(pezzi('v-s'), 'la quantità cambiata è un\'aggiunta nuova').toBe(3);
    expect(mondo.avvisi.filter((a) => a.tipo === 'success')).toHaveLength(2);
  });
});
