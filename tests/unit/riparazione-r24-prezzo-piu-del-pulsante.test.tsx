// @vitest-environment jsdom
/**
 * R24-009 — Nella scheda prodotto il prezzo pesava meno del pulsante «+»: il quadrato pieno
 * bg-primary-600 attirava l'occhio più del prezzo. Qui la scheda VERA: il prezzo è più grande del
 * titolo, il «+» è un contorno (niente fondo pieno) e resta alto e largo 44 punti.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: ({ src, alt }: { src: string; alt: string }) => createElement('img', { src, alt }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: unknown }) => createElement('a', { href }, children as never) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cart', () => ({ addToCart: vi.fn() }));
vi.mock('@/components/hooks/useFavorites', () => ({ useFavorites: () => ({ favorites: new Set<string>(), lettoDavvero: true, toggle: vi.fn() }) }));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isAdmin: false }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => true, useCanPurchase: () => true }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: ProductCard } = await import('@/components/ProductCard');

async function scheda(extra: Record<string, unknown> = {}) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(ProductCard, { id: 'p1', name: 'Focaccia', price: 6.5, images: ['https://x/y.jpg'], storeName: 'Forno', sellerId: 's1', stock: 20, ...extra }));
  });
  return { div, root };
}
const PX: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20, 'text-2xl': 24 };
const misura = (el: Element) => {
  const c = [...el.classList];
  const t = c.find((x) => PX[x]); if (t) return PX[t];
  const m = c.map((x) => x.match(/^text-\[(\d+(?:\.\d+)?)px\]$/)).find(Boolean);
  return m ? Number(m[1]) : 0;
};

describe('R24-009 — il prezzo comanda sul pulsante «+»', () => {
  it('il «+» è un contorno: niente fondo pieno colorato, area di tocco 44 punti', async () => {
    const { div, root } = await scheda();
    const bottone = div.querySelector('button[aria-label$="al carrello"]') as HTMLButtonElement;
    expect(bottone).toBeTruthy();
    expect(bottone.className, 'quadrato pieno colorato').not.toMatch(/(^|\s)bg-primary-(500|600|700)(\s|$)/);
    expect(bottone.className).toMatch(/(^|\s)border/);
    // Il contorno deve vedersi: 3:1 sul bianco (WCAG 1.4.11) vuole almeno primary-600 e spessore 2.
    expect(bottone.className, 'contorno troppo spesso/chiaro: sparisce sul bianco').toMatch(/(^|\s)border-2(\s|$)/);
    expect(bottone.className, 'contorno chiaro (primary-200): con questo il «+» sparisce').toMatch(/(^|\s)border-primary-(600|700|800)(\s|$)/);
    expect(bottone.className).not.toMatch(/(^|\s)border-primary-(50|100|200|300|400)(\s|$)/);
    expect(bottone.className).toMatch(/\bh-11\b/);
    expect(bottone.className).toMatch(/\bw-11\b/);
    root.unmount();
  });
  it('il prezzo è più grande del titolo (anche scontato)', async () => {
    for (const extra of [{}, { discountPercent: 20 }]) {
      const { div, root } = await scheda(extra);
      const titolo = div.querySelector('h3')!;
      const prezzo = [...div.querySelectorAll('span')].find((s) => /font-extrabold/.test(s.className))!;
      expect(misura(prezzo)).toBeGreaterThanOrEqual(18);
      expect(misura(prezzo)).toBeGreaterThan(misura(titolo) + 3);
      root.unmount();
    }
  });
});
