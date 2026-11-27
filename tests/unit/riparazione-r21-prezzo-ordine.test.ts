/**
 * R21-005 R21-014 — ORDINANDO PER PREZZO LE GRIGLIE GUARDAVANO IL PREZZO PIENO.
 *
 * Un prodotto da 12 € al -25% (a video e alla cassa 9 €) finiva dopo uno da 9,99 € e dopo uno da
 * 10 €, in ricerca, categorie e «Sotto i 10 €». Con la migrazione 911 il database ordina sul prezzo
 * che si paga (`prezzo_pagato`, provata in tests/sql/rls/riparazione-r21-prezzo-pagato.test.sql), poi
 * sul pieno, poi sull'id; e il riordino delle letture a blocchi (`idsColVoto` oltre un blocco) segue
 * lo stesso ordine. Senza la migrazione la griglia non va in errore e ordina come prima, sul pieno.
 *
 * Il PostgREST finto applica davvero filtri, ordine e finestra; senza la migrazione ogni domanda che
 * nomina la colonna nuova riceve 42703, come dal PostgREST vero.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { DIMENSIONE_BLOCCO } from '@/lib/supabase/blocchi';
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
const ids = (righe: Array<{ id: string }>) => righe.map((r) => r.id);

describe('R21-005 R21-014 · con la migrazione 911 l ordine per prezzo è sul prezzo che si paga', () => {
  it('crescente: il 12 € scontato a 9 € passa davanti al 9,99 € e al 10 €', async () => {
    const db = finto(TABELLE, SCONTI, true);
    expect(ids(await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 10 }))).toEqual(['dodici-al-25', 'nove-e-99', 'dieci', 'venti']);
  });

  it('decrescente: l ordine inverso', async () => {
    const db = finto(TABELLE, SCONTI, true);
    expect(ids(await leggiProdottiDellaGriglia(db.client, { sort: 'price_desc', tetto: 10 }))).toEqual(['venti', 'dieci', 'nove-e-99', 'dodici-al-25']);
  });

  it('l ordine regge fra le pagine (finestre di due righe) e con un filtro di prezzo acceso', async () => {
    const db = finto(TABELLE, SCONTI, true);
    const p1 = await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 2, finestra: [0, 1], maxPrice: 15 });
    const p2 = await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 2, finestra: [2, 3], maxPrice: 15 });
    expect([...ids(p1), ...ids(p2)]).toEqual(['dodici-al-25', 'nove-e-99', 'dieci']);
  });
});

describe('R21-005 R21-014 · il riordino delle letture a blocchi segue il prezzo pagato', () => {
  const QUANTI = DIMENSIONE_BLOCCO * 2 + 50;
  const riga = (i: number) => prodotto(`p-${String(i).padStart(3, '0')}`, 10 + ((i * 7) % 40));
  const catalogo = Array.from({ length: QUANTI }, (_, i) => riga(i + 1));
  // Uno ogni tre è scontato della metà: il suo prezzo pagato non segue più il pieno.
  const sconti: Record<string, number> = Object.fromEntries(catalogo.filter((_, i) => (i + 1) % 3 === 0).map((p) => [p.id, 50]));
  const pagato = (p: { id: string; price: number }) => discountedUnitCents(p.price, sconti[p.id] ?? 0);
  // I recensiti in ordine mescolato: ogni blocco ha prodotti di ogni fascia di prezzo.
  const idsColVoto = catalogo.map((p) => p.id).sort((a, b) => ((Number(a.slice(2)) * 37) % 251) - ((Number(b.slice(2)) * 37) % 251));
  // L'ordine atteso, scritto qui: prezzo pagato, poi pieno, poi id decrescente (per «decrescente» i
  // primi due si rovesciano, l'id resta decrescente).
  const attesi = (verso: 1 | -1, conPagato: boolean) => [...catalogo]
    .sort((a, b) => (conPagato ? verso * (pagato(a) - pagato(b)) : 0) || verso * (a.price - b.price) || (a.id < b.id ? 1 : -1))
    .map((p) => p.id);
  const db = (conColonna: boolean) => finto({ seller_public_profiles: [NEGOZIO], products: catalogo }, sconti, conColonna);

  it('il catalogo di prova supera un blocco, e ha prezzi pagati pari con pieni diversi', () => {
    expect(idsColVoto.length).toBeGreaterThan(DIMENSIONE_BLOCCO * 2);
    const viste = new Map<number, Set<number>>();
    for (const p of catalogo) viste.set(pagato(p), (viste.get(pagato(p)) ?? new Set()).add(p.price));
    expect([...viste.values()].some((s) => s.size > 1)).toBe(true);
  });

  for (const [sort, verso] of [['price_asc', 1], ['price_desc', -1]] as const) {
    it(`${sort}: la lettura a blocchi dà l elenco di una lettura sola, e le finestre non saltano righe`, async () => {
      expect(ids(await leggiProdottiDellaGriglia(db(true).client, { sort, tetto: QUANTI, idsColVoto }))).toEqual(attesi(verso, true));
      const c = db(true).client;
      const p1 = await leggiProdottiDellaGriglia(c, { sort, tetto: 40, idsColVoto, finestra: [0, 39] });
      const p2 = await leggiProdottiDellaGriglia(c, { sort, tetto: 40, idsColVoto, finestra: [40, 79] });
      expect([...ids(p1), ...ids(p2)]).toEqual(attesi(verso, true).slice(0, 80));
    });
  }
});

describe('R21-005 R21-014 · senza la migrazione la griglia non va in errore e ordina come prima', () => {
  it('crescente sul prezzo pieno', async () => {
    const db = finto(TABELLE, SCONTI, false);
    expect(ids(await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 10 }))).toEqual(['nove-e-99', 'dieci', 'dodici-al-25', 'venti']);
  });

  it('decrescente sul prezzo pieno, anche a blocchi', async () => {
    const molti = Array.from({ length: DIMENSIONE_BLOCCO + 20 }, (_, i) => prodotto(`m-${String(i).padStart(3, '0')}`, 5 + (i % 9)));
    const db = finto({ seller_public_profiles: [NEGOZIO], products: molti }, {}, false);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'price_desc', tetto: 30, idsColVoto: molti.map((p) => p.id) });
    const atteso = [...molti].sort((a, b) => b.price - a.price || (a.id < b.id ? 1 : -1)).slice(0, 30).map((p) => p.id);
    expect(ids(righe)).toEqual(atteso);
  });
});
