/**
 * @vitest-environment jsdom
 */
/**
 * R21-010 — LA GRIGLIA CHIAMAVA IL VECCHIO CALCOLO DEI PRODOTTI IN PROMOZIONE ACCANTO A QUELLO NUOVO.
 *
 * Per «Sotto i 10 €» ProductGrid chiedeva da sé gli id che solo in promozione scendono sotto la
 * soglia (`active_promo_products`, 1000 righe) e li passava alla lettura, che con la migrazione 911
 * il prezzo pagato lo sa già: due strade per lo stesso conto. Ora la strada è una, la lettura
 * (lib/queries/griglia-prodotti.ts): con la migrazione guarda `prezzo_pagato` e la griglia non chiede
 * più niente; senza, gli id li chiede la lettura stessa, e il 12 € al -25% (9 €) entra lo stesso.
 *
 * Il PostgREST finto applica davvero filtri (anche l'`or` con gli id), ordine e finestra, e le
 * promozioni come la cassa; senza la migrazione ogni domanda che nomina la colonna nuova riceve
 * 42703, come dal PostgREST vero.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { discountedUnitCents } from '@/lib/promotions';

const mondo = vi.hoisted(() => ({
  client: null as unknown as { from: (t: string) => unknown; rpc: (n: string, a?: Record<string, unknown>) => unknown },
  schede: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => mondo.client.from(t),
    rpc: (n: string, a?: Record<string, unknown>) => mondo.client.rpc(n, a),
  },
}));
vi.mock('@/components/ProductCard', () => ({
  default: (p: Record<string, unknown>) => {
    mondo.schede.push(p);
    return null;
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('@/lib/analytics/events', () => ({ trackSearchPerformed: () => undefined }));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return { default: ({ href, children, ...r }: Record<string, unknown>) => ce('a', { href: String(href), ...r }, children as never) };
});

import ProductGrid from '@/components/ProductGrid';

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
    // Le due funzioni delle promozioni, con la regola della cassa.
    rpc: async (nome: string, argomenti: Record<string, unknown> = {}) => {
      rpc.push(nome);
      if (nome === 'active_promo_products') {
        const righe = (tabelle.products ?? [])
          .filter((p) => (sconti[p.id as string] ?? 0) > 0)
          .map((p) => ({ product_id: p.id, name: p.name, price: p.price, discount_percent: sconti[p.id as string] }));
        return { data: righe.slice(0, Number(argomenti.p_limit ?? 12)), error: null };
      }
      if (nome === 'product_active_discounts') {
        const elenco = (argomenti.p_products ?? []) as string[];
        return { data: elenco.map((id) => ({ product_id: id, discount_percent: sconti[id] ?? 0 })), error: null };
      }
      return { data: [], error: null };
    },
  };
  return { client: client as unknown as SupabaseClient, nominate, rpc };
}

const NEGOZIO = { id: 'neg-1', store_name: 'Bottega', store_hours: null, is_approved: true };
const prodotto = (id: string, price: number) => ({
  id, name: id, price, compare_at_price: null, images: [], stock: 5, has_variants: false,
  created_at: '2026-11-20T10:00:00Z', seller_id: NEGOZIO.id, category_id: 'c1', status: 'available',
});
const TABELLE = {
  seller_public_profiles: [NEGOZIO],
  products: [prodotto('nove-e-mezzo', 9.5), prodotto('dieci-tondi', 10), prodotto('dodici-in-promo', 12), prodotto('quindici-in-promo', 15), prodotto('trenta', 30)],
};
// 12 € al -25% = 9 € alla cassa; 15 € al -20% = 12 €, resta sopra.
const SCONTI = { 'dodici-in-promo': 25, 'quindici-in-promo': 20 };
const SOTTO_I_DIECI = 10 - 0.005;

beforeEach(() => {
  mondo.schede = [];
});

describe('R21-010 · con la migrazione 911 la griglia non chiede più il vecchio calcolo', () => {
  it('«Sotto i 10 €»: entra il 12 € a 9 €, e nessuno legge le promozioni per gli id', async () => {
    const db = finto(TABELLE, SCONTI, true);
    mondo.client = db.client as never;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    const conti: number[] = [];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const radice = document.createElement('div');
    document.body.appendChild(radice);
    const root = createRoot(radice);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client },
        createElement(ProductGrid, { limit: 40, prezzoSotto: 10, sort: 'price_asc', maxColumns: 4, onCount: (n: number) => conti.push(n) } as never)));
    });
    for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const viste = [...new Set(mondo.schede.slice(-10).map((s) => s.id as string))].sort();
    expect(viste).toEqual(['dodici-in-promo', 'nove-e-mezzo']);
    expect(conti.at(-1)).toBe(2);
    expect(db.rpc, 'la griglia chiede ancora da sé i prodotti in promozione').not.toContain('active_promo_products');
    act(() => root.unmount());
  });
});

describe('R21-010 · senza la migrazione gli id in promozione li chiede la lettura stessa', () => {
  it('il 12 € a 9 € entra in «Sotto i 10 €» senza che nessuno gli passi gli id, e il numero lo conta', async () => {
    const db = finto(TABELLE, SCONTI, false);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'price_asc', tetto: 40, maxPrice: SOTTO_I_DIECI });
    expect(righe.map((r) => r.id)).toEqual(['nove-e-mezzo', 'dodici-in-promo']);
    expect(await contaProdottiDellaGriglia(db.client, { maxPrice: SOTTO_I_DIECI })).toBe(2);
  });

  it('anche lo slider (massimo 10 € compreso): il 12 € a 9 € entra, il 15 € a 12 € no', async () => {
    const db = finto(TABELLE, SCONTI, false);
    const righe = await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 40, minPrice: 5, maxPrice: 10 });
    expect(righe.map((r) => r.id).sort()).toEqual(['dieci-tondi', 'dodici-in-promo', 'nove-e-mezzo']);
  });

  it('con la migrazione la lettura non li chiede', async () => {
    const db = finto(TABELLE, SCONTI, true);
    await leggiProdottiDellaGriglia(db.client, { sort: 'newest', tetto: 40, maxPrice: SOTTO_I_DIECI });
    await contaProdottiDellaGriglia(db.client, { maxPrice: SOTTO_I_DIECI });
    expect(db.rpc).not.toContain('active_promo_products');
  });
});
