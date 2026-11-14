/**
 * @vitest-environment jsdom
 */
/**
 * R16-019 — Il carosello delle storie in home filtra i negozi PRIMA di tagliare, nel database.
 *
 * Il difetto: il carosello chiedeva al database le 200 storie più recenti e solo dopo toglieva
 * quelle dei negozi fuori vetrina (sospesi, senza insegna, non-negozi). Bastavano 200 storie
 * recenti di autori che non devono comparire, per esempio rimaste da prima della migrazione 404,
 * e il carosello restava vuoto per tutti, comprese le storie vere dei negozi.
 *
 * Qui il carosello si monta con un Supabase finto che risponde come PostgREST e Postgres:
 *  · la catena di chiamate si registra e si esegue solo alla fine, qualunque sia il suo ordine:
 *    PRIMA tutti i filtri (anche quelli su una risorsa agganciata, `alias.colonna`, e l'aggancio
 *    `!inner` che scarta la storia senza negozio), POI l'ordine e il tetto;
 *  · le regole di lettura sono quelle di chi non ha l'account: le storie solo se non scadute;
 *    `profiles` nessuna riga (110, 112, 161); la vista `seller_public_profiles` coi permessi di chi
 *    l'ha creata, solo i negozi approvati, con insegna, di ruolo negozio (126). Agganciare
 *    `profiles` invece della vista spegnerebbe il carosello anche qui;
 *  · l'aggancio storia → negozio esiste per la chiave esterna `seller_stories.seller_id`, anche
 *    verso la vista che espone `profiles.id`; uno sconosciuto risponde PGRST200, come il vero.
 *
 * I dati: le 210 storie più recenti sono di un negozio sospeso, di uno senza insegna e di un
 * cliente; le storie dei negozi veri sono più vecchie. Tagliando prima di filtrare, il carosello
 * è vuoto. Filtrando prima, ci sono i negozi veri, e nessuna storia degli altri.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Riga = Record<string, unknown>;

const mondo = vi.hoisted(() => ({
  profili: [] as Array<Record<string, unknown>>,
  storie: [] as Array<Record<string, unknown>>,
  /** false: il servizio dati non conosce l'aggancio storia → vista (cache dello schema vecchia). */
  agganciAllaVista: true,
}));

vi.mock('@/lib/supabase/client', () => {
  type R = Record<string, unknown>;
  type Filtro = { op: string; colonna: string; valore: unknown; nega: boolean };

  /** Le righe che legge chi non ha l'account. */
  const visibili = (tabella: string): R[] => {
    const adesso = new Date().toISOString();
    if (tabella === 'seller_stories') return mondo.storie.filter((s) => String(s.expires_at) > adesso);
    if (tabella === 'profiles') return [];
    if (tabella === 'seller_public_profiles') {
      return mondo.profili
        .filter((p) => p.is_approved === true && p.store_name != null && p.role === 'seller')
        .map((p) => ({ id: p.id, store_name: p.store_name, store_logo: p.store_logo ?? null, is_approved: p.is_approved, role: p.role }));
    }
    return [];
  };

  /** Gli agganci che il servizio dati conosce: da quale tabella, verso dove, con quale colonna. */
  const aggancio = (da: string, verso: string): string | null => {
    if (da !== 'seller_stories') return null;
    if (verso === 'profiles') return 'seller_id';
    if (verso === 'seller_public_profiles' && mondo.agganciAllaVista) return 'seller_id';
    return null;
  };

  const vale = (riga: R, f: Filtro): boolean => {
    const v = riga[f.colonna];
    let esito: boolean;
    switch (f.op) {
      case 'eq': esito = v === f.valore; break;
      case 'neq': esito = v != null && v !== f.valore; break;
      case 'gt': esito = v != null && String(v) > String(f.valore); break;
      case 'gte': esito = v != null && String(v) >= String(f.valore); break;
      case 'lt': esito = v != null && String(v) < String(f.valore); break;
      case 'lte': esito = v != null && String(v) <= String(f.valore); break;
      case 'in': esito = (f.valore as unknown[]).includes(v); break;
      case 'is': esito = f.valore === null || f.valore === 'null' ? v == null : v === f.valore; break;
      default: throw new Error(`filtro ${f.op} non simulato`);
    }
    return f.nega ? !esito : esito;
  };

  type Voce = { tipo: 'colonna'; nome: string } | { tipo: 'aggancio'; alias: string; verso: string; interno: boolean; colonne: string[] };
  const leggiSelect = (select: string): Voce[] => {
    const pezzi: string[] = [];
    let livello = 0;
    let corrente = '';
    for (const c of select.replace(/\s+/g, ' ')) {
      if (c === '(') livello += 1;
      if (c === ')') livello -= 1;
      if (c === ',' && livello === 0) { pezzi.push(corrente.trim()); corrente = ''; } else corrente += c;
    }
    if (corrente.trim()) pezzi.push(corrente.trim());
    return pezzi.map((p): Voce => {
      const aperta = p.indexOf('(');
      if (aperta < 0) return { tipo: 'colonna', nome: p };
      const testa = p.slice(0, aperta).trim();
      const [alias, resto] = testa.includes(':') ? testa.split(':') : [null, testa];
      const parti = resto.split('!').map((x) => x.trim());
      const colonne = p.slice(aperta + 1, p.lastIndexOf(')')).split(',').map((x) => x.trim()).filter(Boolean);
      return { tipo: 'aggancio', alias: (alias ?? parti[0]).trim(), verso: parti[0], interno: parti.includes('inner'), colonne };
    });
  };

  const domanda = (tabella: string) => {
    let select = '*';
    const filtri: Filtro[] = [];
    const ordini: Array<{ colonna: string; crescente: boolean }> = [];
    let tetto: number | null = null;
    let finestra: [number, number] | null = null;
    const filtro = (op: string, nega = false) => (colonna: string, valore: unknown) => {
      filtri.push({ op, colonna, valore, nega });
      return q;
    };

    const esegui = (): { data: unknown; error: { code: string; message: string } | null } => {
      const voci = leggiSelect(select);
      const agganci = voci.filter((v): v is Extract<Voce, { tipo: 'aggancio' }> => v.tipo === 'aggancio');
      for (const a of agganci) {
        if (!aggancio(tabella, a.verso)) {
          return { data: null, error: { code: 'PGRST200', message: `Could not find a relationship between '${tabella}' and '${a.verso}'` } };
        }
      }
      // ① Prima tutti i filtri: quelli sulla risorsa agganciata decidono l'aggancio, `!inner` scarta
      //    la riga madre senza aggancio; poi quelli sulla tabella.
      let righe: R[] = [];
      for (const r of visibili(tabella)) {
        const riga: R = { ...r };
        let tenuta = true;
        for (const a of agganci) {
          const colonna = aggancio(tabella, a.verso) as string;
          let bersaglio: R | null = visibili(a.verso).find((t) => t.id === r[colonna]) ?? null;
          const suoi = filtri.filter((f) => f.colonna.startsWith(`${a.alias}.`));
          if (bersaglio && !suoi.every((f) => vale(bersaglio as R, { ...f, colonna: f.colonna.slice(a.alias.length + 1) }))) bersaglio = null;
          if (!bersaglio && a.interno) { tenuta = false; break; }
          riga[a.alias] = bersaglio ? Object.fromEntries(a.colonne.map((c) => [c, bersaglio![c] ?? null])) : null;
        }
        if (tenuta) righe.push(riga);
      }
      righe = righe.filter((r) => filtri.filter((f) => !f.colonna.includes('.')).every((f) => vale(r, f)));
      // ② Poi l'ordine e il tetto.
      for (const o of [...ordini].reverse()) {
        righe.sort((x, y) => {
          const a = String(x[o.colonna]);
          const b = String(y[o.colonna]);
          const cmp = a === b ? 0 : a < b ? -1 : 1;
          return o.crescente ? cmp : -cmp;
        });
      }
      if (finestra) righe = righe.slice(finestra[0], finestra[1] + 1);
      if (tetto !== null) righe = righe.slice(0, tetto);
      const colonne = voci.filter((v) => v.tipo === 'colonna').map((v) => (v as { nome: string }).nome);
      const uscita = righe.map((r) => {
        const o: R = {};
        for (const c of colonne) {
          if (c === '*') Object.assign(o, Object.fromEntries(Object.entries(r).filter(([k]) => !agganci.some((a) => a.alias === k))));
          else o[c] = r[c] ?? null;
        }
        for (const a of agganci) o[a.alias] = r[a.alias];
        return o;
      });
      return { data: uscita, error: null };
    };

    const q = {
      select: (s = '*') => { select = s; return q; },
      eq: filtro('eq'),
      neq: filtro('neq'),
      gt: filtro('gt'),
      gte: filtro('gte'),
      lt: filtro('lt'),
      lte: filtro('lte'),
      in: filtro('in'),
      is: filtro('is'),
      not: (colonna: string, op: string, valore: unknown) => { filtri.push({ op, colonna, valore, nega: true }); return q; },
      order: (colonna: string, o?: { ascending?: boolean }) => { ordini.push({ colonna, crescente: o?.ascending !== false }); return q; },
      limit: (n: number) => { tetto = n; return q; },
      range: (da: number, a: number) => { finestra = [da, a]; return q; },
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));
vi.mock('next/image', async () => {
  const { createElement: ce } = await import('react');
  return { default: (p: Record<string, unknown>) => ce('img', { alt: String(p.alt ?? ''), className: p.className as string }) };
});

import StoriesCarousel from '@/components/home/StoriesCarousel';
import { queryKeys } from '@/lib/queries/keys';

const ADESSO = new Date('2026-11-14T12:00:00Z');
const fa = (minuti: number) => new Date(ADESSO.getTime() - minuti * 60_000).toISOString();
const tra = (minuti: number) => new Date(ADESSO.getTime() + minuti * 60_000).toISOString();

const PANE = 'n-pane';
const FIORI = 'n-fiori';
const SOSPESO = 'n-sospeso';
const SENZA_NOME = 'n-senza-nome';
const CLIENTE = 'u-cliente';
const FUORI_VETRINA = [SOSPESO, SENZA_NOME, CLIENTE];

const PROFILI: Riga[] = [
  { id: PANE, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Pane di Ada', store_logo: null },
  { id: FIORI, role: 'seller', is_approved: true, approval_status: 'approved', store_name: 'Fiori di Bea', store_logo: null },
  { id: SOSPESO, role: 'seller', is_approved: false, approval_status: 'suspended', store_name: 'Bottega Sospesa', store_logo: null },
  { id: SENZA_NOME, role: 'seller', is_approved: true, approval_status: 'approved', store_name: null, store_logo: null },
  { id: CLIENTE, role: 'buyer', is_approved: false, approval_status: null, store_name: null, store_logo: null },
];

const storia = (id: string, seller: string, creata: string, scade = tra(600)): Riga => ({
  id, seller_id: seller, image_url: `https://x/${id}.jpg`, caption: null, link_url: null, view_count: 0,
  expires_at: scade, created_at: creata,
});

/** `quante` storie recentissime di autori fuori vetrina, a turno: sospeso, senza insegna, cliente. */
const fuoriVetrina = (quante: number): Riga[] =>
  Array.from({ length: quante }, (_, i) => storia(`cattiva-${i}`, FUORI_VETRINA[i % 3], new Date(ADESSO.getTime() - (i + 1) * 1000).toISOString()));

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

/** Il nome sotto ogni bolla (quello che il cliente legge). */
const bolle = (radice: HTMLElement) => Array.from(radice.querySelectorAll('button')).map((b) => (b.querySelector('span')?.textContent ?? '').trim());
const storieLette = (qc: QueryClient) => (qc.getQueryData(queryKeys.seller.storiesActive) ?? []) as Array<{ id: string; seller_id: string }>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  mondo.profili = PROFILI;
  mondo.agganciAllaVista = true;
});

afterEach(() => {
  for (const r of accesi.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('R16-019 · il carosello filtra i negozi prima di tagliare', () => {
  it('210 storie recenti di un negozio sospeso, di uno senza insegna e di un cliente non svuotano il carosello', async () => {
    mondo.storie = [
      ...fuoriVetrina(210),
      storia('pane-1', PANE, fa(180)),
      storia('fiori-1', FIORI, fa(240)),
      storia('pane-2', PANE, fa(300)),
      // Una storia del negozio vero già scaduta, la più recente di tutte: resta fuori.
      storia('pane-scaduta', PANE, fa(0.001), fa(1)),
    ];
    const { radice, qc } = await accendi();

    expect(bolle(radice), 'il carosello è vuoto: le storie fuori vetrina hanno occupato tutti i posti').toEqual(['Pane di Ada', 'Fiori di Bea']);
    expect(storieLette(qc).map((s) => s.id)).toEqual(['pane-1', 'fiori-1', 'pane-2']);
    expect(radice.textContent ?? '').not.toContain('Bottega Sospesa');
  });

  it('con più di 30 storie vere, i 30 posti vanno alle 30 più recenti dei negozi in vetrina', async () => {
    const vere = Array.from({ length: 40 }, (_, i) => storia(`vera-${i}`, i % 2 ? FIORI : PANE, fa(60 + i)));
    mondo.storie = [...fuoriVetrina(210), ...vere];
    const { radice, qc } = await accendi();

    const lette = storieLette(qc);
    expect(lette.map((s) => s.id)).toEqual(vere.slice(0, 30).map((s) => s.id));
    expect(lette.every((s) => s.seller_id === PANE || s.seller_id === FIORI)).toBe(true);
    expect(bolle(radice)).toEqual(['Pane di Ada', 'Fiori di Bea']);
  });

  it('nessuna storia di un negozio sospeso, senza insegna o di un cliente arriva in home, nemmeno da sola', async () => {
    mondo.storie = fuoriVetrina(12);
    const { radice, qc } = await accendi();

    expect(storieLette(qc)).toEqual([]);
    expect(bolle(radice)).toEqual([]);
  });

  it('se il servizio dati non conosce l\'aggancio alla vista, il carosello resta in piedi e non mostra negozi fuori vetrina', async () => {
    mondo.agganciAllaVista = false;
    mondo.storie = [...fuoriVetrina(20), storia('pane-1', PANE, fa(180)), storia('fiori-1', FIORI, fa(240))];
    const { radice, qc } = await accendi();

    expect(storieLette(qc).map((s) => s.id)).toEqual(['pane-1', 'fiori-1']);
    expect(bolle(radice)).toEqual(['Pane di Ada', 'Fiori di Bea']);
  });
});
