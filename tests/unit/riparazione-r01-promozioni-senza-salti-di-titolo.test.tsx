// @vitest-environment jsdom
/**
 * R01-002 — La pagina Promozioni saltava ancora dall'h1 all'h3 in tre stati su quattro: aveva
 * l'h2 nascosto solo sopra le schede delle promozioni lette dalla funzione del database. Con zero
 * promozioni (o con la lettura caduta) passa a ProductGrid, che sotto l'h1 metteva subito l'h3
 * «Nessuna promozione attiva al momento», oppure le schede col prezzo barrato senza un h2 sopra.
 *
 * Qui si monta la pagina vera nei quattro stati e si guarda la scala dei titoli: dopo l'h1 viene
 * un h2, e nessun titolo scende di più di un livello rispetto a quello prima.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { monta } from './aiuti/monta-componente';
import { accendi, attendi } from './aiuti/schermo';

const globali = globalThis as Record<string, unknown>;

const PROMO = [
  { product_id: 'p1', name: 'Focaccia', price: 10, images: [], seller_id: 's1', stock: 5, has_variants: false, store_name: 'Pane Quotidiano', discount_percent: 20 },
];
/** Un prodotto col solo prezzo barrato: lo mostra ProductGrid quando le promozioni sono zero. */
const BARRATI = [
  { id: 'b1', name: 'Grissini', price: 3, compare_at_price: 4, images: [], stock: 9, has_variants: false, created_at: '2026-11-01T10:00:00Z', seller_id: 's1', category_id: null, profiles: { store_name: 'Pane Quotidiano' } },
];

type Chiave = { queryKey: unknown[] };
const promoDellaPagina = (o: Chiave) => o.queryKey[0] === 'promotions' && o.queryKey[1] === 'active' && o.queryKey.length === 2;
const idsDellePromo = (o: Chiave) => o.queryKey[0] === 'promotions' && o.queryKey[1] === 'active' && o.queryKey[2] === 'ids';
const prodottiDellaGriglia = (o: Chiave) =>
  o.queryKey[0] === 'products' && typeof o.queryKey[1] === 'object' && o.queryKey[1] !== null;

function dati(promo: unknown[], griglia: unknown[]) {
  return (o: Chiave) => {
    if (promoDellaPagina(o)) return promo;
    if (idsDellePromo(o)) return new Set<string>();
    if (prodottiDellaGriglia(o)) return griglia;
    return undefined;
  };
}

async function scalaDeiTitoli(): Promise<{ livelli: number[]; testi: string[] }> {
  const mod = await monta('app/promozioni/page.tsx');
  const s = accendi(mod.default as never);
  await attendi();
  const titoli = Array.from(s.radice.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const esito = {
    livelli: titoli.map((e) => Number(e.tagName[1])),
    testi: titoli.map((e) => (e.textContent ?? '').trim()),
  };
  s.smonta();
  return esito;
}

function senzaSalti(livelli: number[]) {
  expect(livelli[0]).toBe(1);
  expect(livelli[1], `dopo l'h1 viene h${livelli[1]}`).toBe(2);
  livelli.forEach((l, i) => {
    if (i > 0) expect(l - livelli[i - 1], `salto da h${livelli[i - 1]} a h${l}`).toBeLessThanOrEqual(1);
  });
}

beforeAll(() => {
  globali.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
});

afterEach(() => {
  globali.__DATI_QUERY__ = undefined;
  globali.__ESITO_QUERY__ = undefined;
});

describe('R01-002 · la pagina Promozioni scende di un livello alla volta in tutti gli stati', () => {
  it('nessuna promozione attiva: fra l h1 e l h3 «Nessuna promozione attiva al momento» c è un h2', async () => {
    globali.__DATI_QUERY__ = dati([], []);
    const { livelli, testi } = await scalaDeiTitoli();
    // Lo stato vuoto c'è davvero, col suo h3.
    expect(testi).toContain('Nessuna promozione attiva al momento');
    expect(livelli[testi.indexOf('Nessuna promozione attiva al momento')]).toBe(3);
    senzaSalti(livelli);
  }, 60000);

  it('lettura delle promozioni caduta: la pagina ripiega su ProductGrid senza saltare un livello', async () => {
    globali.__DATI_QUERY__ = dati([], []);
    globali.__ESITO_QUERY__ = (o: Chiave) =>
      promoDellaPagina(o) ? { data: undefined, isError: true, isSuccess: false, error: new Error('rete') } : undefined;
    const { livelli, testi } = await scalaDeiTitoli();
    expect(testi).toContain('Nessuna promozione attiva al momento');
    senzaSalti(livelli);
  }, 60000);

  it('zero promozioni ma prodotti col prezzo barrato: le schede di ProductGrid hanno un h2 sopra', async () => {
    globali.__DATI_QUERY__ = dati([], BARRATI);
    const { livelli, testi } = await scalaDeiTitoli();
    // La scheda del prodotto barrato c'è, col suo h3.
    expect(testi).toContain('Grissini');
    expect(livelli[testi.indexOf('Grissini')]).toBe(3);
    senzaSalti(livelli);
  }, 60000);

  it('con le promozioni: resta un solo h2 fra l h1 e le schede', async () => {
    globali.__DATI_QUERY__ = dati(PROMO, []);
    const { livelli, testi } = await scalaDeiTitoli();
    expect(testi).toContain('Focaccia');
    expect(livelli.filter((l) => l === 2)).toHaveLength(1);
    senzaSalti(livelli);
  }, 60000);
});
