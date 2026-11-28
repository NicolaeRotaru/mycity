/**
 * LO SCORRIMENTO INFINITO NON MESCOLA DUE ORDINI QUANDO LA RISPOSTA SU `prezzo_pagato` CAMBIA.
 *
 * Prezzo crescente, due per pagina. Sul prezzo pieno: otto, nove-e-99 | dieci, dodici-al-25.
 * Sul prezzo pagato (12 € al -25% = 9 €): otto, dodici-al-25 | nove-e-99, dieci.
 * Se la prima pagina è sul pieno e la seconda sul pagato, nove-e-99 esce due volte e il 12 € mai.
 * Orologio finto: la sonda senza colonna si richiede dopo cinque minuti.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { leggiProdottiDellaGriglia, type DomandaGriglia } from '@/lib/queries/griglia-prodotti';
import { NEGOZIO, fintoPrezzoPagato, prodotto, type StatoFinto } from './aiuti/riparazione-r12-finto-prezzo-pagato';

const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [prodotto('otto', 8), prodotto('nove-e-99', 9.99), prodotto('dieci', 10), prodotto('dodici-al-25', 12)],
};
const SCONTI = { 'dodici-al-25': 25 };
const pagina = (da: number): DomandaGriglia => ({ sort: 'price_asc', tetto: 2, finestra: [da, da + 1] });
const ids = (righe: Array<{ id: string }>) => righe.map((r) => r.id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('le pagine dopo la prima leggono come la prima', () => {
  it('la 911 applicata a pagina aperta, oltre i cinque minuti: la pagina 2 continua sul prezzo pieno', async () => {
    const stato: StatoFinto = { conColonna: false };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    const prima = await leggiProdottiDellaGriglia(db.client, pagina(0));
    expect(ids(prima)).toEqual(['otto', 'nove-e-99']);

    stato.conColonna = true;
    vi.setSystemTime(new Date('2026-11-27T10:06:00Z'));
    const seconda = await leggiProdottiDellaGriglia(db.client, pagina(2));
    expect(ids(seconda)).toEqual(['dieci', 'dodici-al-25']);

    // Un nuovo scorrimento (la prima pagina riletta) passa al prezzo pagato, e le pagine dopo con lui.
    expect(ids(await leggiProdottiDellaGriglia(db.client, pagina(0)))).toEqual(['otto', 'dodici-al-25']);
    expect(ids(await leggiProdottiDellaGriglia(db.client, pagina(2)))).toEqual(['nove-e-99', 'dieci']);
  });

  it('la sonda caduta per rete alla prima pagina: la seconda non passa al prezzo pagato', async () => {
    let chiamate = 0;
    const stato: StatoFinto = { conColonna: true, guasto: () => (chiamate++ === 0 ? { message: 'TypeError: Failed to fetch' } : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    const prima = await leggiProdottiDellaGriglia(db.client, pagina(0));
    expect(ids(prima)).toEqual(['otto', 'nove-e-99']);
    const seconda = await leggiProdottiDellaGriglia(db.client, pagina(2));
    expect(new Set([...ids(prima), ...ids(seconda)]).size).toBe(4);
  });
});
