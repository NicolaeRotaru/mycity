/**
 * @vitest-environment jsdom
 */
/**
 * R02-007 — La scheda prodotto prometteva «paghi alla consegna» anche sopra il tetto dei contanti.
 *
 * Il tetto è quello della legge (lib/ordini/tetto-dei-contanti.ts, 4.999,99 € sul lordo: merce più
 * consegna) e la cassa e la rotta dei contanti lo applicano già. La scheda però diceva «Paghi in
 * contanti alla consegna», «Compra ora · paghi alla consegna» e, nella barra in fondo, «Paghi alla
 * consegna» su un acquisto da 5.200 €: il cliente compilava la cassa e scopriva lì che i contanti no.
 *
 * Qui la frase con importi sotto, uguale e sopra il tetto, e la scheda VERA con prezzi e una
 * promozione realistici. Il tetto non si tocca: si legge.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { frasePagamento } from '@/lib/promesse-pubbliche';
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

const CONTANTI = ['contanti-alla-consegna'] as const;
const TETTO = formatPrice(4999.99);
const CARTA_E_CONTANTI = ['carta-adesso', 'contanti-alla-consegna'] as const;

describe('R02-007 · la frase del pagamento guarda il tetto dei contanti', () => {
  it('sotto e uguale al tetto (4.999,99 € di lordo) i contanti si promettono', () => {
    expect(frasePagamento(CONTANTI, 499_998)).toBe('Paghi in contanti alla consegna');
    expect(frasePagamento(CONTANTI, 499_999)).toBe('Paghi in contanti alla consegna');
    expect(frasePagamento(CARTA_E_CONTANTI, 499_999)).toBe('Paghi in contanti alla consegna, oppure con carta adesso');
  });

  it('un centesimo sopra il tetto no: con la carta spenta lo dice, con la carta accesa propone la carta', () => {
    const soloContanti = frasePagamento(CONTANTI, 500_000);
    expect(soloContanti).not.toMatch(/paghi in contanti/i);
    // La cifra la scrive formatPrice, come la cassa («4999,99 €»: in italiano le migliaia a quattro cifre non si separano).
    expect(soloContanti).toBe(`Sopra ${TETTO} non si può pagare in contanti, e il pagamento con carta oggi non è attivo`);
    expect(frasePagamento(CARTA_E_CONTANTI, 520_300)).toBe(`Sopra ${TETTO} non si paga in contanti: paghi con carta adesso`);
  });

  it('senza importo la frase resta quella di sempre (home, «Come funziona», carrello)', () => {
    expect(frasePagamento(CONTANTI)).toBe('Paghi in contanti alla consegna');
    expect(frasePagamento(CARTA_E_CONTANTI)).toBe('Paghi in contanti alla consegna, oppure con carta adesso');
    expect(frasePagamento(['carta-adesso'], 900_000)).toBe('Paghi con carta adesso');
  });
});

const scheda = (prezzo: number) => ({
  id: 'p-1', name: 'Bicicletta elettrica', description: null, price: prezzo, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 5, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null,
  categories: null,
  profiles: { id: 'neg-1', store_name: 'Cicli Piacenza', is_approved: true, offers_express: null, store_hours: null },
});

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
  mondo.barra = [];
  mondo.metodiRicordati = [];
  mondo.sconto = 0;
});

async function apri(prezzo: number, sconto = 0) {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda(prezzo);
  mondo.sconto = sconto;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

/** Quello che la scheda promette sul pagamento: riquadro verde, «Compra ora», barra in fondo, rassicurazione. */
function promesse(radice: HTMLElement) {
  const compraOra = Array.from(radice.querySelectorAll('button')).find((b) => /^(Compra ora|Apro la cassa)/.test(b.textContent ?? ''));
  return {
    testo: radice.textContent ?? '',
    compraOra: compraOra?.textContent ?? '',
    notaBarra: mondo.barra.at(-1)?.note as string | undefined,
    pulsante: compraOra!,
  };
}

const PROMETTE_CONTANTI = /paghi (in contanti )?alla consegna/i;

describe('R02-007 · la scheda prodotto e i contanti', () => {
  it('sotto il tetto (2.600 €): riquadro, pulsante e barra promettono il pagamento alla consegna, come prima', async () => {
    const p = promesse(await apri(2600));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra).toBe('Paghi alla consegna');
    expect(p.testo).toContain('Compri sicuro: paghi solo quando arriva.');
    await act(async () => { clicca(p.pulsante); });
    expect(mondo.metodiRicordati).toEqual(['cod']);
  });

  it('sopra il tetto (5.200 € + 3 € di consegna): nessuna promessa di contanti, e la cassa non riparte dai contanti', async () => {
    const p = promesse(await apri(5200));
    expect(p.testo, 'il riquadro verde promette i contanti su 5.203 € di lordo').not.toContain('Paghi in contanti alla consegna');
    expect(p.testo).toContain(`Sopra ${TETTO} non si può pagare in contanti`);
    expect(p.compraOra).not.toMatch(PROMETTE_CONTANTI);
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra, 'la barra in fondo promette «Paghi alla consegna» sopra il tetto').toBeUndefined();
    expect(p.testo).not.toContain('paghi solo quando arriva');
    await act(async () => { clicca(p.pulsante); });
    expect(mondo.metodiRicordati, '«Compra ora» apre la cassa sui contanti che la cassa poi rifiuta').toEqual([]);
  });

  it('con la promozione attiva conta il prezzo che si paga: 5.200 € al -20% sono 4.160 €, e i contanti si possono', async () => {
    const p = promesse(await apri(5200, 20));
    expect(p.testo).toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora · paghi alla consegna');
    expect(p.notaBarra).toBe('Paghi alla consegna');
  });

  // R02-006 — La consegna che si conta è la più cara che la cassa può ancora far scegliere: la veloce,
  // un euro in più. 4.995,99 € + 3 € + 1 € = 4.999,99 €: i contanti valgono qualunque consegna si scelga.
  it('uguale al tetto: 4.995,99 € + 3 € di consegna + 1 € della veloce = 4.999,99 € si paga in contanti; un centesimo in più no', async () => {
    const giusto = promesse(await apri(4995.99));
    expect(giusto.testo).toContain('Paghi in contanti alla consegna');
    expect(giusto.compraOra).toBe('Compra ora · paghi alla consegna');
    schermo?.smonta();
    schermo = null;
    mondo.barra = [];
    const sopra = promesse(await apri(4996));
    expect(sopra.testo).not.toContain('Paghi in contanti alla consegna');
    expect(sopra.compraOra).toBe('Compra ora');
    expect(sopra.notaBarra).toBeUndefined();
  });

  it('la quantità conta: due pezzi da 2.600 € fanno 5.203 € e la promessa sparisce', async () => {
    const radice = await apri(2600);
    expect(promesse(radice).compraOra).toBe('Compra ora · paghi alla consegna');
    const piu = radice.querySelector('button[aria-label="Aumenta quantità"]')!;
    await act(async () => { clicca(piu); });
    const p = promesse(radice);
    expect(p.testo).not.toContain('Paghi in contanti alla consegna');
    expect(p.compraOra).toBe('Compra ora');
    expect(p.notaBarra).toBeUndefined();
  });
});
