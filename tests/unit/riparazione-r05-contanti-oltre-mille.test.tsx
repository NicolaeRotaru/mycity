// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, contantiDaStripeVuota } from './aiuti/cabina-admin';

/**
 * R05-001 — I contanti vecchi ancora da versare non spariscono dal pannello dei bonifici quando gli
 * ordini consegnati superano mille, e il tasto «Bonifico fatto» li paga davvero.
 *
 * Il finto server fa come quello vero: applica filtri, ordinamenti (anche due di fila) e limite, e
 * non restituisce mai più di mille righe. La finta `segna_bonifico_manuale` guarda gli stessi
 * cancelli della 916: un ordine con un reso aperto fa rifiutare tutto il bonifico (BONIFICO_CAMBIATO).
 * Orologio finto: lunedì 23/11/2026.
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
  // R05-002 (onda 2) — senza la risposta del server i contanti restano «In sospeso»: qui la variabile è vuota.
  vi.stubGlobal('fetch', contantiDaStripeVuota);
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

/** Il contante vecchio (2/8, 18,00 €) e 1.001 contanti più recenti da 9,00 € dall'1/10: 1.002 da versare. */
function contantiOltreMille(): Riga[] {
  const recenti = Array.from({ length: 1001 }, (_, i) =>
    contante(`contante-${String(i).padStart(4, '0')}`, new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(), 900));
  return [contante('contante-vecchio', '2026-08-02T15:00:00.000Z', 1800), ...recenti];
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

async function premiBonificoFatto(host: HTMLElement) {
  vi.stubGlobal('prompt', () => 'TRN-R05');
  const tasto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
  expect(tasto, 'il tasto «Bonifico fatto» non c’è').toBeDefined();
  await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
  return tasto!;
}

describe('R05-001 — oltre le mille righe il contante vecchio resta da versare e si paga', () => {
  it('con 1.001 contanti più recenti, quello del 2/8 entra in «Da versare lunedì» e nel bonifico', async () => {
    stato.tabelle = { orders: contantiOltreMille() };
    const host = await apri();

    // I primi mille consegnati: il 2/8 (18,00) più 999 da 9,00 = 9.009,00, un minimo.
    expect(daVersareLunedi(host)).toMatch(/almeno 9\.?009,00/);
    await premiBonificoFatto(host);
    const ids = stato.chiamate[0]?.p_order_ids ?? [];
    expect(ids, 'il contante vecchio è finito oltre la millesima riga e non si paga').toContain('contante-vecchio');
    expect(ids).toHaveLength(1000);
  });

  it('un ritiro al banco fuori dalla finestra, con un reso aperto, non rientra dai chiusi e non blocca il bonifico', async () => {
    const ritiro: Riga = {
      ...contante('ritiro-col-reso', '2026-11-20T10:00:00.000Z', 1350),
      payout_status: 'CASH_IN_STORE', application_fee_cents: 150,
    };
    stato.tabelle = {
      orders: [...contantiOltreMille(), ritiro],
      returns: [{ order_id: 'ritiro-col-reso', status: 'REQUESTED' }],
      disputes: [],
    };
    const host = await apri();

    // La commissione del ritiro col reso aperto aspetta (916): non si toglie dal lunedì.
    expect(daVersareLunedi(host), 'la commissione di un ritiro col reso aperto è stata tolta dal bonifico').toMatch(/almeno 9\.?009,00/);
    await premiBonificoFatto(host);
    const chiamata = stato.chiamate[0];
    expect(chiamata?.p_order_ids ?? []).toContain('contante-vecchio');
    expect(chiamata?.p_ritiri ?? [], 'il ritiro col reso aperto è entrato nel bonifico: la 916 lo rifiuta tutto').not.toContain('ritiro-col-reso');
    expect(host.textContent, 'il bonifico dei contanti vecchi resta bloccato finché il reso è aperto').toContain('Segnati 1000 ordini come pagati.');
  });
});
