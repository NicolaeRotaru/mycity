/**
 * @vitest-environment jsdom
 */
/**
 * R04-010 — Un negozio solo non riempie il carosello delle storie in home.
 *
 * Il difetto: il carosello chiedeva le 30 storie più recenti (o, nel ripiego, le 200 più recenti)
 * e le teneva in fila per data. Un negozio approvato con più storie di quei posti nelle 24 ore li
 * prendeva tutti, e le storie degli altri negozi non arrivavano nemmeno in pagina.
 *
 * Il carosello si monta con un Supabase finto che risponde come PostgREST: prima i filtri (anche
 * `not.in` e l'aggancio `!inner` alla vista dei negozi in vetrina), poi l'ordine e il tetto.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const mondo = vi.hoisted(() => ({
  profili: [] as Array<Record<string, unknown>>,
  storie: [] as Array<Record<string, unknown>>,
  /** false: il servizio dati non conosce l'aggancio storia → vista (si passa dal ripiego). */
  agganciAllaVista: true,
  letture: [] as Array<{ tabella: string; select: string }>,
}));

vi.mock('@/lib/supabase/client', () => {
  type R = Record<string, unknown>;
  type Filtro = { op: string; colonna: string; valore: unknown; nega: boolean };

  const vetrina = (): R[] =>
    mondo.profili
      .filter((p) => p.is_approved === true && p.store_name != null && p.role === 'seller')
      .map((p) => ({ id: p.id, store_name: p.store_name, store_logo: p.store_logo ?? null, is_approved: p.is_approved, role: p.role }));
  const visibili = (tabella: string): R[] => {
    if (tabella === 'seller_stories') return mondo.storie.filter((s) => String(s.expires_at) > new Date().toISOString());
    if (tabella === 'seller_public_profiles') return vetrina();
    return [];
  };
  /** `in` vuole un elenco; `not.in` di PostgREST arriva come testo «(a,b,c)». */
  const elenco = (v: unknown): unknown[] =>
    Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, '').split(',').map((x) => x.trim()).filter(Boolean);
  const vale = (riga: R, f: Filtro): boolean => {
    const v = riga[f.colonna];
    let esito: boolean;
    switch (f.op) {
      case 'eq': esito = v === f.valore; break;
      case 'gt': esito = v != null && String(v) > String(f.valore); break;
      case 'in': esito = elenco(f.valore).includes(v); break;
      default: throw new Error(`filtro ${f.op} non simulato`);
    }
    return f.nega ? !esito : esito;
  };

  const domanda = (tabella: string) => {
    let select = '*';
    const filtri: Filtro[] = [];
    const ordini: Array<{ colonna: string; crescente: boolean }> = [];
    let tetto: number | null = null;
    const esegui = () => {
      mondo.letture.push({ tabella, select });
      const aggancio = /negozio:seller_public_profiles!inner\(id\)/.test(select);
      if (aggancio && !mondo.agganciAllaVista) {
        return { data: null, error: { code: 'PGRST200', message: `Could not find a relationship between '${tabella}' and 'seller_public_profiles'` } };
      }
      let righe = visibili(tabella).filter((r) => filtri.every((f) => vale(r, f)));
      if (aggancio) {
        const negozi = vetrina();
        righe = righe
          .filter((r) => negozi.some((n) => n.id === r.seller_id))
          .map((r) => ({ ...r, negozio: { id: r.seller_id } }));
      }
      for (const o of [...ordini].reverse()) {
        righe.sort((x, y) => {
          const a = String(x[o.colonna]);
          const b = String(y[o.colonna]);
          const cmp = a === b ? 0 : a < b ? -1 : 1;
          return o.crescente ? cmp : -cmp;
        });
      }
      if (tetto !== null) righe = righe.slice(0, tetto);
      if (tabella === 'seller_public_profiles') {
        const colonne = select.split(',').map((c) => c.trim());
        righe = righe.map((r) => Object.fromEntries(colonne.map((c) => [c, r[c] ?? null])));
      }
      return { data: righe, error: null };
    };
    const filtro = (op: string) => (colonna: string, valore: unknown) => { filtri.push({ op, colonna, valore, nega: false }); return q; };
    const q = {
      select: (s = '*') => { select = s; return q; },
      eq: filtro('eq'),
      gt: filtro('gt'),
      in: filtro('in'),
      not: (colonna: string, op: string, valore: unknown) => { filtri.push({ op, colonna, valore, nega: true }); return q; },
      order: (colonna: string, o?: { ascending?: boolean }) => { ordini.push({ colonna, crescente: o?.ascending !== false }); return q; },
      limit: (n: number) => { tetto = n; return q; },
      then: <T,>(ok: (r: ReturnType<typeof esegui>) => T, ko?: (e: unknown) => T) => {
        try {
          return Promise.resolve(ok(esegui()));
        } catch (e) {
          return ko ? Promise.resolve(ko(e)) : Promise.reject(e);
        }
      },
    };
    return q;
  };

  return {
    supabase: {
      from: (t: string) => domanda(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user: null } }) },
    },
  };
});
vi.mock('@/lib/logger', () => ({ logger: { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} } }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? ''), className: p.className as string }) };
});

import StoriesCarousel from '@/components/home/StoriesCarousel';
import { queryKeys } from '@/lib/queries/keys';

const ADESSO = new Date('2026-11-21T12:00:00Z');
const fa = (minuti: number) => new Date(ADESSO.getTime() - minuti * 60_000).toISOString();
const tra = (minuti: number) => new Date(ADESSO.getTime() + minuti * 60_000).toISOString();

const GRANDE = 'n-grande';
const PANE = 'n-pane';
const FIORI = 'n-fiori';
const SOSPESO = 'n-sospeso';

const PROFILI: Riga[] = [
  { id: GRANDE, role: 'seller', is_approved: true, store_name: 'Bazar Grande', store_logo: null },
  { id: PANE, role: 'seller', is_approved: true, store_name: 'Pane di Ada', store_logo: null },
  { id: FIORI, role: 'seller', is_approved: true, store_name: 'Fiori di Bea', store_logo: null },
  { id: SOSPESO, role: 'seller', is_approved: false, store_name: 'Bottega Sospesa', store_logo: null },
];

const storia = (id: string, seller: string, creata: string): Riga => ({
  id, seller_id: seller, image_url: `https://x/${id}.jpg`, caption: null, link_url: null, view_count: 0,
  expires_at: tra(600), created_at: creata,
});

/** `quante` storie del Bazar Grande, tutte più recenti di quelle degli altri negozi. */
const delGrande = (quante: number): Riga[] =>
  Array.from({ length: quante }, (_, i) => storia(`grande-${i}`, GRANDE, new Date(ADESSO.getTime() - (i + 1) * 1000).toISOString()));

const accesi: Root[] = [];

async function accendi(): Promise<{ radice: HTMLElement; qc: QueryClient }> {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const radice = document.createElement('div');
  document.body.appendChild(radice);
  const root = createRoot(radice);
  accesi.push(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(StoriesCarousel))); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return { radice, qc };
}

const bolle = (radice: HTMLElement) => Array.from(radice.querySelectorAll('button')).map((b) => (b.querySelector('span')?.textContent ?? '').trim());
const storieLette = (qc: QueryClient) => (qc.getQueryData(queryKeys.seller.storiesActive) ?? []) as Array<{ id: string; seller_id: string }>;
const lettureStorie = () => mondo.letture.filter((l) => l.tabella === 'seller_stories');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.profili = PROFILI;
  mondo.agganciAllaVista = true;
  mondo.letture = [];
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R04-010 · un negozio solo non riempie il carosello delle storie', () => {
  it('un negozio con 200 storie nelle 24 ore non spinge fuori gli altri negozi', async () => {
    mondo.storie = [...delGrande(200), storia('pane-1', PANE, fa(180)), storia('fiori-1', FIORI, fa(240)), storia('pane-2', PANE, fa(300))];
    const { radice, qc } = await accendi();

    expect(bolle(radice), 'il carosello mostra solo il negozio con tante storie').toEqual(['Bazar Grande', 'Pane di Ada', 'Fiori di Bea']);
    const lette = storieLette(qc);
    expect(lette).toHaveLength(30);
    expect(lette.map((s) => s.id)).toEqual(expect.arrayContaining(['pane-1', 'pane-2', 'fiori-1']));
    // A turno: la più recente di ogni negozio viene prima della seconda di chiunque.
    expect(lette.slice(0, 3).map((s) => s.seller_id)).toEqual([GRANDE, PANE, FIORI]);
  });

  it('anche nel ripiego (il servizio dati non conosce l’aggancio alla vista) gli altri negozi restano', async () => {
    mondo.agganciAllaVista = false;
    mondo.storie = [...delGrande(230), storia('pane-1', PANE, fa(180)), storia('fiori-1', FIORI, fa(240)), storia('sospesa-1', SOSPESO, fa(250))];
    const { radice, qc } = await accendi();

    expect(bolle(radice)).toEqual(['Bazar Grande', 'Pane di Ada', 'Fiori di Bea']);
    expect(storieLette(qc).map((s) => s.id)).toEqual(expect.arrayContaining(['pane-1', 'fiori-1']));
    expect(radice.textContent ?? '').not.toContain('Bottega Sospesa');
  });

  it('con poche storie basta una lettura, e l’ordine resta quello di sempre', async () => {
    mondo.storie = [storia('pane-1', PANE, fa(10)), storia('fiori-1', FIORI, fa(20)), storia('pane-2', PANE, fa(30))];
    const { radice, qc } = await accendi();

    expect(lettureStorie()).toHaveLength(1);
    expect(bolle(radice)).toEqual(['Pane di Ada', 'Fiori di Bea']);
    expect(storieLette(qc).map((s) => s.id)).toEqual(['pane-1', 'fiori-1', 'pane-2']);
  });
});
