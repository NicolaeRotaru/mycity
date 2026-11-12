import { describe, it, expect } from 'vitest';
import { leggiPrezzo } from '@/app/seller/products/import/csv';

/**
 * R03-019 — Nella modifica veloce dei prezzi «1.500» non diventa più 1,50 euro.
 *
 * `leggiPrezzo` trattava il punto come separatore delle migliaia solo se nella stessa stringa
 * c'era anche una virgola: «1.500» passava a Number() e diventava 1.5. La modifica in blocco
 * dell'elenco prodotti (e l'import da file) usano questa funzione: la bici da 1500 € andava in
 * vendita a 1,50 € e il sito diceva «aggiornato».
 */
describe('R03-019 — il punto delle migliaia senza virgola', () => {
  it('«1.500» sono millecinquecento euro, «2.000» duemila, «1.234.567» oltre il milione', () => {
    expect(leggiPrezzo('1.500')).toBe(1500);
    expect(leggiPrezzo('2.000')).toBe(2000);
    expect(leggiPrezzo('12.000 €')).toBe(12000);
    expect(leggiPrezzo('1.234.567')).toBe(1234567);
  });

  it('i decimali col punto restano decimali', () => {
    expect(leggiPrezzo('4.50')).toBe(4.5);
    expect(leggiPrezzo('1.5')).toBe(1.5);
    expect(leggiPrezzo('0.500')).toBe(0.5);
    expect(leggiPrezzo('19.9')).toBe(19.9);
  });

  it('con la virgola come prima: «1.234,50», «4,50», «1.250,00»', () => {
    expect(leggiPrezzo('1.234,50')).toBe(1234.5);
    expect(leggiPrezzo('4,50')).toBe(4.5);
    expect(leggiPrezzo('1.250,00')).toBe(1250);
    expect(leggiPrezzo('abc')).toBeNaN();
  });
});
