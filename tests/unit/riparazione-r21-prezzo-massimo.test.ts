/**
 * R21-006 R21-004 — IL PREZZO MASSIMO TAGLIAVA ANCORA SUL PREZZO PIENO.
 *
 * Lo slider del prezzo (ricerca, categoria, vetrina del negozio) passa solo `maxPrice`, senza gli id
 * scontati: con la forchetta 5-10 € un 12 € al -25% (9 €) restava fuori, mentre il minimo guarda già
 * il prezzo pagato. E «Sotto i 10 €» si fidava di un elenco di id in promozione con due tetti (1000
 * righe di `active_promo_products`, 100 id nell'indirizzo): oltre, il filtro era incompleto. Con la
 * migrazione 911 il massimo guarda `prezzo_pagato` (tests/sql/rls/riparazione-r21-prezzo-pagato.test.sql):
 * nessun elenco, nessun tetto. Senza la migrazione la griglia non va in errore e legge come prima.
 *
 * Il PostgREST finto applica davvero filtri (anche l'`or` con gli id), ordine e finestra; senza la
 * migrazione ogni domanda che nomina la colonna nuova riceve 42703, come dal PostgREST vero.
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
  const rpc: string[] = [];
  const conIdNellIndirizzo: number[] = [];
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
    or(e: string) { this.segna(e); if (/id\.in\./.test(e)) conIdNellIndirizzo.push(e.split(',').length); const parti = spezza(e).map(condizione); this.filtri.push((r) => parti.some((f) => f(r))); return this; }
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
    rpc: async (nome: string) => { rpc.push(nome); return { data: [], error: null }; },
  };
  return { client: client as unknown as SupabaseClient, nominate, rpc, conIdNellIndirizzo };
}

const NEGOZIO = { id: 'neg-1', store_name: 'Bottega', store_hours: null, is_approved: true };
const prodotto = (id: string, price: number) => ({
  id, name: id, price, compare_at_price: null, images: [], stock: 5, has_variants: false,
  created_at: '2026-11-20T10:00:00Z', seller_id: NEGOZIO.id, category_id: null, status: 'available',
});
const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [prodotto('dodici-al-25', 12), prodotto('dieci', 10), prodotto('nove-e-99', 9.99), prodotto('venti', 20), prodotto('quattro', 4)],
};
// 12 € al -25% = 9 € alla cassa.
const SCONTI = { 'dodici-al-25': 25 };
const ids = (righe: Array<{ id: string }>) => righe.map((r) => r.id).sort();

describe('R21-006 · con la migrazione 911 lo slider del prezzo massimo guarda il prezzo che si paga', () => {
  it('forchetta 5-10 €: il 12 € a 9 € alla cassa entra, il 20 € e il 4 € no', async () => {
    const db = finto(TABELLE, SCONTI, true);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 5, maxPrice: 10 });
    expect(ids(righe)).toEqual(['dieci', 'dodici-al-25', 'nove-e-99']);
  });

  it('solo il massimo (10 €), ordinando per prezzo: il 12 € a 9 € entra al suo posto', async () => {
    const db = finto(TABELLE, SCONTI, true);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 10, maxPrice: 10 });
    expect(righe.map((r) => r.id)).toEqual(['quattro', 'dodici-al-25', 'nove-e-99', 'dieci']);
  });

  it('il numero sopra la griglia dice lo stesso', async () => {
    const db = finto(TABELLE, SCONTI, true);
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 5, maxPrice: 10 })).toBe(3);
  });
});

describe('R21-004 · con la migrazione 911 «Sotto i 10 €» non si ferma a 1000 righe e 100 id', () => {
  // 150 prodotti da 12 € al -25% (9 €) e 1100 da 30 € al -40% (18 €): più promozioni dei due tetti.
  const scendono = Array.from({ length: 150 }, (_, i) => prodotto(`giu-${String(i).padStart(3, '0')}`, 12));
  const restano = Array.from({ length: 1100 }, (_, i) => prodotto(`su-${String(i).padStart(4, '0')}`, 30));
  const sconti: Record<string, number> = {
    ...Object.fromEntries(scendono.map((p) => [p.id, 25])),
    ...Object.fromEntries(restano.map((p) => [p.id, 40])),
  };
  const tabelle = { seller_public_profiles: [NEGOZIO], products: [...scendono, ...restano, prodotto('nove-e-99', 9.99), prodotto('dieci', 10)] };
  // «Sotto i 10 €», 10 escluso: la soglia che passa ProductGrid.
  const sotto = 10 - 0.005;

  it('entrano tutti i 150 che in promozione costano 9 €, e il 10,00 tondo resta fuori', async () => {
    const db = finto(tabelle, sconti, true);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 500, maxPrice: sotto });
    expect(righe).toHaveLength(151);
    expect(righe.filter((r) => r.id.startsWith('giu-'))).toHaveLength(150);
    expect(righe.map((r) => r.id)).not.toContain('dieci');
    expect(righe.at(-1)?.id).toBe('nove-e-99');
    expect(await contaProdottiDellaGriglia(db.client, { maxPrice: sotto })).toBe(151);
  });

  it('e lo fa senza elenchi di id nell indirizzo e senza leggere le promozioni', async () => {
    const db = finto(tabelle, sconti, true);
    await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 500, maxPrice: sotto });
    expect(db.conIdNellIndirizzo).toEqual([]);
    expect(db.rpc).not.toContain('active_promo_products');
  });
});

describe('R21-006 R21-004 · senza la migrazione la griglia non va in errore e legge come prima', () => {
  it('forchetta 5-10 € sul prezzo pieno, e il numero sopra la griglia c è', async () => {
    const db = finto(TABELLE, SCONTI, false);
    const righe = ids(await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 10, minPrice: 5, maxPrice: 10 }));
    expect(righe).toContain('dieci');
    expect(righe).toContain('nove-e-99');
    expect(righe).not.toContain('venti');
    expect(righe).not.toContain('quattro');
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 5, maxPrice: 10 })).not.toBeNull();
  });
});
