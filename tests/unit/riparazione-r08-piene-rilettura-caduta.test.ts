/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { monta } from './aiuti/monta-componente';
import { accendi } from './aiuti/schermo';
import { CHIAVE_CATEGORIE_PIENE } from '@/lib/queries/categorie-piene';

/**
 * R08-007 / R08-005 — La pagina di una categoria madre e i chip della home buttavano via le
 * categorie piene già note quando una RILETTURA falliva (`isError ? null : data`): react-query
 * tiene `data` anche in stato d'errore, e tornavano in mostra le vuote. Qui i componenti veri si
 * montano con il react-query vero e un database finto: la prima lettura riesce, la rilettura cade.
 */
const g = globalThis as Record<string, unknown>;

const CATEGORIE = [
  { id: 'c-alim', slug: 'alimentari', name: 'Alimentari', icon: null, parent_id: null },
  { id: 'c-forno', slug: 'forno', name: 'Forno', icon: null, parent_id: 'c-alim' },
  { id: 'c-vini', slug: 'vini', name: 'Vini', icon: null, parent_id: 'c-alim' },
];
const PRODOTTI = [{ id: 'p1', category_id: 'c-forno', seller_id: 'n1' }];
let prodottiCaduti = false;

function database() {
  const catena = (tavola: string) => {
    const risposta = async () => {
      if (tavola === 'categories') return { data: CATEGORIE, error: null };
      if (tavola === 'seller_public_profiles') return { data: [{ id: 'n1' }], error: null };
      if (tavola === 'products') {
        return prodottiCaduti ? { data: null, error: { message: 'TypeError: fetch failed' } } : { data: PRODOTTI, error: null };
      }
      return { data: [], error: null };
    };
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'or', 'order', 'limit', 'range', 'gt', 'gte', 'lte', 'lt', 'ilike', 'not']) c[m] = () => c;
    c.then = (ok: (x: unknown) => unknown, ko?: (e: unknown) => unknown) => risposta().then(ok, ko);
    return c;
  };
  return { from: catena, rpc: () => Promise.resolve({ data: [], error: null }) };
}

async function lascia(volte = 30) {
  for (let i = 0; i < volte; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function monto(file: string, props: Record<string, unknown>) {
  g.__CLIENT_SUPABASE__ = database();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const mod = await monta(file, { veri: ['@tanstack/react-query'] });
  const Comp = mod.default as (p: unknown) => unknown;
  const schermo = accendi(() => createElement(QueryClientProvider, { client: qc }, createElement(Comp as never, props)));
  await lascia();
  const verso = (slug: string) => schermo.radice.querySelector(`a[href="/category/${slug}"]`) !== null;
  return { qc, schermo, verso };
}

async function rilettaCaduta(qc: QueryClient) {
  prodottiCaduti = true;
  await act(async () => {
    await qc.refetchQueries({ queryKey: CHIAVE_CATEGORIE_PIENE });
  });
  await lascia();
  const stato = qc.getQueryState(CHIAVE_CATEGORIE_PIENE);
  expect(stato?.status, 'controprova: la rilettura doveva cadere').toBe('error');
  expect(stato?.data, 'controprova: react-query tiene le piene già note').toEqual(expect.arrayContaining(['c-forno']));
}

afterEach(() => {
  prodottiCaduti = false;
  delete g.__CLIENT_SUPABASE__;
  document.body.innerHTML = '';
});

describe('rilettura delle categorie piene caduta: si tengono le ultime note', () => {
  it('pagina di una categoria madre: il bottone verso la figlia vuota non ritorna', async () => {
    const { qc, schermo, verso } = await monto('app/category/[slug]/page.tsx', { params: { slug: 'alimentari' } });
    expect(verso('forno'), 'controprova: la figlia piena ha il suo bottone').toBe(true);
    expect(verso('vini'), 'controprova: la figlia vuota non ce l\'ha').toBe(false);
    await rilettaCaduta(qc);
    expect(verso('forno')).toBe(true);
    expect(verso('vini'), 'la rilettura caduta ha rimesso il bottone della figlia vuota').toBe(false);
    schermo.smonta();
  }, 60000);

  it('chip della home: il chip della categoria vuota non ritorna', async () => {
    const chips = [
      { slug: 'alimentari', label: 'Alimentari' },
      { slug: 'vini', label: 'Vini' },
    ];
    const { qc, schermo, verso } = await monto('components/home-sections/ChipDelleCategorie.tsx', { chips, heroVariant: 'a' });
    expect(verso('alimentari'), 'controprova: la categoria piena ha il chip').toBe(true);
    expect(verso('vini'), 'controprova: la vuota no').toBe(false);
    await rilettaCaduta(qc);
    expect(verso('alimentari')).toBe(true);
    expect(verso('vini'), 'la rilettura caduta ha rimesso il chip della categoria vuota').toBe(false);
    schermo.smonta();
  }, 60000);

  it('prima lettura caduta, niente di saputo: si mostrano tutte, come prima', async () => {
    prodottiCaduti = true;
    const { schermo, verso } = await monto('app/category/[slug]/page.tsx', { params: { slug: 'alimentari' } });
    expect(verso('forno')).toBe(true);
    expect(verso('vini')).toBe(true);
    schermo.smonta();
  }, 60000);
});
