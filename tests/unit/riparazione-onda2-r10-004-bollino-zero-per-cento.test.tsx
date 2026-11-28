/**
 * @vitest-environment jsdom
 */
/**
 * R10-004 (onda 2) — «-0%» E IL PREZZO BARRATO UGUALE AL PREZZO.
 *
 * La prima cura aveva tolto il «-0%» dal bollino della scheda delle griglie. Restavano:
 *  - sulla scheda delle griglie il prezzo barrato uguale al prezzo: 1,00 € al -0,3% resta 1,00 € al
 *    centesimo, e la scheda scriveva «1,00 €» accanto a «~~1,00 €~~»;
 *  - sulla pagina del prodotto il bollino «-0%» con un prezzo di listino appena sopra il prezzo
 *    (100,20 € su 100 €), e con un listino di 100,002 € anche «~~100,00 €~~» accanto a «100,00 €»;
 *    con una promo che al centesimo non cambia il prezzo, il pieno barrato uguale al prezzo;
 *  - il bollino «In promo -0%» della pagina del prodotto, con «Risparmi 0,00 €»;
 *  - l'anteprima del negoziante, «-0%» come la pagina.
 * Adesso tutti e quattro seguono `scontoMostrato`: il barrato solo se il prezzo che si paga, in
 * centesimi, è minore; la percentuale solo se c'è il barrato e arrotondata non è zero.
 *
 * Qui la regola, la scheda VERA, il bollino VERO e la pagina del prodotto VERA.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { accendi } from './aiuti/schermo';
import { scontoMostrato } from '@/lib/sconto-mostrato';
import { formatPrice } from '@/lib/format';

const mondo = vi.hoisted(() => ({
  prodotto: null as null | Record<string, unknown>,
  scontoAttivo: 0,
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
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: async () => ({ data: 0, error: null }) } }));
vi.mock('@/lib/cart', async (vero) => ({ ...(await vero<typeof import('@/lib/cart')>()), addToCart: () => undefined }));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: () => undefined }));
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: () => undefined,
  trackRemoveFromCart: () => undefined,
  trackReviewSubmitted: () => undefined,
}));
// La pagina del prodotto legge con react-query: qui le sue domande hanno la risposta del mondo finto.
// Il bollino «In promo» si prova a parte, col react-query vero (qui sotto è spento).
vi.mock('@tanstack/react-query', async (vero) => {
  const reale = await vero<typeof import('@tanstack/react-query')>();
  return {
    ...reale,
    useQuery: (o: { queryKey: readonly unknown[] }) => {
      if (!mondo.prodotto) return reale.useQuery(o as never);
      const k = o.queryKey;
      if (k[0] === 'products' && k[1] === 'detail') return { data: mondo.prodotto, isLoading: false, isError: false, refetch: () => undefined };
      if (k[0] === 'product-active-discount') return { data: mondo.scontoAttivo, isError: false };
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
vi.mock('@/components/ContactSellerButton', () => ({ default: nulla }));
vi.mock('@/components/ProductViewTracker', () => ({ default: nulla }));
vi.mock('@/components/ProductQA', () => ({ default: nulla }));
vi.mock('@/components/RecentlyViewed', () => ({ default: nulla }));
vi.mock('@/components/QuandoSiVede', () => ({ default: nulla }));
vi.mock('@/components/SimilarProducts', () => ({ default: nulla }));
vi.mock('@/components/AddToListButton', () => ({ default: nulla }));
vi.mock('@/components/PhotoReviewUpload', () => ({ default: nulla }));
vi.mock('@/components/products/SellerCard', () => ({ SellerCard: nulla }));
vi.mock('@/components/products/VendutoDa', () => ({ VendutoDa: nulla }));
vi.mock('@/components/Segnala', () => ({ Segnala: nulla }));
vi.mock('@/components/products/AllergensAccordion', () => ({ AllergensAccordion: nulla }));
vi.mock('@/components/products/FrequentlyBoughtTogether', () => ({ FrequentlyBoughtTogether: nulla }));
vi.mock('@/components/ui/DeliveryCutoff', () => ({ DeliveryCutoff: nulla }));
vi.mock('@/components/ui/SocialProof', () => ({ SocialProof: nulla }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: ProductCard } = await import('@/components/ProductCard');
const { default: ActivePromoBadge } = await import('@/components/ActivePromoBadge');
const { default: ProductPage } = await import('@/app/product/[id]/page');
const { queryKeys } = await import('@/lib/queries/keys');

const n = (t: string) => t.replace(/\s+/g, ' ').trim();
const barrati = (el: Element) => [...el.querySelectorAll('.line-through, s, del')].map((x) => n(x.textContent ?? ''));
const MENO_ZERO = /-\s*0\s*%/;

let pulisci: Array<() => void> = [];
beforeEach(() => {
  mondo.prodotto = null;
  mondo.scontoAttivo = 0;
});
afterEach(() => {
  for (const f of pulisci.splice(0)) f();
  localStorage.clear();
});

describe('R10-004 · la regola: barrato solo se il prezzo cambia al centesimo, percentuale mai zero', () => {
  it('promo sotto lo 0,5% su un prezzo piccolo: il prezzo non cambia, niente barrato né bollino', () => {
    expect(scontoMostrato({ prezzo: 1, scontoPercento: 0.3 })).toEqual({ prezzoCents: 100, barratoCents: null, percento: null, origine: null });
  });
  it('promo sotto lo 0,5% su un prezzo grande: il prezzo cambia, barrato sì, bollino no', () => {
    expect(scontoMostrato({ prezzo: 1000, scontoPercento: 0.3 })).toEqual({ prezzoCents: 99700, barratoCents: 100000, percento: null, origine: 'promo' });
  });
  it('listino appena sopra il prezzo: barrato sì, «-0%» no; listino uguale al centesimo: niente', () => {
    expect(scontoMostrato({ prezzo: 100, prezzoDiListino: 100.2 })).toEqual({ prezzoCents: 10000, barratoCents: 10020, percento: null, origine: 'listino' });
    expect(scontoMostrato({ prezzo: 100, prezzoDiListino: 100.002 })).toEqual({ prezzoCents: 10000, barratoCents: null, percento: null, origine: null });
  });
  it('gli sconti veri restano: promo 20%, promo oltre il tetto (applicato 70), listino da 10 a 8', () => {
    expect(scontoMostrato({ prezzo: 10, scontoPercento: 20 })).toMatchObject({ prezzoCents: 800, barratoCents: 1000, percento: 20 });
    expect(scontoMostrato({ prezzo: 10, scontoPercento: 80 })).toMatchObject({ prezzoCents: 300, barratoCents: 1000, percento: 70 });
    expect(scontoMostrato({ prezzo: 8, prezzoDiListino: 10 })).toMatchObject({ prezzoCents: 800, barratoCents: 1000, percento: 20, origine: 'listino' });
    // R18-006 — Con la promo attiva il listino non si guarda.
    expect(scontoMostrato({ prezzo: 10, scontoPercento: 20, prezzoDiListino: 15 })).toMatchObject({ barratoCents: 1000, origine: 'promo' });
  });
});

async function scheda(extra: Record<string, unknown>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductCard, { id: 'p1', name: 'Grissini', price: 1, images: ['https://x/y.jpg'], storeName: 'Forno', sellerId: 's1', stock: 20, ...extra }));
  });
  pulisci.push(() => { act(() => root.unmount()); div.remove(); });
  return div;
}

describe('R10-004 · la scheda delle griglie', () => {
  it('1,00 € al -0,3%: niente «~~1,00 €~~» accanto a «1,00 €», niente «-0%»', async () => {
    const div = await scheda({ price: 1, discountPercent: 0.3 });
    expect(barrati(div), 'il prezzo barrato è uguale al prezzo').toEqual([]);
    expect(div.textContent).not.toMatch(MENO_ZERO);
    expect(div.textContent).toContain(formatPrice(1));
  });
  it('listino di 100,002 € su 100 €: niente barrato', async () => {
    const div = await scheda({ price: 100, compareAtPrice: 100.002 });
    expect(barrati(div)).toEqual([]);
    expect(div.textContent).not.toMatch(MENO_ZERO);
  });
  it('1000 € al -0,3%: barrato il pieno accanto a 997 €, ma niente «-0%»', async () => {
    const div = await scheda({ price: 1000, discountPercent: 0.3 });
    expect(barrati(div)).toEqual([n(`Prezzo pieno ${formatPrice(1000)}`)]);
    expect(div.textContent).toContain(formatPrice(997));
    expect(div.textContent).not.toMatch(MENO_ZERO);
  });
  it('controprova: al -20% il bollino e il barrato ci sono', async () => {
    const div = await scheda({ price: 10, discountPercent: 20 });
    expect(div.textContent).toContain('-20%');
    expect(barrati(div)).toEqual([n(`Prezzo pieno ${formatPrice(10)}`)]);
  });
});

function bollino(sconto: number, basePrice: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.products.activeDiscount('p1'), sconto);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(ActivePromoBadge, { productId: 'p1', basePrice })),
  );
}

describe('R10-004 · il bollino «In promo» della pagina del prodotto', () => {
  it('1,00 € al -0,3%: il prezzo non cambia, il bollino non c’è (niente «In promo -0%», niente «Risparmi 0,00 €»)', () => {
    const html = bollino(0.3, 1);
    expect(html).not.toMatch(MENO_ZERO);
    expect(html).not.toContain('Risparmi');
    expect(html).toBe('');
  });
  it('1000 € al -0,3%: «In promo» senza percentuale, col prezzo che cambia e quanto si risparmia', () => {
    const html = bollino(0.3, 1000);
    expect(html).toContain('In promo');
    expect(html).not.toMatch(MENO_ZERO);
    expect(html).toContain(formatPrice(997));
    expect(html).toContain(`Risparmi ${formatPrice(3)}`);
  });
  it('controprova: al -25% «In promo -25%»', () => {
    expect(bollino(25, 10)).toContain('In promo -25%');
  });
});

const SCHEDA = {
  id: 'p-1', name: 'Bicicletta da città', description: null, price: 100, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 8, attributes: null, unit: null,
  compare_at_price: null as number | null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Cicli Piacenza', is_approved: true, offers_express: null, store_hours: null },
};

async function pagina(prodotto: Partial<typeof SCHEDA>, sconto = 0) {
  (globalThis as Record<string, unknown>).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = { ...SCHEDA, ...prodotto };
  mondo.scontoAttivo = sconto;
  const schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  pulisci.push(() => schermo.smonta());
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

describe('R10-004 · la pagina del prodotto', () => {
  it('listino 100,20 € su 100 €: il listino si barra, ma il bollino «-0%» non c’è', async () => {
    const radice = await pagina({ price: 100, compare_at_price: 100.2 });
    expect(radice.textContent, 'la pagina scrive «-0%»').not.toMatch(MENO_ZERO);
    expect(barrati(radice)).toContain(n(formatPrice(100.2)));
  });
  it('listino 100,002 € su 100 €: niente «~~100,00 €~~» accanto a «100,00 €», niente «-0%»', async () => {
    const radice = await pagina({ price: 100, compare_at_price: 100.002 });
    expect(radice.textContent).not.toMatch(MENO_ZERO);
    expect(barrati(radice), 'il prezzo barrato è uguale al prezzo').toEqual([]);
    expect(radice.textContent).not.toContain(`Risparmi ${formatPrice(0)}`);
  });
  it('promo 0,3% su 1,00 €: il pieno non si barra accanto allo stesso prezzo', async () => {
    const radice = await pagina({ price: 1 }, 0.3);
    expect(barrati(radice), 'il pieno barrato è uguale al prezzo').toEqual([]);
  });
  it('controprova: listino 125 € su 100 € → «-20%» e il listino barrato', async () => {
    const radice = await pagina({ price: 100, compare_at_price: 125 });
    expect(radice.textContent).toContain('-20%');
    expect(barrati(radice)).toContain(n(formatPrice(125)));
  });
});

describe('R10-004 · l’anteprima del negoziante segue la stessa regola', () => {
  it('ProductForm calcola barrato e bollino con scontoMostrato, e il bollino non esce senza percentuale', () => {
    const src = readFileSync('components/seller/ProductForm.tsx', 'utf8');
    expect(src).toMatch(/scontoMostrato\(\{ prezzo: priceNum, prezzoDiListino: cmpNum \}\)/);
    expect(src).toMatch(/\{discountPct !== null && <span[^>]*>-\{discountPct\}%<\/span>\}/);
  });
});
