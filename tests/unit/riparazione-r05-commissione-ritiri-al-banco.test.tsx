// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * R05-002 — Il bonifico del lunedì toglie il 10% dei ritiri pagati al banco.
 *
 * Registro dei fatti, ritiro.in-negozio: «sui contanti al banco il 10% di MyCity si compensa sul
 * bonifico del lunedì al negozio; se in una settimana non basta, il resto va nella fattura del mese».
 * Il pannello lasciava i ritiri al banco (CASH_IN_STORE) fuori da tutto: la cifra da versare era
 * troppo alta. Il finto server applica filtri, ordinamento e limite come quello vero (max-rows 1000).
 * Orologio finto: lunedì 23/11/2026, la settimana prima va dal 16 al 22.
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({ ordini: [] as Record<string, unknown>[], chiamate: [] as unknown[] }));

const MAX_RIGHE = 1000;

/** Divide alle virgole di primo livello: quelle dentro le parentesi restano insieme. */
function spezza(s: string): string[] {
  const pezzi: string[] = [];
  let p = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') p++;
    if (ch === ')') p--;
    if (ch === ',' && p === 0) { pezzi.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) pezzi.push(cur);
  return pezzi.map((x) => x.trim());
}

const togliVirgolette = (v: string) => v.replace(/^"(.*)"$/, '$1');
function confronta(a: unknown, b: string): number {
  const sa = String(a);
  if (/^\d{4}-\d{2}-\d{2}/.test(sa) && /^\d{4}-\d{2}-\d{2}/.test(b)) return Date.parse(sa) - Date.parse(b);
  if (typeof a === 'number') return a - Number(b);
  return sa < b ? -1 : sa > b ? 1 : 0;
}

/** Un filtro di PostgREST (`colonna.operatore.valore`, `and(...)`, `or(...)`) come funzione. */
function condizione(expr: string): (r: Riga) => boolean {
  const e = expr.trim();
  const logico = /^(not\.)?(and|or)\((.*)\)$/.exec(e);
  if (logico) {
    const parti = spezza(logico[3]).map(condizione);
    const f = logico[2] === 'and' ? (r: Riga) => parti.every((c) => c(r)) : (r: Riga) => parti.some((c) => c(r));
    return logico[1] ? (r) => !f(r) : f;
  }
  const punto = e.indexOf('.');
  const col = e.slice(0, punto);
  let resto = e.slice(punto + 1);
  const nega = resto.startsWith('not.');
  if (nega) resto = resto.slice(4);
  const p2 = resto.indexOf('.');
  const op = resto.slice(0, p2);
  const val = togliVirgolette(resto.slice(p2 + 1));
  const base = (r: Riga): boolean => {
    const v = r[col];
    switch (op) {
      case 'eq': return v !== null && v !== undefined && String(v) === val;
      case 'neq': return v !== null && v !== undefined && String(v) !== val;
      case 'is': return val === 'null' ? v === null || v === undefined : String(v) === val;
      case 'in': {
        if (v === null || v === undefined) return false;
        const lista = val.replace(/^\(/, '').replace(/\)$/, '').split(',').map((x) => togliVirgolette(x.trim()));
        return lista.includes(String(v));
      }
      case 'gt': return v !== null && v !== undefined && confronta(v, val) > 0;
      case 'gte': return v !== null && v !== undefined && confronta(v, val) >= 0;
      case 'lt': return v !== null && v !== undefined && confronta(v, val) < 0;
      case 'lte': return v !== null && v !== undefined && confronta(v, val) <= 0;
      default: throw new Error(`operatore non previsto dal finto server: ${op}`);
    }
  };
  // Come SQL: un confronto con NULL non è vero, nemmeno negato (salvo «is»).
  return nega
    ? (r) => (op === 'is' ? !base(r) : r[col] !== null && r[col] !== undefined && !base(r))
    : base;
}

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let ordine: { col: string; asc: boolean } | null = null;
  let limite = Infinity;
  let conta = false;
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string }) => { conta = !!o?.count; return b; },
    eq: (c: string, v: unknown) => { filtri.push(condizione(`${c}.eq.${String(v)}`)); return b; },
    neq: (c: string, v: unknown) => { filtri.push(condizione(`${c}.neq.${String(v)}`)); return b; },
    is: (c: string, v: unknown) => { filtri.push(condizione(`${c}.is.${String(v)}`)); return b; },
    in: (c: string, v: unknown[]) => { filtri.push(condizione(`${c}.in.(${v.join(',')})`)); return b; },
    gt: (c: string, v: unknown) => { filtri.push(condizione(`${c}.gt.${String(v)}`)); return b; },
    gte: (c: string, v: unknown) => { filtri.push(condizione(`${c}.gte.${String(v)}`)); return b; },
    lt: (c: string, v: unknown) => { filtri.push(condizione(`${c}.lt.${String(v)}`)); return b; },
    lte: (c: string, v: unknown) => { filtri.push(condizione(`${c}.lte.${String(v)}`)); return b; },
    not: (c: string, op: string, v: unknown) => { filtri.push(condizione(`${c}.not.${op}.${String(v)}`)); return b; },
    or: (s: string) => { filtri.push(condizione(`or(${s})`)); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { ordine = { col: c, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      const tutte = nome === 'orders' ? stato.ordini : [];
      let righe = tutte.filter((r) => filtri.every((f) => f(r)));
      const totale = righe.length;
      if (ordine) {
        const { col, asc } = ordine;
        righe = [...righe].sort((x, y) => (asc ? 1 : -1) * String(x[col] ?? '').localeCompare(String(y[col] ?? '')));
      }
      righe = righe.slice(0, Math.min(limite, MAX_RIGHE));
      return Promise.resolve({ data: righe, error: null, count: conta ? totale : null }).then(ok, ko);
    },
  };
  return new Proxy(b, {
    get: (t, k) => {
      if (typeof k === 'symbol' || k in t) return (t as Record<string | symbol, unknown>)[k];
      throw new Error(`metodo non previsto dal finto server: ${String(k)}`);
    },
  });
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => tabella(t),
    rpc: vi.fn(async (_n: string, args: { p_order_ids: string[] }) => {
      stato.chiamate.push(args);
      return { data: args.p_order_ids.length, error: null };
    }),
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
let richieste: string[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  stato.chiamate = [];
  richieste = [];
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const negozio = { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' };
const ordine = (id: string, extra: Riga): Riga => ({
  id, seller_id: 'forno', total_price: 20, seller_payout_cents: 1800, seller_payout_reversed_cents: 0, application_fee_cents: 200,
  dispute_status: null, internal_dispute_status: null, payment_status: 'PAID',
  payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: '2026-11-18T09:00:00Z', delivered_at: '2026-11-18T10:00:00Z',
  seller: negozio, ...extra,
});
const contante = (id: string, consegnato: string, netto: number, extra: Riga = {}) =>
  ordine(id, { delivered_at: consegnato, created_at: consegnato, seller_payout_cents: netto, ...extra });
const alBanco = (id: string, ritirato: string, commissione: number, extra: Riga = {}) =>
  ordine(id, { payout_status: 'CASH_IN_STORE', delivered_at: ritirato, created_at: ritirato, application_fee_cents: commissione, ...extra });

/** Bonifici con la carta già pagati, per riempire i chiusi oltre il tetto. */
function giaPagati(n: number): Riga[] {
  return Array.from({ length: n }, (_, i) => {
    const giorno = new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString();
    return ordine(`pagato-${i}`, {
      payment_method: 'card', payout_status: 'TRANSFERRED', payout_at: giorno, stripe_transfer_id: 'tr_x',
      seller_payout_cents: 900, created_at: giorno, delivered_at: giorno,
    });
  });
}

async function apri() {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function daVersareLunedi(host: HTMLElement): string {
  const etichetta = Array.from(host.querySelectorAll('p')).find((p) => p.textContent === 'Da versare lunedì');
  return etichetta?.nextElementSibling?.textContent ?? '';
}

describe('R05-002 — il 10% dei ritiri pagati al banco si scala dal bonifico del lunedì', () => {
  it('la cifra del lunedì e il tasto tolgono la commissione dei ritiri al banco della settimana prima', async () => {
    stato.ordini = [
      ...giaPagati(1200),
      contante('h1', '2026-11-18T10:00:00Z', 1800),
      contante('h2', '2026-11-20T10:00:00Z', 1350),
      // Ordinato il 1° settembre e ritirato il 19 novembre: più vecchio dei mille chiusi letti, conta lo stesso.
      alBanco('b1', '2026-11-19T10:00:00Z', 200, { created_at: '2026-09-01T09:00:00Z' }),
      alBanco('b2', '2026-11-21T10:00:00Z', 150),
      alBanco('b0', '2026-11-10T10:00:00Z', 500), // settimana di prima: già compensata il 16
      alBanco('b3', '2026-11-23T07:00:00Z', 300), // questa settimana: si scala lunedì prossimo
    ];
    const host = await apri();

    expect(daVersareLunedi(host), '31,50 € di contanti meno 3,50 € di commissione sui ritiri al banco').toMatch(/28,00/);
    const riquadri = Array.from(host.querySelectorAll('p.text-\\[26px\\]')).map((p) => p.textContent ?? '');
    expect(riquadri[0], 'il riquadro dei contanti da versare ignora la commissione da scalare').toMatch(/28,00/);
    expect(host.textContent).toMatch(/già tolti 3,50\s*€ di commissione sui ritiri pagati al banco/);

    vi.stubGlobal('prompt', (testo: string) => { richieste.push(testo); return 'TRN-R05'; });
    const tasto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
    expect(tasto!.textContent, 'il tasto propone il bonifico senza togliere la commissione').toMatch(/28,00/);
    await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
    expect(richieste[0]).toMatch(/28,00/);
    expect(richieste[0]).toMatch(/3,50/);
    expect([...(stato.chiamate[0] as { p_order_ids: string[] }).p_order_ids].sort()).toEqual(['h1', 'h2']);
  });

  it('se la commissione supera i contanti, il bonifico è zero e il resto va nella fattura del mese', async () => {
    stato.ordini = [
      contante('h1', '2026-11-18T10:00:00Z', 300),
      alBanco('b1', '2026-11-19T10:00:00Z', 500),
    ];
    const host = await apri();
    expect(daVersareLunedi(host)).toMatch(/^0,00/);
    expect(host.textContent).toMatch(/2,00\s*€ di commissione sui ritiri pagati al banco non ci stanno nel bonifico: vanno nella fattura del mese/);
  });

  it('a bonifico del lunedì già segnato la commissione non si toglie una seconda volta', async () => {
    stato.ordini = [
      ordine('p1', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-23T07:30:00Z', delivered_at: '2026-11-18T10:00:00Z' }),
      contante('tardi', '2026-11-21T10:00:00Z', 1350), // rimessa confermata dopo il bonifico
      alBanco('b1', '2026-11-19T10:00:00Z', 200),
    ];
    const host = await apri();
    expect(daVersareLunedi(host), 'la commissione era già nel bonifico di stamattina').toMatch(/13,50/);
  });
});
