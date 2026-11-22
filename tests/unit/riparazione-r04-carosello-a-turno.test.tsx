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
 *
 * Giro 3 (collaudo): tre negozi con più di 30 storie nascondevano tutti gli altri, perché le letture
 * erano tre in tutto. Ora la funzione 662 (`storie_attive_per_negozio`, chiamata con `.rpc`) dà al
 * massimo 30 storie PER NEGOZIO in una lettura sola: ogni negozio con storie compare, e con più di 30
 * negozi i 30 posti sono 30 negozi diversi. Il finto qui sotto simula la funzione come è scritta nella
 * migrazione (negozi in vetrina, non scadute, 30 negozi più recenti, 30 storie a testa).
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
  /** false: la funzione 662 non c'è ancora (migrazione non applicata) → il sito legge come prima. */
  funzione: true,
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
      rpc: (nome: string, args?: { p_per_negozio?: number; p_negozi?: number }) => {
        mondo.letture.push({ tabella: `rpc:${nome}`, select: JSON.stringify(args ?? {}) });
        if (nome !== 'storie_attive_per_negozio' || !mondo.funzione) {
          return Promise.resolve({ data: null, error: { code: '42883', message: `function ${nome} does not exist` } });
        }
        const perNegozio = Math.min(Math.max(args?.p_per_negozio ?? 30, 1), 30);
        const negozi = Math.min(Math.max(args?.p_negozi ?? 30, 1), 30);
        const inVetrina = new Set(vetrina().map((n) => String(n.id)));
        const vive = visibili('seller_stories')
          .filter((r) => inVetrina.has(String(r.seller_id)))
          .sort((x, y) => (String(x.created_at) < String(y.created_at) ? 1 : -1));
        const gruppi = new Map<string, R[]>();
        for (const r of vive) gruppi.set(String(r.seller_id), [...(gruppi.get(String(r.seller_id)) ?? []), r]);
        const scelti = [...gruppi.values()].slice(0, negozi); // già in ordine di storia più recente
        const righe = scelti.flatMap((g) => g.slice(0, perNegozio)).sort((x, y) => (String(x.created_at) < String(y.created_at) ? 1 : -1));
        return Promise.resolve({ data: righe, error: null });
      },
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
/** Le domande che portano storie: letture della tabella e chiamate della funzione 662. */
const domandeDiStorie = () => mondo.letture.filter((l) => l.tabella === 'seller_stories' || l.tabella === 'rpc:storie_attive_per_negozio');

/** Il tetto dichiarato: con la funzione 662 le storie arrivano in UNA lettura, in ogni caso. */
const LETTURE_MAX_CON_FUNZIONE = 1;
/** Il tetto del ripiego (funzione non applicata): aggancio che cade, 200 storie, al massimo due riletture. */
const LETTURE_MAX_RIPIEGO = 4;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.profili = PROFILI;
  mondo.agganciAllaVista = true;
  mondo.funzione = true;
  mondo.letture = [];
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R04-010 · ripiego senza la funzione 662 · un negozio solo non riempie il carosello', () => {
  beforeEach(() => { mondo.funzione = false; });

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

  it.each([[true], [false]])('ripiego, 40 negozi da 40 storie: letture fisse e almeno i negozi che quelle letture portano (aggancio alla vista: %s)', async (aggancio) => {
    mondo.agganciAllaVista = aggancio;
    const negozi = Array.from({ length: 40 }, (_, k) => ({ id: `n-${k}`, role: 'seller', is_approved: true, store_name: `Negozio ${k}`, store_logo: null }));
    mondo.profili = negozi;
    // Il negozio 0 ha le storie più recenti, poi il 1, e così via: ogni lettura piena è di un negozio solo.
    mondo.storie = negozi.flatMap((n, k) =>
      Array.from({ length: 40 }, (_, i) => storia(`${n.id}-${i}`, n.id as string, new Date(ADESSO.getTime() - (k * 40 + i + 1) * 1000).toISOString())),
    );
    const { radice } = await accendi();

    // Nel ripiego la prima domanda (con l'aggancio) può cadere senza dare righe: la si conta lo stesso.
    expect(lettureStorie().length, 'letture delle storie nel ripiego').toBeLessThanOrEqual(LETTURE_MAX_RIPIEGO);
    // Limite DICHIARATO del ripiego: tre letture portano tre negozi. Il caso intero (ogni negozio) è della
    // funzione 662, provato qui sotto: senza funzione non si può leggere «poche storie per negozio».
    expect(bolle(radice).length, 'negozi nel carosello (ripiego)').toBeGreaterThanOrEqual(3);
  });
});

describe('R04-010 · con la funzione 662 ogni negozio con storie compare', () => {
  const negozio = (k: number) => ({ id: `n-${k}`, role: 'seller', is_approved: true, store_name: `Negozio ${String(k).padStart(2, '0')}`, store_logo: null });

  it('il caso del collaudo: 3 negozi da 40+ storie e 12 negozi da 1-2 storie → compaiono TUTTI e 15, e nessun altro', async () => {
    const grandi = [0, 1, 2];
    const piccoli = Array.from({ length: 12 }, (_, i) => 3 + i);
    mondo.profili = [...grandi, ...piccoli].map(negozio);
    mondo.storie = [
      ...grandi.flatMap((k) => Array.from({ length: 45 }, (_, i) => storia(`n-${k}-${i}`, `n-${k}`, new Date(ADESSO.getTime() - (i + 1 + k) * 1000).toISOString()))),
      ...piccoli.flatMap((k) => Array.from({ length: 1 + (k % 2) }, (_, i) => storia(`n-${k}-${i}`, `n-${k}`, fa(600 + k * 10 + i)))),
    ];
    const { radice, qc } = await accendi();

    const attesi = [...grandi, ...piccoli].map((k) => `Negozio ${String(k).padStart(2, '0')}`).sort();
    expect([...bolle(radice)].sort(), 'l’insieme esatto dei negozi in carosello').toEqual(attesi);
    expect(new Set(storieLette(qc).map((s) => s.seller_id)), 'negozi fra le storie').toEqual(new Set([...grandi, ...piccoli].map((k) => `n-${k}`)));
    expect(storieLette(qc).length).toBeLessThanOrEqual(30);
    // La più recente di ogni negozio viene prima della seconda di chiunque.
    expect(storieLette(qc).slice(0, 15).map((s) => s.seller_id).sort()).toEqual([...grandi, ...piccoli].map((k) => `n-${k}`).sort());
    expect(domandeDiStorie().length, 'letture delle storie').toBeLessThanOrEqual(LETTURE_MAX_CON_FUNZIONE);
    expect(lettureStorie(), 'nessuna lettura diretta della tabella').toHaveLength(0);
  });

  it('40 negozi da 40 storie → i 30 posti sono 30 negozi diversi', async () => {
    mondo.profili = Array.from({ length: 40 }, (_, k) => negozio(k));
    mondo.storie = mondo.profili.flatMap((n, k) =>
      Array.from({ length: 40 }, (_, i) => storia(`${n.id}-${i}`, n.id as string, new Date(ADESSO.getTime() - (k * 40 + i + 1) * 1000).toISOString())),
    );
    const { radice, qc } = await accendi();

    const lette = storieLette(qc);
    expect(lette).toHaveLength(30);
    expect(new Set(lette.map((s) => s.seller_id)).size, 'negozi diversi nei 30 posti').toBe(30);
    expect(bolle(radice)).toHaveLength(30);
    expect(domandeDiStorie().length, 'letture delle storie').toBeLessThanOrEqual(LETTURE_MAX_CON_FUNZIONE);
  });

  it('un negozio solo con 200 storie e altri due piccoli: compaiono tutti e tre, in una lettura sola', async () => {
    mondo.storie = [...delGrande(200), storia('pane-1', PANE, fa(180)), storia('fiori-1', FIORI, fa(240)), storia('sospesa-1', SOSPESO, fa(250))];
    const { radice } = await accendi();

    expect([...bolle(radice)].sort()).toEqual(['Bazar Grande', 'Fiori di Bea', 'Pane di Ada']);
    expect(domandeDiStorie().length).toBeLessThanOrEqual(LETTURE_MAX_CON_FUNZIONE);
  });
});
