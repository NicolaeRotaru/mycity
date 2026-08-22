/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 22/8/2026 — «AGGIUNGI AL CARRELLO» POTEVA NON FARE NIENTE, IN SILENZIO.
 *
 * `localStorage.setItem` non è una scrittura che riesce sempre: lancia se lo
 * spazio del browser è pieno, e in navigazione privata su alcuni browser lancia
 * comunque. Non era protetta, quindi l'eccezione risaliva fino a chi aveva
 * premuto il pulsante: nessun prodotto aggiunto, nessun messaggio, niente.
 */

vi.mock('@/lib/analytics/events', () => ({
  trackAddToCart: vi.fn(),
  trackRemoveFromCart: vi.fn(),
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

describe('il carrello non fallisce in silenzio', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('quando lo spazio è pieno, aggiungere NON lancia in faccia a chi ha premuto', async () => {
    const { addToCart } = await import('@/lib/cart');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => addToCart(RIGA)).not.toThrow();
  });

  it('e lo dice: parte un avviso che la pagina può mostrare', async () => {
    const { saveCart } = await import('@/lib/cart');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    const visto: string[] = [];
    const ascolta = (e: Event) => {
      visto.push((e as CustomEvent<{ motivo?: string }>).detail?.motivo ?? '');
    };
    window.addEventListener('cart:non-salvato', ascolta);

    const esito = saveCart([{ ...RIGA, quantity: 1 }]);

    window.removeEventListener('cart:non-salvato', ascolta);
    expect(esito.salvato).toBe(false);
    expect(esito.motivo).toMatch(/non riesce a salvare/i);
    expect(visto).toHaveLength(1);
    expect(visto[0]).toMatch(/navigazione privata|libera spazio/i);
  });

  it('quando va bene, l’esito lo dice e non avvisa nessuno', async () => {
    const { saveCart } = await import('@/lib/cart');
    const visto: Event[] = [];
    const ascolta = (e: Event) => visto.push(e);
    window.addEventListener('cart:non-salvato', ascolta);

    const esito = saveCart([{ ...RIGA, quantity: 1 }]);

    window.removeEventListener('cart:non-salvato', ascolta);
    expect(esito.salvato).toBe(true);
    expect(visto).toHaveLength(0);
  });

  it('se sotto la chiave c’è qualcosa che non è un elenco, il carrello è vuoto e non esplode', async () => {
    // Può succedere per un salvataggio a metà, o per un'altra scheda che ha
    // scritto sotto la stessa chiave. Prima usciva così com'era, e il primo
    // `.map()` esplodeva in faccia alla persona.
    localStorage.setItem('cart', '{"non":"un elenco"}');
    const { getCart } = await import('@/lib/cart');
    expect(getCart()).toEqual([]);
  });

  it('e nemmeno con del testo che non è JSON', async () => {
    localStorage.setItem('cart', 'roba a caso');
    const { getCart } = await import('@/lib/cart');
    expect(getCart()).toEqual([]);
  });
});
