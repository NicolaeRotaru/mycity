/**
 * Il PostgREST finto delle prove R12 sul prezzo pagato (lib/queries/griglia-prodotti.ts).
 *
 * A differenza dell'aiutante comune `finto-postgrest.ts`, qui un `or` si valuta davvero, condizione
 * per condizione (`price.lte.10,id.in.(a,b)`), e `active_promo_products` risponde con i prodotti
 * scontati: così una prova sul taglio del massimo controlla il taglio, non la giacenza.
 *
 * `stato.conColonna` = la migrazione 911 è applicata (si può cambiare a metà prova);
 * `stato.guasto` = un errore da restituire a una lettura di `products`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { discountedUnitCents } from '@/lib/promotions';

export type Riga = Record<string, unknown>;
const COLONNA = 'prezzo_pagato';

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

export type Guasto = (d: { conta: boolean; testa: boolean; prezzoPagato: boolean }) => { code?: string; message: string } | null;
export type StatoFinto = { conColonna: boolean; guasto?: Guasto };

export function fintoPrezzoPagato(tabelle: Record<string, Riga[]>, sconti: Record<string, number>, stato: StatoFinto) {
  /** Una voce per ogni lettura di `products` andata a buon fine: guardava `prezzo_pagato`? */
  const letture: Array<{ prezzoPagato: boolean; ordini: string[] }> = [];
  class Domanda {
    private filtri: Array<(r: Riga) => boolean> = [];
    private ordini: Array<[string, boolean]> = [];
    private da = 0;
    private a = Infinity;
    private conta = false;
    private testa = false;
    private nomina = false;
    private prezzoPagato = false;
    constructor(private tabella: string) {}
    private segna(testo: string) { if (testo.includes(COLONNA)) { this.nomina = true; this.prezzoPagato = true; } }
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
    then<T>(ok: (v: { data: Riga[] | null; error: { code?: string; message: string } | null; count?: number }) => T, ko?: (e: unknown) => T) {
      if (this.nomina && !stato.conColonna) {
        return Promise.resolve({ data: null, error: { code: '42703', message: `column products.${COLONNA} does not exist` } }).then(ok, ko);
      }
      const rotto = this.tabella === 'products' ? stato.guasto?.({ conta: this.conta, testa: this.testa, prezzoPagato: this.prezzoPagato }) : null;
      // Su una HEAD postgrest-js non ha il corpo: l'errore arriva senza codice.
      if (rotto) return Promise.resolve({ data: null, error: this.testa ? { message: '' } : rotto }).then(ok, ko);
      let righe = (tabelle[this.tabella] ?? []).map((r) => (stato.conColonna && this.tabella === 'products'
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
      if (this.tabella === 'products' && !this.conta) letture.push({ prezzoPagato: this.prezzoPagato, ordini: this.ordini.map(([c]) => c) });
      const totale = righe.length;
      righe = righe.slice(this.da, this.a === Infinity ? undefined : this.a + 1);
      return Promise.resolve({ data: righe, error: null, count: this.conta ? totale : undefined }).then(ok, ko);
    }
  }
  const client = {
    from: (t: string) => new Domanda(t),
    rpc: async (nome: string) => {
      if (nome !== 'active_promo_products') return { data: [], error: null };
      const data = (tabelle.products ?? [])
        .filter((r) => (sconti[r.id as string] ?? 0) > 0)
        .map((r) => ({ product_id: r.id, price: r.price, discount_percent: sconti[r.id as string] }));
      return { data, error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, letture };
}

export const NEGOZIO = { id: 'neg-1', store_name: 'Bottega', store_hours: null, is_approved: true };
export const prodotto = (id: string, price: number) => ({
  id, name: id, price, compare_at_price: null, images: [], stock: 5, has_variants: false,
  created_at: '2026-11-20T10:00:00Z', seller_id: NEGOZIO.id, category_id: null, status: 'available',
});
