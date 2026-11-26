/**
 * R10-004 R10-005 — «PREZZO MINIMO» E «PREZZO CRESCENTE» GUARDAVANO IL PREZZO PIENO.
 *
 * Un prodotto da 12 € al -25% costa 9 € alla cassa e la griglia mostra 9 €. Ma l'ordine per prezzo
 * lo metteva dopo quello da 9,99 €, e con «minimo 10 €» restava nell'elenco. Lo sconto sta nelle
 * promozioni attive (non su `products`): lo calcola il database (colonna `prezzo_pagato`, migrazione
 * 960) e la lettura ordina e taglia su quella. Il finto PostgREST porta la colonna come la darebbe
 * il database; le date delle promozioni si provano in tests/sql/rls/riparazione-r10-prezzo-pagato.test.sql.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const NEGOZIO = { id: '22222222-2222-2222-2222-000000000001', store_name: 'Forno', store_hours: null, is_approved: true };

const riga = (id: string, price: number, prezzo_pagato: number) => ({
  id, name: id, price, prezzo_pagato, compare_at_price: null, images: [], stock: 3, has_variants: false,
  category_id: null, status: 'available', seller_id: NEGOZIO.id, created_at: '2026-11-20T10:00:00Z',
});

function catalogo(): Tabelle {
  return {
    seller_public_profiles: [NEGOZIO],
    products: [
      riga('dodici-al-25', 12, 9),
      riga('dieci', 10, 10),
      riga('nove-e-99', 9.99, 9.99),
      riga('venti', 20, 20),
    ],
  };
}

const cliente = () => fintoDb(catalogo()).client as unknown as SupabaseClient;

describe('R10-004 R10-005 · l ordine per prezzo è sul prezzo che si paga', () => {
  it('crescente: il 12 € scontato a 9 € passa davanti al 9,99 €', async () => {
    const righe = await leggiProdottiDellaGriglia(cliente(), { sort: 'price_asc', tetto: 10 });
    expect(righe.map((r) => r.id)).toEqual(['dodici-al-25', 'nove-e-99', 'dieci', 'venti']);
  });

  it('decrescente: l ordine inverso', async () => {
    const righe = await leggiProdottiDellaGriglia(cliente(), { sort: 'price_desc', tetto: 10 });
    expect(righe.map((r) => r.id)).toEqual(['venti', 'dieci', 'nove-e-99', 'dodici-al-25']);
  });

  it('l ordine regge fra le pagine (finestra di due righe)', async () => {
    const c = cliente();
    const p1 = await leggiProdottiDellaGriglia(c, { sort: 'price_asc', tetto: 2, finestra: [0, 1] });
    const p2 = await leggiProdottiDellaGriglia(c, { sort: 'price_asc', tetto: 2, finestra: [2, 3] });
    expect([...p1, ...p2].map((r) => r.id)).toEqual(['dodici-al-25', 'nove-e-99', 'dieci', 'venti']);
  });

  it('con «Sotto i 10 €» il prodotto da 12 € a 9 € resta primo', async () => {
    const righe = await leggiProdottiDellaGriglia(cliente(), {
      sort: 'price_asc', tetto: 10, maxPrice: 10, idsScontatiSotto: ['dodici-al-25'],
    });
    expect(righe.map((r) => r.id)[0]).toBe('dodici-al-25');
  });
});
