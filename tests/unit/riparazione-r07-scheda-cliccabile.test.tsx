// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * R07-004 (12/11/2026) — toccando la scheda di un prodotto in home e nella ricerca
 * non si apriva niente. Il link che apre la scheda copre tutta la card ma sta sotto
 * (z-0): foto (riquadro «relative», dopo il link), corpo («relative z-10») e badge
 * lo coprivano, e il tocco finiva su di loro. jsdom non sa dire quale strato prende
 * il tocco, quindi la prova guarda la regola: ogni strato sopra il link è
 * trasparente al tocco, e solo i bottoni (cuore, «+») lo riprendono.
 */
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt?: string }) => createElement('img', { alt: p.alt ?? '' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement('a', { href, ...r }, children),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cart', () => ({ addToCart: vi.fn() }));
vi.mock('@/components/hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: new Set<string>(), lettoDavvero: true, toggle: vi.fn() }),
}));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isAdmin: false }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => true, useCanPurchase: () => true }));

import ProductCard from '@/components/ProductCard';

function card() {
  const html = renderToStaticMarkup(
    createElement(ProductCard, {
      id: 'p1', name: 'Pane casereccio', price: 12, images: ['https://x/y.jpg'], stock: 2,
      storeName: 'Forno Rossi', discountPercent: 20, createdAt: new Date().toISOString(),
    }),
  );
  const c = document.createElement('div');
  c.innerHTML = html;
  return c.firstElementChild as HTMLElement;
}

describe('R07-004 · il tocco sulla card arriva al link della scheda', () => {
  it('il link copre la card', () => {
    const link = card().querySelector('a[href="/product/p1"]') as HTMLElement;
    expect(link).toBeTruthy();
    expect(link.className).toMatch(/absolute inset-0/);
  });

  it('ogni strato disegnato sopra il link è trasparente al tocco', () => {
    const radice = card();
    const strati = Array.from(radice.children).filter((e) => e.tagName !== 'A');
    expect(strati.length).toBeGreaterThanOrEqual(3); // badge, foto, corpo
    for (const s of strati) {
      const trasparente = /\bpointer-events-none\b/.test(s.className) || /pointer-events:\s*none/.test(s.getAttribute('style') ?? '');
      expect(trasparente, s.outerHTML.slice(0, 120)).toBe(true);
    }
  });

  it('cuore e «+» riprendono il tocco', () => {
    const bottoni = Array.from(card().querySelectorAll('button'));
    expect(bottoni.length).toBe(2);
    for (const b of bottoni) expect(b.className).toMatch(/\bpointer-events-auto\b/);
  });
});
