// @vitest-environment jsdom
/**
 * R10-004 — Con uno sconto frazionario sotto lo 0,5% il bollino della scheda prodotto mostrava «-0%».
 * Qui la scheda VERA: sconto 0,3% → nessun bollino «-0%» e nessun «0 per cento» nel nome del link;
 * uno sconto vero (20%) il bollino lo mostra ancora.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children?: unknown }) => createElement('a', { href, ...r }, children as never) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cart', () => ({ addToCart: vi.fn() }));
vi.mock('@/components/hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: new Set<string>(), lettoDavvero: true, toggle: vi.fn() }) }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isAdmin: false }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => true, useCanPurchase: () => true }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: ProductCard } = await import('@/components/ProductCard');

async function scheda(extra: Record<string, unknown>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductCard, { id: 'p1', name: 'Focaccia', price: 6.5, images: ['https://x/y.jpg'], storeName: 'Forno', sellerId: 's1', stock: 20, ...extra }));
  });
  return { div, root };
}

describe('R10-004 — il bollino non dice «-0%»', () => {
  it('sconto 0,3%: nessun «-0%» e nessun «0 per cento»', async () => {
    const { div, root } = await scheda({ discountPercent: 0.3 });
    expect(div.textContent).not.toMatch(/-\s*0\s*%/);
    expect(div.innerHTML).not.toMatch(/scontato del 0 per cento/);
    root.unmount();
  });
  it('sconto 20%: il bollino «-20%» c\'è ancora', async () => {
    const { div, root } = await scheda({ discountPercent: 20 });
    expect(div.textContent).toContain('-20%');
    root.unmount();
  });
});
