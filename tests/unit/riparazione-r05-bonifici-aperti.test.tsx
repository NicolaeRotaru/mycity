// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, contantiDaStripeVuota } from './aiuti/cabina-admin';

/**
 * R05-001 — I contanti vecchi ancora da versare non spariscono dal pannello dei bonifici.
 *
 * La lettura prendeva gli ultimi mille ordini consegnati compresi quelli già pagati, che crescono
 * sempre: un contante HELD più vecchio della millesima riga non entrava né in «Da versare lunedì»
 * né nel tasto «Bonifico fatto». Qui il finto server fa come quello vero: applica i filtri,
 * l'ordinamento e il limite, e non restituisce mai più di mille righe (max-rows).
 * Orologio finto: lunedì 23/11/2026.
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
beforeEach(() => {
  // R05-002 (onda 2) — senza la risposta del server i contanti restano «In sospeso»: qui la variabile è vuota.
  vi.stubGlobal('fetch', contantiDaStripeVuota);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  stato.chiamate = [];
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const negozio = { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' };
const ordine = (id: string, extra: Riga): Riga => ({
  id, seller_id: 'forno', total_price: 10, seller_payout_cents: 900, seller_payout_reversed_cents: 0,
  dispute_status: null, internal_dispute_status: null, payment_status: 'PAID',
  payout_status: 'TRANSFERRED', payout_at: '2026-11-20T10:00:00Z', stripe_transfer_id: 'tr_x', delivery_status: 'DELIVERED',
  payment_method: 'card', created_at: '2026-11-01T09:00:00Z', delivered_at: '2026-11-01T15:00:00Z',
  seller: negozio, ...extra,
});

/** 1.200 bonifici già pagati, tutti più recenti del contante da versare. */
function giaPagati(n: number): Riga[] {
  return Array.from({ length: n }, (_, i) => {
    const giorno = new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString();
    return ordine(`pagato-${i}`, { created_at: giorno, delivered_at: giorno });
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

describe('R05-001 — il contante vecchio da versare resta nel pannello oltre le mille righe', () => {
  it('un HELD più vecchio di 1.200 bonifici pagati entra in «Da versare lunedì» e nel bonifico', async () => {
    stato.ordini = [
      ...giaPagati(1200),
      ordine('contante-vecchio', {
        payment_method: 'cod', payout_status: 'HELD', payout_at: null, stripe_transfer_id: null,
        seller_payout_cents: 1800, created_at: '2026-08-01T09:00:00Z', delivered_at: '2026-08-02T15:00:00Z',
      }),
    ];
    const host = await apri();

    expect(daVersareLunedi(host), 'il contante da versare è finito oltre la millesima riga e sparisce').toMatch(/18,00/);

    vi.stubGlobal('prompt', () => 'TRN-R05');
    const tasto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
    expect(tasto, 'senza il contante vecchio il tasto «Bonifico fatto» non c’è').toBeDefined();
    expect(tasto!.textContent).toMatch(/18,00/);
    await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
    expect((stato.chiamate[0] as { p_order_ids: string[] }).p_order_ids).toEqual(['contante-vecchio']);
  });

  it('i bonifici già pagati restano contati in «Già pagato», come un minimo quando sono oltre il tetto', async () => {
    stato.ordini = giaPagati(1200);
    const host = await apri();
    const riquadri = Array.from(host.querySelectorAll('p.text-\\[26px\\]')).map((p) => p.textContent ?? '');
    expect(riquadri[2], '«Già pagato» non conta più i bonifici fatti').toMatch(/almeno 9\.?000,00/);
  });
});
