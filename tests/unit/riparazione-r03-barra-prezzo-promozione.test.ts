/**
 * @vitest-environment jsdom
 */
/**
 * R03-012 — Con una promozione attiva la scheda prodotto mostra in grande il prezzo scontato e,
 * accanto, il pieno barrato (app/product/[id]/page.tsx). La barra d'acquisto in fondo allo schermo
 * riceve già il prezzo scontato, ma del pieno non sapeva niente: chi scorreva leggeva sotto un
 * prezzo «nudo», diverso da quello di sopra. La barra montata davvero, col prezzo calcolato come
 * lo calcolano la scheda e la cassa (`discountedUnitCents`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import StickyAddToCart from '@/components/StickyAddToCart';
import { discountedUnitCents } from '@/lib/promotions';
import { formatPrice } from '@/lib/format';
import { accendi } from './aiuti/schermo';

let schermo: ReturnType<typeof accendi> | null = null;
afterEach(() => {
  schermo?.smonta();
  schermo = null;
});

function barra(proprieta: Record<string, unknown>) {
  // Senza bersaglio la barra compare dopo mezzo schermo di scorrimento.
  Object.defineProperty(window, 'scrollY', { value: 2000, writable: true, configurable: true });
  schermo = accendi(StickyAddToCart, { available: true, onAdd: () => {}, ...proprieta });
  return schermo.radice;
}

/** Il testo degli elementi barrati della barra. */
const barrati = (radice: HTMLElement) =>
  [...radice.querySelectorAll('.line-through, s, del')].map((el) => (el.textContent ?? '').trim());

const PIENO = 19.99;
const SCONTO = 15;
// 19,99 € col 15%: 16,9915 → 16,99 €, al centesimo come la cassa.
const SCONTATO = discountedUnitCents(PIENO, SCONTO) / 100;

describe('R03-012 — la barra d’acquisto dice lo stesso prezzo della scheda, con la promozione', () => {
  it('con lo stepper: prezzo scontato per pezzo, totale scontato, e il pieno barrato accanto', () => {
    const r = barra({ price: SCONTATO, prezzoPieno: PIENO, qty: 2, onDec: () => {}, onInc: () => {} });
    const testo = r.textContent ?? '';
    expect(SCONTATO).toBe(16.99);
    expect(testo).toContain(`2 × ${formatPrice(16.99)}`);
    expect(testo).toContain(formatPrice(33.98));
    expect(barrati(r), 'il prezzo pieno barrato della scheda manca nella barra').toEqual([`Prezzo pieno ${formatPrice(PIENO)}`]);
  });

  it('senza stepper: il prezzo scontato e il pieno barrato', () => {
    const r = barra({ price: SCONTATO, prezzoPieno: PIENO });
    expect(r.textContent ?? '').toContain(formatPrice(16.99));
    expect(barrati(r)).toEqual([`Prezzo pieno ${formatPrice(PIENO)}`]);
  });

  it('senza promozione (pieno uguale al prezzo) non si barra niente', () => {
    const r = barra({ price: PIENO, prezzoPieno: PIENO, qty: 1, onDec: () => {}, onInc: () => {} });
    expect(r.textContent ?? '').toContain(formatPrice(PIENO));
    expect(barrati(r)).toEqual([]);
  });
});
