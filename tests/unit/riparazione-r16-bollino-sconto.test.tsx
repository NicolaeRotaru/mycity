import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R16-006 — Il bollino dello sconto della scheda prodotto dice la percentuale che il prezzo
 * applica davvero: lo sconto promo non va oltre il 70% (lib/promotions), il bollino neanche.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }) }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: { href: unknown; children?: unknown } & Record<string, unknown>) => ce('a', { ...r, href: String(href) }, children as never) };
});
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock('@/components/hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: new Set<string>(), lettoDavvero: true, toggle: () => {} }) }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isAdmin: false }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => 'shopping', useCanPurchase: () => true }));

async function scheda(discountPercent: number) {
  const { default: ProductCard } = await import('@/components/ProductCard');
  return renderToStaticMarkup(createElement(ProductCard, { id: 'p1', name: 'Pane', price: 10, discountPercent, stock: 5 } as never));
}

describe('R16-006 · bollino dello sconto', () => {
  it('uno sconto grezzo del 90% mostra -70% (il prezzo scende al massimo del 70%)', async () => {
    const html = await scheda(90);
    expect(html).toContain('-70%');
    expect(html).not.toContain('-90%');
    expect(html).toContain('scontato del 70 per cento');
    expect(html).toContain('3,00');
  });
  it('uno sconto dentro il tetto resta quello scritto', async () => {
    const html = await scheda(30);
    expect(html).toContain('-30%');
    expect(html).toContain('7,00');
  });
});
