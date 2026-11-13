/**
 * @vitest-environment jsdom
 */
/**
 * R24-018 — Un capo con più di cento combinazioni ne perde alcune (il modulo del negozio salva le
 * prime 100). Sulla scheda i pulsanti nascono dai singoli valori, quindi la XXL e il colore 17 ci
 * sono, ma la coppia XXL + colore 17 no: scelte tutte e due, il cliente leggeva «Scegli taglia e
 * colore prima di aggiungere» dopo averle scelte, e non capiva perché non poteva comprare.
 *
 * Qui la scheda VERA, con sei taglie per diciassette colori meno le due coppie oltre il tetto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';

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
vi.mock('next/image', () => ({ default: () => null }));
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

const TAGLIE = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const COLORI = Array.from({ length: 17 }, (_, i) => `Colore${i + 1}`);
// 6 × 17 = 102: le ultime due (XXL + Colore16, XXL + Colore17) oltre il tetto di 100 non esistono.
const VARIANTI = TAGLIE.flatMap((t) => COLORI.map((c) => ({ id: `${t}-${c}`, options: { Taglia: t, Colore: c }, label: `${t} · ${c}`, stock: 4 })))
  .slice(0, 100);

const scheda = {
  id: 'p-1', name: 'Maglia', description: null, price: 25, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 400, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: true, tags: null,
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
  mondo.varianti = VARIANTI;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

const gruppo = (radice: HTMLElement, nome: string) => radice.querySelector(`[role="group"][aria-labelledby="opt-${nome}"]`)!;
const valore = (radice: HTMLElement, nome: string, v: string) =>
  Array.from(gruppo(radice, nome).querySelectorAll('button')).find((b) => b.firstChild?.textContent === v)!;
// Il nome che sente il lettore di schermo: l'etichetta, se c'è, se no il testo del pulsante.
const nome = (b: Element) => b.getAttribute('aria-label') ?? b.textContent ?? '';
const scegli = async (radice: HTMLElement, nome: string, v: string) => {
  await act(async () => { clicca(valore(radice, nome, v)); });
};

describe('R24-018 · la combinazione che non c è si dice, non si chiede di scegliere', () => {
  it('XXL + Colore17: la scheda dice che la combinazione non c è, e «Aggiungi» non chiede di scegliere', async () => {
    const radice = await apri();
    expect(valore(radice, 'Colore', 'Colore17'), 'controprova: il colore 17 ha il suo pulsante').toBeTruthy();
    await scegli(radice, 'Taglia', 'XXL');
    await scegli(radice, 'Colore', 'Colore17');
    const stato = radice.querySelector('#disponibilita-variante [role="status"]')?.textContent ?? '';
    expect(stato, 'con tutte e due le opzioni scelte la scheda chiede ancora di sceglierle').not.toMatch(/Scegli taglia e colore/i);
    expect(stato).toMatch(/combinazione non c.è/i);
    const pulsante = radice.querySelector('#acquisto-principale')!;
    expect(pulsante.textContent).not.toMatch(/Scegli le opzioni/);
    await act(async () => { clicca(pulsante); });
    expect(mondo.avvisi.at(-1) ?? '', 'premuto «Aggiungi», il cliente legge «Scegli taglia e colore»').not.toMatch(/^Scegli/);
    expect(mondo.avvisi.at(-1)).toMatch(/combinazione non c.è/i);
    expect(localStorage.getItem('cart')).toBeNull();
  });

  it('scelta la XXL, i colori senza variante si spengono prima di sceglierli', async () => {
    const radice = await apri();
    await scegli(radice, 'Taglia', 'XXL');
    expect(nome(valore(radice, 'Colore', 'Colore17'))).toMatch(/Colore17, non disponibile con XXL/);
    expect(nome(valore(radice, 'Colore', 'Colore16'))).toMatch(/non disponibile/);
    expect(valore(radice, 'Colore', 'Colore17').className).toMatch(/line-through/);
    expect(nome(valore(radice, 'Colore', 'Colore15')), 'XXL + Colore15 esiste: resta acceso').toBe('Colore15');
  });

  it('una combinazione che esiste si compra come prima', async () => {
    const radice = await apri();
    await scegli(radice, 'Taglia', 'XXL');
    await scegli(radice, 'Colore', 'Colore15');
    const pulsante = radice.querySelector('#acquisto-principale')!;
    expect(pulsante.textContent).toMatch(/Aggiungi al carrello/);
    await act(async () => { clicca(pulsante); });
    const righe = JSON.parse(localStorage.getItem('cart') ?? '[]') as Array<{ variantId?: string }>;
    expect(righe.map((r) => r.variantId)).toEqual(['XXL-Colore15']);
  });

  it('con una sola opzione scelta resta «scegli», non «non disponibile»', async () => {
    const radice = await apri();
    await scegli(radice, 'Taglia', 'M');
    const stato = radice.querySelector('#disponibilita-variante [role="status"]')?.textContent ?? '';
    expect(stato).toMatch(/Scegli taglia e colore/i);
  });
});
