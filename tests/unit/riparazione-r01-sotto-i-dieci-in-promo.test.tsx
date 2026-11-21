/**
 * @vitest-environment jsdom
 */
/**
 * R01-008 — «Sotto i 10 €» tagliava sul prezzo pieno: un prodotto da 12 € al -25% (9 € alla cassa)
 * restava fuori dalla pagina e dal numero in alto. Qui la griglia VERA con la lettura vera
 * (`lib/queries/griglia-prodotti.ts`) sopra un piccolo database finto che applica davvero i filtri
 * (anche l'`or` di PostgREST) e le promozioni come la cassa (`product_active_discounts`).
 * Deve entrare chi si paga sotto 10, restare fuori il 10,00 tondo e chi in promo resta sopra 10.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const mondo = vi.hoisted(() => ({
  prodotti: [] as Array<Record<string, unknown>>,
  negozi: [] as Array<Record<string, unknown>>,
  sconti: {} as Record<string, number>,
  schede: [] as Array<Record<string, unknown>>,
}));

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
  const [colonna, op, ...resto] = parte.split('.');
  const valore = resto.join('.');
  if (op === 'in') {
    const elenco = valore.replace(/^\(|\)$/g, '').split(',');
    return (r) => elenco.includes(String(r[colonna]));
  }
  if (op === 'is') return (r) => (r[colonna] ?? null) === null;
  if (op === 'lte') return (r) => Number(r[colonna]) <= Number(valore);
  if (op === 'lt') return (r) => Number(r[colonna]) < Number(valore);
  if (op === 'gte') return (r) => Number(r[colonna]) >= Number(valore);
  if (op === 'gt') return (r) => Number(r[colonna]) > Number(valore);
  if (op === 'eq') return (r) => String(r[colonna]) === valore;
  throw new Error(`condizione non capita: ${parte}`);
}

class Domanda {
  private filtri: Array<(r: Riga) => boolean> = [];
  private ordini: Array<[string, boolean]> = [];
  private da = 0;
  private a = Infinity;
  private conta = false;
  private testa = false;
  constructor(private righe: Riga[]) {}
  select(_c?: string, o?: { count?: string; head?: boolean }) { this.conta = !!o?.count; this.testa = !!o?.head; return this; }
  eq(c: string, v: unknown) { this.filtri.push((r) => r[c] === v); return this; }
  in(c: string, v: unknown[]) { this.filtri.push((r) => v.includes(r[c])); return this; }
  lte(c: string, v: number) { this.filtri.push((r) => Number(r[c]) <= v); return this; }
  lt(c: string, v: number) { this.filtri.push((r) => Number(r[c]) < v); return this; }
  gte(c: string, v: unknown) { this.filtri.push((r) => (typeof v === 'number' ? Number(r[c]) >= v : String(r[c]) >= String(v))); return this; }
  gt(c: string, v: number) { this.filtri.push((r) => Number(r[c]) > v); return this; }
  ilike(c: string, p: string) { const re = new RegExp(p.replace(/%/g, '.*'), 'i'); this.filtri.push((r) => re.test(String(r[c]))); return this; }
  or(espressione: string) { const parti = spezza(espressione).map(condizione); this.filtri.push((r) => parti.some((f) => f(r))); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ordini.push([c, o?.ascending !== false]); return this; }
  range(da: number, a: number) { this.da = da; this.a = a; return this; }
  limit(n: number) { this.a = this.da + n - 1; return this; }
  then<T>(ok: (v: { data: Riga[] | null; error: null; count?: number }) => T, ko?: (e: unknown) => T) {
    let righe = this.righe.filter((r) => this.filtri.every((f) => f(r)));
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
    return Promise.resolve({ data: this.testa ? null : righe, error: null, count: this.conta ? totale : undefined }).then(ok, ko);
  }
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (tabella: string) =>
      new Domanda(tabella === 'products' ? mondo.prodotti : tabella === 'seller_public_profiles' ? mondo.negozi : []),
    rpc: async (nome: string, argomenti: Record<string, unknown> = {}) => {
      // La regola delle promozioni attive, uguale nelle due funzioni del database.
      if (nome === 'active_promo_products') {
        const righe = mondo.prodotti
          .filter((p) => (mondo.sconti[p.id as string] ?? 0) > 0)
          .map((p) => ({ product_id: p.id, name: p.name, price: p.price, discount_percent: mondo.sconti[p.id as string] }));
        return { data: righe.slice(0, Number(argomenti.p_limit ?? 12)), error: null };
      }
      if (nome === 'product_active_discounts') {
        const ids = (argomenti.p_products ?? []) as string[];
        return { data: ids.map((id) => ({ product_id: id, discount_percent: mondo.sconti[id] ?? 0 })), error: null };
      }
      return { data: [], error: null };
    },
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

const NEGOZIO = 'neg-1';
const prodotto = (id: string, price: number) => ({
  id, name: id, price, compare_at_price: null, images: [], stock: 5, has_variants: false,
  created_at: '2026-11-01T00:00:00Z', seller_id: NEGOZIO, category_id: 'c1', status: 'available',
});

async function monta(sort: string) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as Record<string, unknown>).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  const conti: number[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client },
      createElement(ProductGrid, { limit: 40, prezzoSotto: 10, sort, maxColumns: 4, onCount: (n: number) => conti.push(n) } as never)));
  });
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const ultimaVolta = new Map<string, Record<string, unknown>>();
  for (const s of mondo.schede.slice(-20)) ultimaVolta.set(s.id as string, s);
  return { visti: ultimaVolta, conti, smonta: () => act(() => root.unmount()) };
}

beforeEach(() => {
  mondo.schede = [];
  mondo.negozi = [{ id: NEGOZIO, store_name: 'Bottega', store_hours: null, is_approved: true }];
  mondo.prodotti = [
    prodotto('nove-e-mezzo', 9.5),
    prodotto('dieci-tondi', 10),
    prodotto('dodici-in-promo', 12),
    prodotto('quindici-in-promo', 15),
    prodotto('trenta', 30),
  ];
  // 12 € al -25% = 9 € alla cassa; 15 € al -20% = 12 €, resta sopra.
  mondo.sconti = { 'dodici-in-promo': 25, 'quindici-in-promo': 20 };
});

describe('R01-008 · «Sotto i 10 €» guarda il prezzo che si paga, promozione compresa', () => {
  for (const sort of ['price_asc', 'price_desc', 'newest']) {
    it(`entra il prodotto che in promozione costa meno di 10, il 10,00 resta fuori (${sort})`, async () => {
      const g = await monta(sort);
      const ids = [...g.visti.keys()].sort();
      expect(ids).toEqual(['dodici-in-promo', 'nove-e-mezzo']);
      // La scheda lo mostra scontato, con lo sconto della cassa.
      expect(g.visti.get('dodici-in-promo')?.discountPercent).toBe(25);
      g.smonta();
    });
  }

  it('il numero in alto conta anche lui il prodotto in promozione', async () => {
    const g = await monta('price_asc');
    expect(g.conti.at(-1)).toBe(2);
    g.smonta();
  });

  it('senza promozioni attive resta tutto come prima: solo chi costa meno di 10 a prezzo pieno', async () => {
    mondo.sconti = {};
    const g = await monta('price_asc');
    expect([...g.visti.keys()]).toEqual(['nove-e-mezzo']);
    expect(g.conti.at(-1)).toBe(1);
    g.smonta();
  });
});
