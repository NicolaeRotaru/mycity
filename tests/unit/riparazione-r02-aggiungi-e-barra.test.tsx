/**
 * @vitest-environment jsdom
 *
 * R02-016 (12/11/2026) — Sulla scheda prodotto al telefono:
 *  ① la barra d'acquisto compare quando il pulsante «Aggiungi al carrello» della pagina non si vede,
 *    anche appena aperta, senza aspettare mezzo schermo di scorrimento;
 *  ② un doppio tocco su «Aggiungi al carrello» mette un pezzo, non due.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import StickyAddToCart from '@/components/StickyAddToCart';
import { addToCart, getCart } from '@/lib/cart';

let avvisa: ((voci: Array<{ isIntersecting: boolean }>) => void) | null = null;
class FintoOsservatore {
  constructor(cb: (voci: Array<{ isIntersecting: boolean }>) => void) { avvisa = cb; }
  observe() {}
  disconnect() {}
  unobserve() {}
}

describe('R02-016 ① · la barra segue il pulsante d acquisto della pagina', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).IntersectionObserver = FintoOsservatore;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });

  it('appena aperta la pagina, col pulsante sotto la piega, la barra c è; quando il pulsante si vede, sparisce', async () => {
    const pulsante = document.createElement('button');
    pulsante.id = 'acquisto-principale';
    document.body.appendChild(pulsante);
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    await act(async () => {
      root.render(createElement(StickyAddToCart, { bersaglio: 'acquisto-principale', price: 4, available: true, onAdd: () => {} } as never));
    });
    await act(async () => { avvisa?.([{ isIntersecting: false }]); });
    expect(box.querySelector('[aria-label="Acquisto rapido"]'), 'nessuno scorrimento, pulsante non visibile: la barra deve esserci').not.toBeNull();
    await act(async () => { avvisa?.([{ isIntersecting: true }]); });
    expect(box.querySelector('[aria-label="Acquisto rapido"]')).toBeNull();
    act(() => root.unmount());
    pulsante.remove();
  });
});

describe('R02-016 ② · il doppio tocco su «Aggiungi al carrello»', () => {
  it('due tocchi nello stesso istante mettono una riga con quantità 1', async () => {
    localStorage.clear();
    const { creaFrenoDoppioTocco } = await import('@/lib/ui/freno-doppio-tocco');
    const freno = creaFrenoDoppioTocco();
    const tocca = () => {
      if (!freno()) return;
      addToCart({ id: 'p-1', name: 'Pane', price: 3, quantity: 1, sellerId: 's-1' } as never);
    };
    tocca();
    tocca();
    const righe = getCart();
    expect(righe).toHaveLength(1);
    expect(righe[0].quantity).toBe(1);
  });

  it('la scheda prodotto frena handleAdd prima di addToCart, e la barra le passa il suo pulsante', () => {
    const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
    const handleAdd = src.slice(src.indexOf('const handleAdd = () => {'), src.indexOf('const handleBuyNow'));
    expect(handleAdd.indexOf('frenoAggiunta.current()')).toBeGreaterThan(-1);
    expect(handleAdd.indexOf('frenoAggiunta.current()')).toBeLessThan(handleAdd.indexOf('addToCart('));
    expect(src).toMatch(/<StickyAddToCart[^>]*bersaglio="acquisto-principale"/);
    expect(src).toMatch(/id="acquisto-principale"/);
  });
});
