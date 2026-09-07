/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — TOGLIERE DAL CARRELLO UN PRODOTTO CON PIÙ VARIANTI MANDAVA A
 * GOOGLE IL PREZZO DELLA PRIMA RIGA PER TUTTE.
 *
 * `removeFromCart(id)` senza variante toglie TUTTE le righe di quel prodotto —
 * la maglietta taglia M e la taglia L insieme. L'evento però era uno solo: la
 * quantità era la somma di tutte le righe, il prezzo quello della PRIMA riga
 * tolta. Con 3 pezzi da 4 € e 2 pezzi da 6 €, a Google arrivavano 5 × 4 = 20 €
 * invece dei 24 € che erano davvero nel carrello.
 *
 * È il tipo di errore che non si scopre mai, perché un numero c'è: il valore
 * netto del carrello su GA4 semplicemente non torna, e nessuno sa di quanto.
 *
 * Qui il carrello viene riempito davvero e si guarda cosa esce dalla porta.
 */

const trackAddToCart = vi.fn();
const trackRemoveFromCart = vi.fn();
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: (...a: unknown[]) => trackAddToCart(...a),
  trackRemoveFromCart: (...a: unknown[]) => trackRemoveFromCart(...a),
}));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: vi.fn() }));

const BASE = {
  id: 'maglietta',
  name: 'Maglietta',
  sellerId: 's1',
  storeName: 'Pane Quotidiano',
  image: undefined,
};

/** L'evento parte da un import dinamico: si aspetta il giro di microtask. */
const lascialoPartire = () => new Promise((r) => setTimeout(r, 0));

/** Quanti euro dice di aver tolto, sommando tutti gli eventi usciti. */
function euroTolti(): number {
  return trackRemoveFromCart.mock.calls.reduce((somma, [, quantita, centesimi]) => {
    return somma + (Number(quantita) * Number(centesimi)) / 100;
  }, 0);
}

beforeEach(() => {
  localStorage.clear();
  trackAddToCart.mockClear();
  trackRemoveFromCart.mockClear();
});

describe('quanto dice di aver tolto il carrello', () => {
  it('due varianti a prezzo diverso: esce il valore vero, non quello della prima riga', async () => {
    const { addToCart, removeFromCart } = await import('@/lib/cart');

    // 3 pezzi da 4 € (taglia M) + 2 pezzi da 6 € (taglia L) = 24 € nel carrello.
    addToCart({ ...BASE, price: 4, quantity: 3, variantId: 'M', variantLabel: 'M' });
    addToCart({ ...BASE, price: 6, quantity: 2, variantId: 'L', variantLabel: 'L' });
    await lascialoPartire();

    removeFromCart('maglietta');
    await lascialoPartire();

    expect(
      euroTolti(),
      'a Google arriva il prezzo della prima riga per tutte: 5 × 4 € invece di 3 × 4 € + 2 × 6 €',
    ).toBe(24);
  });

  it('ogni riga tolta manda il suo, con la sua quantità e il suo prezzo', async () => {
    const { addToCart, removeFromCart } = await import('@/lib/cart');

    addToCart({ ...BASE, price: 4, quantity: 3, variantId: 'M', variantLabel: 'M' });
    addToCart({ ...BASE, price: 6, quantity: 2, variantId: 'L', variantLabel: 'L' });
    await lascialoPartire();

    removeFromCart('maglietta');
    await lascialoPartire();

    expect(trackRemoveFromCart, 'due righe tolte, un evento solo').toHaveBeenCalledTimes(2);
    const coppie = trackRemoveFromCart.mock.calls
      .map(([, quantita, centesimi]) => `${quantita}x${centesimi}`)
      .sort();
    expect(coppie).toEqual(['2x600', '3x400']);
  });

  it('una riga sola resta un evento solo, come prima', async () => {
    const { addToCart, removeFromCart } = await import('@/lib/cart');

    addToCart({ ...BASE, price: 4, quantity: 3, variantId: 'M', variantLabel: 'M' });
    addToCart({ ...BASE, price: 6, quantity: 2, variantId: 'L', variantLabel: 'L' });
    await lascialoPartire();

    removeFromCart('maglietta', 'L');
    await lascialoPartire();

    expect(trackRemoveFromCart).toHaveBeenCalledTimes(1);
    expect(euroTolti()).toBe(12);
  });

  it('togliere qualcosa che non cè non manda niente', async () => {
    const { addToCart, removeFromCart } = await import('@/lib/cart');

    addToCart({ ...BASE, price: 4, quantity: 3, variantId: 'M', variantLabel: 'M' });
    await lascialoPartire();
    trackRemoveFromCart.mockClear();

    removeFromCart('un-prodotto-mai-messo-dentro');
    await lascialoPartire();

    expect(trackRemoveFromCart).not.toHaveBeenCalled();
  });
});
