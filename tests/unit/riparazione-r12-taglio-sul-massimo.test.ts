/**
 * «SOTTO I 10 €» E LO SLIDER DEL MASSIMO: IL TAGLIO SUL MASSIMO SI CONTROLLA DAVVERO.
 *
 * Il finto comune (`aiuti/finto-postgrest.ts`) tratta ogni `or` come il filtro sulla giacenza:
 * l'`or` del massimo senza la migrazione 911 (`price.lte.10,id.in.(…)`) non lo guarda nessuno.
 * Qui il finto valuta l'`or` condizione per condizione: un prodotto da 20 € e uno da 15 € al -10%
 * (13,50 €) restano fuori, quello da 12 € al -25% (9 €) entra, con e senza la 911.
 */
import { describe, it, expect } from 'vitest';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { NEGOZIO, fintoPrezzoPagato, prodotto } from './aiuti/riparazione-r12-finto-prezzo-pagato';

const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [
    prodotto('nove', 9), prodotto('dieci', 10), prodotto('dodici-al-25', 12),
    prodotto('quindici-al-10', 15), prodotto('venti', 20),
  ],
};
const SCONTI = { 'dodici-al-25': 25, 'quindici-al-10': 10 };
const DENTRO = ['dieci', 'dodici-al-25', 'nove'];

describe('il massimo taglia sul prezzo che si paga', () => {
  for (const conColonna of [false, true]) {
    const come = conColonna ? 'con la 911 (prezzo_pagato)' : 'senza la 911 (prezzo pieno + id scontati)';
    it(`${come}: fuori chi supera 10 € anche scontato, dentro chi ci scende in promozione`, async () => {
      const db = fintoPrezzoPagato(TABELLE, SCONTI, { conColonna });
      const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, maxPrice: 10 });
      expect(righe.map((r) => r.id).sort()).toEqual(DENTRO);
    });

    it(`${come}: il numero sopra la griglia conta gli stessi`, async () => {
      const db = fintoPrezzoPagato(TABELLE, SCONTI, { conColonna });
      expect(await contaProdottiDellaGriglia(db.client, { maxPrice: 10 })).toBe(DENTRO.length);
    });
  }
});
