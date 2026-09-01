/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R167) — «AGGIUNTO AL CARRELLO» DICHIARAVA I PEZZI CHIESTI, NON
 * QUELLI ENTRATI.
 *
 * C'e' un tetto di pezzi per articolo. Quando scatta, quello che finisce nel
 * carrello e' meno di quello che e' stato chiesto — ma l'evento partiva col
 * numero chiesto. Su GA4 il valore dell'evento e' prezzo x quantita', quindi
 * risultava gonfiato anche l'importo: il valore del carrello nei conti era piu'
 * alto di quello vero, e l'imbuto «aggiunto al carrello → acquisto» sembrava
 * peggiore di com'e'. E' il tipo di errore che non si scopre mai, perche' un
 * numero c'e'.
 *
 * Venti righe piu' sotto, `updateQuantity` faceva gia' la cosa giusta: mandava
 * la differenza reale. Due comportamenti diversi nello stesso file.
 */

const trackAddToCart = vi.fn();
const trackRemoveFromCart = vi.fn();
vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: (...a: unknown[]) => trackAddToCart(...a),
  trackRemoveFromCart: (...a: unknown[]) => trackRemoveFromCart(...a),
}));
vi.mock('@/lib/cart-sync', () => ({ syncAbandonedCart: vi.fn() }));

const RIGA = {
  id: 'p1',
  name: 'Focaccia',
  price: 4.5,
  sellerId: 's1',
  storeName: 'Pane Quotidiano',
  image: undefined,
};

/** L'evento parte da un import dinamico: si aspetta il giro di microtask. */
const lascialoPartire = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  trackAddToCart.mockClear();
  trackRemoveFromCart.mockClear();
});

describe('quanti pezzi dice di aver aggiunto il carrello', () => {
  it('senza tetto di mezzo, dice quelli chiesti', async () => {
    const { addToCart, MAX_PEZZI_PER_ARTICOLO } = await import('@/lib/cart');
    expect(MAX_PEZZI_PER_ARTICOLO).toBeGreaterThan(3);

    addToCart({ ...RIGA, quantity: 3 });
    await lascialoPartire();

    expect(trackAddToCart).toHaveBeenCalledTimes(1);
    expect(trackAddToCart.mock.calls[0][1]).toBe(3);
  });

  it('quando scatta il tetto dice quelli entrati davvero', async () => {
    const { addToCart, getCart, MAX_PEZZI_PER_ARTICOLO } = await import('@/lib/cart');

    addToCart({ ...RIGA, quantity: MAX_PEZZI_PER_ARTICOLO + 40 });
    await lascialoPartire();

    expect(getCart()[0].quantity).toBe(MAX_PEZZI_PER_ARTICOLO);
    expect(
      trackAddToCart.mock.calls[0][1],
      'nei conti sono entrati piu pezzi di quanti ne stia comprando davvero qualcuno',
    ).toBe(MAX_PEZZI_PER_ARTICOLO);
  });

  it('su una riga che c e gia, conta solo lo spazio rimasto', async () => {
    const { addToCart, getCart, MAX_PEZZI_PER_ARTICOLO } = await import('@/lib/cart');

    addToCart({ ...RIGA, quantity: MAX_PEZZI_PER_ARTICOLO - 2 });
    await lascialoPartire();
    trackAddToCart.mockClear();

    // Ne chiede cinque, ma nel carrello ce ne stanno ancora due.
    addToCart({ ...RIGA, quantity: 5 });
    await lascialoPartire();

    expect(getCart()[0].quantity).toBe(MAX_PEZZI_PER_ARTICOLO);
    expect(
      trackAddToCart.mock.calls[0][1],
      'ne ha dichiarati cinque mentre nel carrello ne sono entrati due',
    ).toBe(2);
  });

  it('se il carrello e gia al tetto non parte nessun evento: non e entrato niente', async () => {
    const { addToCart, MAX_PEZZI_PER_ARTICOLO } = await import('@/lib/cart');

    addToCart({ ...RIGA, quantity: MAX_PEZZI_PER_ARTICOLO });
    await lascialoPartire();
    trackAddToCart.mockClear();

    addToCart({ ...RIGA, quantity: 3 });
    await lascialoPartire();

    expect(trackAddToCart, 'un aggiunta da zero pezzi e finita nei conti').not.toHaveBeenCalled();
  });
});
