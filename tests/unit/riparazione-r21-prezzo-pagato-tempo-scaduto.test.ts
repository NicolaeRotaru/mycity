/**
 * R21-003 — IL PREZZO CHE SI PAGA NON DEVE FERMARE LA GRIGLIA NEI CATALOGHI GRANDI, E IL NUMERO
 * SOPRA LA GRIGLIA DEVE TORNARE CON LA LISTA.
 *
 * Con un catalogo grande ordinare o tagliare su `prezzo_pagato` può superare il tempo di anon:
 * PostgREST risponde 57014. La lista deve ripiegare sul prezzo pieno come quando la colonna manca,
 * e il conteggio deve seguire la stessa strada: sul prezzo pieno solo quando ci va anche la lista.
 * Un altro errore del conteggio non lo sposta sul prezzo pieno (darebbe un numero diverso dalla lista).
 * La velocità della 911 è provata sul Postgres in tests/sql/rls/riparazione-r21-prezzo-pagato-veloce.test.sql.
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
type Guasto = (d: { conta: boolean; testa: boolean; tagliaOOrdina: boolean }) => { code?: string; message: string } | null;
function finto(tabelle: Record<string, Riga[]>, sconti: Record<string, number>, conColonna: boolean, guasto?: Guasto) {
  const nominate: string[] = [];
  class Domanda {
    private filtri: Array<(r: Riga) => boolean> = [];
    private ordini: Array<[string, boolean]> = [];
    private da = 0;
    private a = Infinity;
    private conta = false;
    private nomina = false;
    private tagliaOOrdina = false;
    private testa = false;
    constructor(private tabella: string) {}
    private segna(testo: string) { if (testo.includes(COLONNA)) { this.nomina = true; this.tagliaOOrdina = true; } }
    select(c = '*', o?: { count?: string; head?: boolean }) { if (c.includes(COLONNA)) this.nomina = true; this.conta = !!o?.count; this.testa = !!o?.head; return this; }
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
      const rotto = this.tabella === 'products' ? guasto?.({ conta: this.conta, testa: this.testa, tagliaOOrdina: this.tagliaOOrdina }) : null;
      // Su una HEAD postgrest-js non ha il corpo: l'errore arriva senza codice.
      if (rotto) return Promise.resolve({ data: null, error: this.testa ? { message: '' } : rotto }).then(ok as never, ko);
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

const TEMPO_SCADUTO = { code: '57014', message: 'canceling statement due to statement timeout' };

describe('R21-003 · 57014 guardando prezzo_pagato: lista e conteggio ripiegano insieme', () => {
  it('la lista non va in errore: legge sul prezzo pieno', async () => {
    const db = finto(TABELLE, SCONTI, true, (d) => (d.tagliaOOrdina ? TEMPO_SCADUTO : null));
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 10 });
    expect(righe.map((r) => r.id).sort()).toEqual(['dieci', 'dodici-al-25', 'venti']);
  });

  it('il conteggio dice lo stesso numero della lista', async () => {
    const db = finto(TABELLE, SCONTI, true, (d) => (d.tagliaOOrdina ? TEMPO_SCADUTO : null));
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 10 });
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 10 })).toBe(righe.length);
  });

  it('anche per l\'ordine di prezzo: niente errore, ordine sul prezzo pieno', async () => {
    const db = finto(TABELLE, SCONTI, true, (d) => (d.tagliaOOrdina ? TEMPO_SCADUTO : null));
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 10 });
    expect(righe.map((r) => r.id)).toEqual(['nove-e-99', 'dieci', 'dodici-al-25', 'venti']);
  });
});

describe('R21-003 · un altro errore del conteggio non lo sposta sul prezzo pieno', () => {
  it('la lista taglia su prezzo_pagato (2), il conteggio cade: niente «3» sul prezzo pieno', async () => {
    const db = finto(TABELLE, SCONTI, true, (d) => (d.conta && d.tagliaOOrdina ? { code: '53300', message: 'too many connections' } : null));
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 10, minPrice: 10 });
    expect(righe).toHaveLength(2);
    const numero = await contaProdottiDellaGriglia(db.client, { minPrice: 10 });
    expect(numero === null || numero === righe.length).toBe(true);
  });

  it('con prezzo_pagato che risponde il conteggio resta su prezzo_pagato', async () => {
    const db = finto(TABELLE, SCONTI, true);
    expect(await contaProdottiDellaGriglia(db.client, { minPrice: 10 })).toBe(2);
  });
});
