// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { accendi } from './aiuti/schermo';
import { fraseTariffaConsegna, promessaSpedizione, VOCE_CONSEGNA } from '@/lib/promesse-pubbliche';
import { readFileSync } from 'node:fs';
import { formatPrice } from '@/lib/format';
import {
  CONSEGNA_NEGOZIO_IN_PIU_CENTS,
  PLATFORM_DELIVERY_FEE_CENTS,
  SPESA_SENZA_SUPPLEMENTO_CENTS,
  SUPPLEMENTO_CONSEGNA_CENTS,
  SUPPLEMENTO_VELOCE_CENTS,
} from '@/lib/constants';

/**
 * R08-002 — Il riquadro verde della scheda prodotto sul telefono: la tariffa intera (264 caratteri)
 * era un muro di testo. Ora la scheda mostra UNA riga corta (al massimo 90 caratteri) e rimanda alla
 * pagina Spedizioni; la cassa continua a leggere la tariffa intera. Nessun importo cambia.
 */
const MAX_RIGA = 90;
const eur = (c: number) => formatPrice(c / 100);

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
vi.mock('@/components/ui/SocialProof', () => ({ SocialProof: nulla }));

vi.mock('@/components/ui/DeliveryCutoff', () => ({ DeliveryCutoff: nulla }));

import ProductPage from '@/app/product/[id]/page';

const scheda = {
  id: 'p-1', name: 'Pane', description: null, price: 3, images: [], seller_id: 'neg-1', status: 'active',
  created_at: '2026-01-01T00:00:00Z', category_id: null, stock: 4, attributes: null, unit: null,
  compare_at_price: null, condition: null, express_enabled: null, has_variants: false, tags: null, categories: null,
  profiles: { id: 'neg-1', store_name: 'Forno', is_approved: true, offers_express: null, store_hours: null },
};

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  localStorage.clear();
});

async function apri() {
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  (window.HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
  mondo.prodotto = scheda;
  schermo = accendi(ProductPage, { params: { valore: { id: 'p-1' } } });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return schermo.radice;
}

/** Il riquadro verde: quello con la riga del pagamento e quella del reso. */
const riquadro = (radice: HTMLElement) => radice.querySelector('div.bg-olive-50')!;

describe('R08-002 la scheda prodotto: una riga corta e il rimando alla tariffa', () => {
  it('la riga della consegna nel riquadro verde sta in 90 caratteri', async () => {
    const r = riquadro(await apri());
    const riga = Array.from(r.querySelectorAll('span')).find((s) => s.textContent?.includes(VOCE_CONSEGNA))!;
    expect(riga, 'la riga della consegna non c\'è').toBeTruthy();
    const testo = riga.textContent!.replace(/\s+/g, ' ').trim();
    expect(testo.length, testo).toBeLessThanOrEqual(MAX_RIGA);
  });
  it('dice «da 3,00 € per tutto il carrello», con l\'importo delle costanti', async () => {
    const r = riquadro(await apri());
    expect(r.textContent).toContain(`${VOCE_CONSEGNA} da ${eur(PLATFORM_DELIVERY_FEE_CENTS)} per tutto il carrello`);
  });
  it('non ripete la tariffa intera nel riquadro (né «una volta sola», né i supplementi)', async () => {
    const r = riquadro(await apri());
    expect(r.textContent).not.toContain('una volta sola');
    expect(r.textContent).not.toContain('per ogni negozio');
    expect(r.textContent).not.toContain('all’ora che scegli');
  });
  it('rimanda alla pagina Spedizioni con «come si calcola»', async () => {
    const r = riquadro(await apri());
    const link = Array.from(r.querySelectorAll('a')).find((a) => a.textContent === 'come si calcola');
    expect(link, 'manca il collegamento alla tariffa intera').toBeTruthy();
    expect(link!.getAttribute('href')).toBe('/shipping');
  });
});

describe('R08-002 la frase corta sta nei 90 caratteri anche con altre basi', () => {
  it('base di 3 €, di 1 € e a zero: la riga che la scheda mostra (titolo) non supera 90 caratteri', () => {
    for (const c of [PLATFORM_DELIVERY_FEE_CENTS, 100, 0]) {
      const p = promessaSpedizione(c);
      expect(p.dettaglioConsegna, `base ${c}`).not.toBeNull();
      expect(p.titolo.length, p.titolo).toBeLessThanOrEqual(MAX_RIGA);
    }
  });
});

describe('R08-002 la cassa vede ancora la tariffa intera, con gli stessi importi', () => {
  it('dettaglioConsegna è la tariffa intera di sempre, parola per parola', () => {
    const d = promessaSpedizione().dettaglioConsegna!;
    expect(d).toBe(`${VOCE_CONSEGNA} ${fraseTariffaConsegna()}`);
    expect(d.length).toBeGreaterThan(200);
    for (const c of [
      PLATFORM_DELIVERY_FEE_CENTS,
      CONSEGNA_NEGOZIO_IN_PIU_CENTS,
      SUPPLEMENTO_CONSEGNA_CENTS,
      SUPPLEMENTO_VELOCE_CENTS,
      SPESA_SENZA_SUPPLEMENTO_CENTS,
    ]) expect(d).toContain(eur(c));
    expect(d).toContain('una volta sola per tutto il carrello, all’ora che scegli in cassa');
    expect(d).toContain('in più per ogni negozio dove spendi meno di');
    expect(d).toContain('la consegna veloce');
    expect(d).toContain('compresa se un negozio è sotto');
  });
  it('la cassa legge dettaglioConsegna, non la riga corta', () => {
    const cassa = readFileSync('app/checkout/page.tsx', 'utf8');
    expect(cassa).toContain('promessaConsegna.dettaglioConsegna');
  });
});

describe('R08-002 la riga in linea non cresce dopo il caricamento', () => {
  it('la riga della consegna in linea tiene lo spazio di due righe a ogni larghezza', async () => {
    // Nella pagina il componente è finto; qui serve quello vero.
    const { DeliveryCutoff } = await vi.importActual<typeof import('@/components/ui/DeliveryCutoff')>('@/components/ui/DeliveryCutoff');
    const html = renderToStaticMarkup(createElement(DeliveryCutoff, { variant: 'inline' }));
    expect(html).toContain('min-h-[2.5rem]');
    expect(html).not.toContain('sm:min-h-0');
  });
});
