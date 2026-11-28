/**
 * UN 57014 DA CARICO NON SPEGNE IL PREZZO PAGATO PER CINQUE MINUTI.
 *
 * Se il database supera il tempo su TUTTE le letture (carico), la colpa non è di `prezzo_pagato`:
 * anche la lettura sul prezzo pieno cade, e passato il carico la griglia deve tornare subito a
 * ordinare sul prezzo che si paga. Un 57014 che cade solo guardando `prezzo_pagato` lo spegne
 * ancora per cinque minuti, come prima. Orologio finto.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { NEGOZIO, fintoPrezzoPagato, prodotto, type StatoFinto } from './aiuti/riparazione-r12-finto-prezzo-pagato';

const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [prodotto('otto', 8), prodotto('nove-e-99', 9.99), prodotto('dieci', 10), prodotto('dodici-al-25', 12)],
};
const SCONTI = { 'dodici-al-25': 25 };
const TEMPO_SCADUTO = { code: '57014', message: 'canceling statement due to statement timeout' };
const SUL_PAGATO = ['otto', 'dodici-al-25', 'nove-e-99', 'dieci'];
const SUL_PIENO = ['otto', 'nove-e-99', 'dieci', 'dodici-al-25'];
const ids = (righe: Array<{ id: string }>) => righe.map((r) => r.id);
const ordinePrezzo = { sort: 'price_asc' as const, tetto: 10 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('il 57014 da carico', () => {
  it('la lista: passato il carico, si torna subito al prezzo pagato', async () => {
    let carico = false;
    const stato: StatoFinto = { conColonna: true, guasto: () => (carico ? TEMPO_SCADUTO : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PAGATO);

    carico = true;
    await expect(leggiProdottiDellaGriglia(db.client, ordinePrezzo)).rejects.toBeTruthy();

    carico = false;
    vi.setSystemTime(new Date('2026-11-27T10:01:00Z'));
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PAGATO);
  });

  it('il conteggio: un conto caduto per carico non spegne il prezzo pagato alla lista', async () => {
    let carico = false;
    const stato: StatoFinto = { conColonna: true, guasto: () => (carico ? TEMPO_SCADUTO : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PAGATO);

    carico = true;
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 10 })).toBeNull();

    carico = false;
    vi.setSystemTime(new Date('2026-11-27T10:01:00Z'));
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PAGATO);
  });
});

describe('il 57014 di prezzo_pagato resta come prima', () => {
  it('cade solo guardando prezzo_pagato: prezzo pieno per cinque minuti, poi si riprova', async () => {
    let lento = false;
    const stato: StatoFinto = { conColonna: true, guasto: (d) => (lento && d.prezzoPagato ? TEMPO_SCADUTO : null) };
    const db = fintoPrezzoPagato(TABELLE, SCONTI, stato);
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PAGATO);

    lento = true;
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PIENO);

    lento = false;
    vi.setSystemTime(new Date('2026-11-27T10:01:00Z'));
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PIENO);
    vi.setSystemTime(new Date('2026-11-27T10:06:00Z'));
    expect(ids(await leggiProdottiDellaGriglia(db.client, ordinePrezzo))).toEqual(SUL_PAGATO);
  });
});
