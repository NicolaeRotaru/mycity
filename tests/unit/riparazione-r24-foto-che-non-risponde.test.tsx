// @vitest-environment jsdom
/**
 * R24-006 — Se l'indirizzo della foto c'è ma il file non risponde più, la scheda prodotto restava
 * un riquadro bianco e in cassa / «di tendenza» compariva l'icona della foto rotta: la foto di
 * ripiego copriva solo l'elenco vuoto. Qui i componenti VERI: si simula l'errore dell'immagine
 * e si controlla che compaia /foto-mancante.svg.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const disegni = vi.hoisted(() => ({ n: 0 }));
vi.mock('next/image', () => ({
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: (e: unknown) => void }) => {
    disegni.n++;
    return createElement('img', { src, alt, onError });
  },
}));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement('a', { href }, children as never) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@/lib/cart', () => ({ addToCart: vi.fn() }));
vi.mock('@/components/hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: new Set<string>(), lettoDavvero: true, toggle: vi.fn() }) }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isAdmin: false }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => true, useCanPurchase: () => true }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [{ product_id: 'p1', view_count: 9, product: { id: 'p1', name: 'Pane', price: 3, images: ['https://example.com/cancellata.jpg'], profiles: null } }],
    isLoading: false, isError: false, refetch: vi.fn(),
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { CartGroupsList } = await import('@/components/checkout/CartGroupsList');

async function monta(el: ReturnType<typeof createElement>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => { root.render(el); });
  return { div, root };
}
async function rompi(div: HTMLElement) {
  const img = div.querySelector('img') as HTMLImageElement;
  await act(async () => { img.dispatchEvent(new Event('error')); });
  return (div.querySelector('img') as HTMLImageElement).getAttribute('src');
}

describe('R24-006 — la foto che non risponde passa al ripiego', () => {
  it('la scheda prodotto', async () => {
    const { default: ProductCard } = await import('@/components/ProductCard');
    const { div, root } = await monta(createElement(ProductCard, { id: 'p1', name: 'Pane', price: 3, images: ['https://example.com/cancellata.jpg'], sellerId: 's1' } as never));
    expect(div.querySelector('img')!.getAttribute('src')).toContain('example.com');
    expect(await rompi(div)).toBe('/foto-mancante.svg');
    root.unmount();
  });
  it('la miniatura in cassa', async () => {
    const gruppi = [{ sellerId: 's1', storeName: 'Forno', items: [{ id: 'p1', name: 'Pane', price: 3, quantity: 1, image: 'https://example.com/cancellata.jpg' }] }];
    const { div, root } = await monta(createElement(CartGroupsList, { groups: gruppi } as never));
    expect(await rompi(div)).toBe('/foto-mancante.svg');
    root.unmount();
  });
  it('«di tendenza» in home', async () => {
    const { default: TrendingNow } = await import('@/components/home/TrendingNow');
    const { div, root } = await monta(createElement(TrendingNow));
    expect(div.querySelector('img')!.getAttribute('src')).toContain('example.com');
    expect(await rompi(div)).toBe('/foto-mancante.svg');
    root.unmount();
  });
  it('se anche il ripiego non risponde non si entra in un giro infinito', async () => {
    const { default: FotoConRipiego } = await import('@/components/ui/FotoConRipiego');
    const sbagliati = vi.fn();
    const { div, root } = await monta(createElement(FotoConRipiego, { src: 'https://example.com/cancellata.jpg', alt: 'Pane', width: 10, height: 10, onError: sbagliati } as never));
    expect(await rompi(div)).toBe('/foto-mancante.svg');
    const dopoIlPrimo = disegni.n;
    // Il ripiego stesso fallisce, più volte: la foto resta il ripiego, nessun cambio di src
    // e nessun ridisegno a catena (ogni errore al più un ridisegno, mai un giro).
    for (let i = 0; i < 5; i++) expect(await rompi(div)).toBe('/foto-mancante.svg');
    expect(disegni.n - dopoIlPrimo, 'il ripiego che fallisce ha scatenato ridisegni a catena').toBeLessThanOrEqual(5);
    expect(sbagliati).toHaveBeenCalledTimes(6);
    root.unmount();
  });
});
