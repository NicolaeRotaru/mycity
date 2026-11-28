// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { disegna } from './aiuti/cabina-admin';

/**
 * Il pannello dei bonifici dice onestamente quando un suo elenco è tagliato.
 *
 * Con 1.200 ordini già pagati (TRANSFERRED) la lettura dei chiusi si ferma a mille: l'elenco dei
 * pagati si accorciava senza avviso (solo un «almeno» sulla cifra). E l'avviso degli aperti
 * tagliati parlava di «bonifico ancora aperto» anche quando a riempirli erano ritiri al banco da
 * regolare, che un bonifico non ce l'hanno. Finto server della prova sui contanti oltre mille,
 * orologio finto: lunedì 23/11/2026.
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Record<string, unknown>[]>,
  chiamate: [] as { p_order_ids: string[]; p_ritiri: string[]; p_importo_cents: number }[],
}));

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

/** Un filtro di PostgREST (`colonna.operatore.valore`, `and(...)`, `or(...)`) come funzione. */
function condizione(expr: string): (r: Riga) => boolean {
  const e = expr.trim();
  const logico = /^(and|or)\((.*)\)$/.exec(e);
  if (logico) {
    const parti = spezza(logico[2]).map(condizione);
    return logico[1] === 'and' ? (r) => parti.every((c) => c(r)) : (r) => parti.some((c) => c(r));
  }
  const punto = e.indexOf('.');
  const col = e.slice(0, punto);
  let resto = e.slice(punto + 1);
  const nega = resto.startsWith('not.');
  if (nega) resto = resto.slice(4);
  const p2 = resto.indexOf('.');
  const op = resto.slice(0, p2);
  const val = resto.slice(p2 + 1);
  const base = (r: Riga): boolean => {
    const v = r[col];
    switch (op) {
      case 'eq': return v !== null && v !== undefined && String(v) === val;
      case 'neq': return v !== null && v !== undefined && String(v) !== val;
      case 'is': return val === 'null' ? v === null || v === undefined : String(v) === val;
      case 'in': {
        if (v === null || v === undefined) return false;
        return val.replace(/^\(/, '').replace(/\)$/, '').split(',').map((x) => x.trim()).includes(String(v));
      }
      default: throw new Error(`operatore non previsto dal finto server: ${op}`);
    }
  };
  // Come SQL: un confronto con NULL non è vero, nemmeno negato (salvo «is»).
  return nega ? (r) => (op === 'is' ? !base(r) : r[col] !== null && r[col] !== undefined && !base(r)) : base;
}

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  const ordini: { col: string; asc: boolean }[] = [];
  let limite = Infinity;
  let conta = false;
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { count?: string }) => { conta = !!o?.count; return b; },
    eq: (c: string, v: unknown) => { filtri.push(condizione(`${c}.eq.${String(v)}`)); return b; },
    is: (c: string, v: unknown) => { filtri.push(condizione(`${c}.is.${String(v)}`)); return b; },
    in: (c: string, v: unknown[]) => { filtri.push(condizione(`${c}.in.(${v.join(',')})`)); return b; },
    not: (c: string, op: string, v: unknown) => { filtri.push(condizione(`${c}.not.${op}.${String(v)}`)); return b; },
    or: (s: string) => { filtri.push(condizione(`or(${s})`)); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { ordini.push({ col: c, asc: o?.ascending !== false }); return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let righe = (stato.tabelle[nome] ?? []).filter((r) => filtri.every((f) => f(r)));
      const totale = righe.length;
      righe = [...righe].sort((x, y) => {
        for (const { col, asc } of ordini) {
          const d = String(x[col] ?? '').localeCompare(String(y[col] ?? ''));
          if (d !== 0) return asc ? d : -d;
        }
        return 0;
      });
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

/** Gli stessi cancelli della 916: reso o reclamo aperto, stato giusto, e la cifra uguale. */
function segnaBonificoManuale(args: { p_order_ids: string[]; p_ritiri: string[]; p_importo_cents: number }) {
  const ordini = new Map((stato.tabelle.orders ?? []).map((o) => [o.id as string, o]));
  const aperto = (id: string) =>
    (stato.tabelle.returns ?? []).some((r) => r.order_id === id && ['REQUESTED', 'APPROVED', 'SHIPPED_BACK', 'RECEIVED'].includes(r.status as string)) ||
    (stato.tabelle.disputes ?? []).some((d) => d.order_id === id && ['open', 'under_review'].includes(d.status as string));
  const contanti = args.p_order_ids.map((id) => ordini.get(id)).filter((o) => o && o.payout_status === 'HELD' && o.payment_method === 'cod' && !aperto(o.id as string));
  const ritiri = (args.p_ritiri ?? []).map((id) => ordini.get(id)).filter((o) => o && o.payout_status === 'CASH_IN_STORE' && !o.payout_at && !aperto(o.id as string));
  if (contanti.length !== args.p_order_ids.length || ritiri.length !== (args.p_ritiri ?? []).length) {
    return { data: null, error: { message: 'BONIFICO_CAMBIATO: ordini non più da segnare' } };
  }
  const contantiCents = contanti.reduce((s, o) => s + Number(o!.seller_payout_cents), 0);
  const commissione = ritiri.reduce((s, o) => s + Number(o!.application_fee_cents ?? 0), 0);
  const importo = contantiCents - Math.min(contantiCents, commissione);
  if (args.p_importo_cents !== importo) return { data: null, error: { message: `BONIFICO_CAMBIATO: la cifra è ${importo}` } };
  return { data: contanti.length, error: null };
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => tabella(t),
    rpc: vi.fn(async (nome: string, args: { p_order_ids: string[]; p_ritiri: string[]; p_importo_cents: number }) => {
      if (nome !== 'segna_bonifico_manuale') return { data: [], error: null };
      stato.chiamate.push(args);
      return segnaBonificoManuale(args);
    }),
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  stato.chiamate = [];
  stato.tabelle = {};
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const negozio = { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' };
const contante = (id: string, quando: string, cents: number): Riga => ({
  id, seller_id: 'forno', total_price: cents / 100, seller_payout_cents: cents, seller_payout_reversed_cents: 0,
  application_fee_cents: 100, wallet_applied_cents: 0, dispute_status: null, internal_dispute_status: null,
  payment_status: 'PAID', payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: quando, delivered_at: quando, seller: negozio,
});

async function apri() {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function avviso(host: HTMLElement): string {
  return Array.from(host.querySelectorAll('[role="status"]')).map((e) => e.textContent ?? '').join(' | ');
}

describe('gli elenchi tagliati del pannello dei bonifici si dicono', () => {
  it('1.200 ordini già pagati: l’avviso dice che l’elenco dei chiusi è tagliato', async () => {
    stato.tabelle = {
      orders: Array.from({ length: 1200 }, (_, i) => ({
        ...contante(`pagato-${String(i).padStart(4, '0')}`, new Date(Date.UTC(2026, 7, 1) + i * 3_600_000).toISOString(), 900),
        payment_method: 'card', payout_status: 'TRANSFERRED', payout_at: '2026-11-01T10:00:00.000Z', stripe_transfer_id: `tr_${i}`,
      })),
    };
    const host = await apri();
    expect(avviso(host), 'l’elenco dei pagati si è fermato a mille senza dirlo').toMatch(/già chiusi oltre 1000/);
  });

  it('1.001 ritiri al banco da regolare: l’avviso non parla di «bonifico ancora aperto»', async () => {
    stato.tabelle = {
      orders: Array.from({ length: 1001 }, (_, i) => ({
        ...contante(`ritiro-${String(i).padStart(4, '0')}`, new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), 900),
        payout_status: 'CASH_IN_STORE',
      })),
      returns: [],
      disputes: [],
    };
    const host = await apri();
    const testo = avviso(host);
    expect(testo).toMatch(/Elenco tagliato/);
    expect(testo, 'i ritiri al banco non hanno un bonifico aperto').not.toMatch(/col bonifico ancora aperto/);
    expect(testo).toMatch(/ritiro al banco da regolare/);
  });

  it('pochi ordini: nessun avviso di elenco tagliato', async () => {
    stato.tabelle = { orders: [contante('c1', '2026-11-20T09:00:00.000Z', 2000)], returns: [], disputes: [] };
    const host = await apri();
    expect(avviso(host)).not.toMatch(/tagliato|oltre 1000/);
  });
});
