// @vitest-environment jsdom
/**
 * R01-011 — La scheda delle griglie calcolava lo scontato con una formula sua, senza arrotondare al
 * centesimo: 1,15 € al -10% scriveva 1,04 € mentre carrello e cassa (`discountedUnitCents`) fanno
 * pagare 1,03 €, e al carrello arrivava 1,035. Qui la scheda vera, montata: prezzo scritto e prezzo
 * passato al carrello devono essere quelli della cassa.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { accendi, clicca } from './aiuti/schermo';
import { discountedUnitCents } from '@/lib/promotions';
import { formatPrice } from '@/lib/format';

const carrello = vi.hoisted(() => ({ righe: [] as Array<{ price: number }> }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({ default: (p: { alt?: string }) => createElement('img', { alt: p.alt ?? '' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...r }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement('a', { href, ...r }, children),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cart', () => ({ addToCart: (r: { price: number }) => { carrello.righe.push(r); } }));
vi.mock('@/components/hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: new Set<string>(), lettoDavvero: true, toggle: { mutate: vi.fn() } }),
}));
vi.mock('@/components/hooks/useProfile', () => ({ useProfile: () => ({ isSeller: false, isAdmin: false }) }));
vi.mock('@/components/hooks/useShoppingMode', () => ({ useShoppingMode: () => true, useCanPurchase: () => true }));

import ProductCard from '@/components/ProductCard';

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
  carrello.righe = [];
});

function monta(price: number, discountPercent: number) {
  schermo = accendi(ProductCard, {
    id: 'p1', name: 'Grissini', price, images: ['https://x/y.jpg'], stock: 9, storeName: 'Forno Rossi', discountPercent,
  });
  return schermo.radice;
}

const piu = (radice: HTMLElement) => radice.querySelector('button[aria-label^="Aggiungi Grissini"]') as HTMLElement;

describe('R01-011 · la scheda delle griglie sconta come carrello e cassa', () => {
  it('1,15 € al -10%: la scheda scrive 1,03 € (la cassa), non 1,04 €', () => {
    const cassa = discountedUnitCents(1.15, 10) / 100;
    expect(cassa).toBe(1.03);
    const radice = monta(1.15, 10);
    expect(radice.textContent).toContain(formatPrice(1.03));
    expect(radice.textContent).not.toContain(formatPrice(1.04));
  });

  it('al carrello arriva il prezzo al centesimo della cassa', async () => {
    const radice = monta(1.15, 10);
    await act(async () => { clicca(piu(radice)); });
    expect(carrello.righe.at(-1)?.price).toBe(discountedUnitCents(1.15, 10) / 100);
  });

  it('uno sconto oltre il 70% vale 70%, come in cassa', async () => {
    const radice = monta(10, 90);
    expect(radice.textContent).toContain(formatPrice(3));
    await act(async () => { clicca(piu(radice)); });
    expect(carrello.righe.at(-1)?.price).toBe(3);
  });

  it('senza sconto resta il prezzo pieno', async () => {
    const radice = monta(4.5, 0);
    expect(radice.textContent).toContain(formatPrice(4.5));
    await act(async () => { clicca(piu(radice)); });
    expect(carrello.righe.at(-1)?.price).toBe(4.5);
  });
});
