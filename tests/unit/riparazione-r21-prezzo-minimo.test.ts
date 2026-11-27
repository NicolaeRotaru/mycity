/**
 * R21-003 — IL FILTRO «PREZZO MINIMO» TAGLIAVA SUL PREZZO PIENO.
 *
 * Con minimo 10 € un prodotto da 12 € al -25% (9 € alla cassa) restava nell'elenco. Il prezzo che
 * si paga lo calcola il database (colonna calcolata della migrazione 911, provata in
 * tests/sql/rls/riparazione-r21-prezzo-pagato.test.sql) e la lettura taglia su quello.
 *
 * Il PostgREST finto qui sotto applica davvero filtri, ordine e finestra. Con la migrazione la
 * colonna c'è (il pieno meno lo sconto, arrotondato come la cassa); senza, ogni domanda che la
 * nomina riceve 42703 come dal PostgREST vero: la griglia NON deve andare in errore, e legge come
 * prima, sul prezzo pieno.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { discountedUnitCents } from '@/lib/promotions';

type Riga = Record<string, unknown>;
const COLONNA = 'prezzo_pagato';

/** Le condizioni di un `or` di PostgREST: virgole fuori dalle parentesi. */
function spezza(espressione: string): string[] {
  const parti: string[] = [];
  let livello = 0;
  let corrente = '';
  for (const c of espressione) {
    if (c === '(') livello += 1;
    if (c === ')') livello -= 1;
    if (c === ',' && livello === 0) { parti.push(corrente); corrente = ''; } else corrente += c;
  }
  if (corrente) parti.push(corrente);
  return parti;
}

function condizione(parte: string): (r: Riga) => boolean {
  const [colonna, ...resto] = parte.split('.');
  const nega = resto[0] === 'not';
  const [op, ...valori] = nega ? resto.slice(1) : resto;
  const valore = valori.join('.');
  let f: (r: Riga) => boolean;
  if (op === 'in') { const elenco = valore.replace(/^\(|\)$/g, '').split(','); f = (r) => elenco.includes(String(r[colonna])); }
  else if (op === 'is') f = (r) => (r[colonna] ?? null) === null;
  else if (op === 'lte') f = (r) => Number(r[colonna]) <= Number(valore);
  else if (op === 'gte') f = (r) => Number(r[colonna]) >= Number(valore);
  else if (op === 'gt') f = (r) => Number(r[colonna]) > Number(valore);
  else throw new Error(`condizione non capita: ${parte}`);
  return nega ? (r) => !f(r) : f;
}

/** Il PostgREST finto: `conColonna` = la migrazione 911 è applicata. */
function finto(tabelle: Record<string, Riga[]>, sconti: Record<string, number>, conColonna: boolean) {
  const nominate: string[] = [];
  class Domanda {
    private filtri: Array<(r: Riga) => boolean> = [];
    private ordini: Array<[string, boolean]> = [];
    private da = 0;
    private a = Infinity;
    private conta = false;
    private nomina = false;
    constructor(private tabella: string) {}
    private segna(testo: string) { if (testo.includes(COLONNA)) this.nomina = true; }
    select(c = '*', o?: { count?: string; head?: boolean }) { this.segna(c); this.conta = !!o?.count; return this; }
    eq(c: string, v: unknown) { this.segna(c); this.filtri.push((r) => r[c] === v); return this; }
    in(c: string, v: unknown[]) { this.segna(c); this.filtri.push((r) => v.includes(r[c])); return this; }
    lte(c: string, v: unknown) { this.segna(c); this.filtri.push((r) => Number(r[c]) <= Number(v)); return this; }
    gte(c: string, v: unknown) { this.segna(c); this.filtri.push((r) => (typeof v === 'number' ? Number(r[c]) >= v : String(r[c]) >= String(v))); return this; }
    ilike(c: string, p: string) { const re = new RegExp(`^${p.replace(/%/g, '.*')}$`, 'i'); this.filtri.push((r) => re.test(String(r[c]))); return this; }
    or(e: string) { this.segna(e); const parti = spezza(e).map(condizione); this.filtri.push((r) => parti.some((f) => f(r))); return this; }
    order(c: string, o?: { ascending?: boolean }) { this.segna(c); this.ordini.push([c, o?.ascending !== false]); return this; }
    range(da: number, a: number) { this.da = da; this.a = a; return this; }
    limit(n: number) { this.a = this.da + n - 1; return this; }
    then<T>(ok: (v: { data: Riga[] | null; error: { code: string; message: string } | null; count?: number }) => T, ko?: (e: unknown) => T) {
      if (this.nomina) nominate.push(this.tabella);
      if (this.nomina && !conColonna) {
        return Promise.resolve({ data: null, error: { code: '42703', message: `column products.${COLONNA} does not exist` } }).then(ok, ko);
      }
      let righe = (tabelle[this.tabella] ?? []).map((r) => (conColonna && this.tabella === 'products'
        ? { ...r, [COLONNA]: discountedUnitCents(r.price as number, sconti[r.id as string] ?? 0) / 100 }
        : r));
      righe = righe.filter((r) => this.filtri.every((f) => f(r)));
      for (const [c, su] of [...this.ordini].reverse()) {
        righe = [...righe].sort((x, y) => {
          const a = x[c] as number | string;
          const b = y[c] as number | string;
          const v = a === b ? 0 : a < b ? -1 : 1;
          return su ? v : -v;
        });
      }
      const totale = righe.length;
      righe = righe.slice(this.da, this.a === Infinity ? undefined : this.a + 1);
      return Promise.resolve({ data: righe, error: null, count: this.conta ? totale : undefined }).then(ok, ko);
    }
  }
  const client = {
    from: (t: string) => new Domanda(t),
    rpc: async () => ({ data: [], error: null }),
  };
  return { client: client as unknown as SupabaseClient, nominate };
}

const NEGOZIO = { id: 'neg-1', store_name: 'Bottega', store_hours: null, is_approved: true };
const prodotto = (id: string, price: number) => ({
  id, name: id, price, compare_at_price: null, images: [], stock: 5, has_variants: false,
  created_at: '2026-11-20T10:00:00Z', seller_id: NEGOZIO.id, category_id: null, status: 'available',
});
const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [prodotto('dodici-al-25', 12), prodotto('dieci', 10), prodotto('nove-e-99', 9.99), prodotto('venti', 20)],
};
// 12 € al -25% = 9 € alla cassa.
const SCONTI = { 'dodici-al-25': 25 };

describe('R21-003 · il prezzo minimo taglia sul prezzo che si paga', () => {
  it('con la migrazione 911: minimo 10 €, il 12 € a 9 € alla cassa non entra', async () => {
    const db = finto(TABELLE, SCONTI, true);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 10 });
    expect(righe.map((r) => r.id).sort()).toEqual(['dieci', 'venti']);
  });

  it('con la migrazione 911: il numero sopra la griglia dice lo stesso', async () => {
    const db = finto(TABELLE, SCONTI, true);
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 10 })).toBe(2);
  });

  it('senza la migrazione la griglia non va in errore: legge come prima, sul prezzo pieno', async () => {
    const db = finto(TABELLE, SCONTI, false);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 10 });
    expect(righe.map((r) => r.id).sort()).toEqual(['dieci', 'dodici-al-25', 'venti']);
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 10 })).toBe(3);
  });

  it('senza la migrazione anche un client che ha già letto riprova la lettura di prima, non resta in errore', async () => {
    const db = finto(TABELLE, SCONTI, false);
    for (let i = 0; i < 3; i++) {
      const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 10 });
      expect(righe).toHaveLength(3);
    }
  });

  it('senza un filtro di prezzo la domanda non nomina mai la colonna nuova', async () => {
    const db = finto(TABELLE, SCONTI, false);
    await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10 });
    expect(db.nominate).toEqual([]);
  });
});
