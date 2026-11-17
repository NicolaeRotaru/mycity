// @vitest-environment jsdom
/**
 * R02-002 — La pagina Promozioni disegna le schede da sola (non con ProductGrid) e saltava
 * dall'h1 della testata all'h3 del nome di ogni prodotto: il lettore di schermo perdeva un
 * livello. Qui si monta la pagina vera con due promozioni e si guarda l'ordine dei titoli.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;
const PROMO = [
  { product_id: 'p1', name: 'Focaccia', price: 10, images: [], seller_id: 's1', stock: 5, has_variants: false, store_name: 'Pane Quotidiano', discount_percent: 20 },
  { product_id: 'p2', name: 'Grissini', price: 4, images: [], seller_id: 's1', stock: 9, has_variants: false, store_name: 'Pane Quotidiano', discount_percent: 10 },
];

afterEach(() => { globali.__DATI_QUERY__ = undefined; });

describe('R02-002 · la pagina Promozioni non salta dall h1 all h3', () => {
  it('fra l h1 della testata e gli h3 delle schede c è un h2, senza salti di livello', async () => {
    (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    // Le promozioni a chi le chiede; agli altri (i preferiti delle schede) niente.
    globali.__DATI_QUERY__ = (o: { queryKey: unknown[] }) =>
      o.queryKey[0] === 'promotions' && o.queryKey[1] === 'active' ? PROMO : undefined;
    const mod = await monta('app/promozioni/page.tsx');
    const s = accendi(mod.default);
    await attendi();

    const livelli = Array.from(s.radice.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((e) => Number(e.tagName[1]));
    // Le due schede ci sono davvero, ognuna col suo h3.
    expect(livelli.filter((l) => l === 3).length).toBeGreaterThanOrEqual(2);
    expect(livelli[0]).toBe(1);
    // Il primo titolo dopo l'h1 è un h2, e il primo h3 viene dopo un h2.
    expect(livelli[1]).toBe(2);
    // Nessun salto: ogni titolo scende al massimo di un livello rispetto al precedente.
    livelli.forEach((l, i) => {
      if (i > 0) expect(l - livelli[i - 1], `salto da h${livelli[i - 1]} a h${l}`).toBeLessThanOrEqual(1);
    });
    s.smonta();
  }, 60000);
});
