// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, contantiDaStripeVuota } from './aiuti/cabina-admin';

/**
 * R22-003 (giro di correzione) — Il bonifico a mano ai negozi resta scritto, e quello che ne segue si vede.
 *
 *  · Un contante già versato a mano e poi rimborsato al cliente (reso entro 14 giorni, bonifico il lunedì
 *    prima): il bonifico è partito, la quota non si toglie più da un bonifico futuro. La pagina dice per
 *    negozio «Da recuperare dal negozio», anche per un negozio senza ordini in elenco.
 *  · Un ritiro al banco con un reso aperto, un reclamo interno aperto o rimborsato in parte non si
 *    regola: la sua commissione non entra nel bonifico (la 916 lo rifiuterebbe).
 *  · Il secondo clic con un altro CRO: la funzione dice il CRO già scritto, e la pagina lo mostra.
 * Orologio finto: lunedì 23/11/2026 (settimana prima: 16-22/11, ora di Roma).
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Record<string, unknown>[],
  manuali: [] as Record<string, unknown>[],
  recuperi: [] as Record<string, unknown>[],
  resi: [] as Record<string, unknown>[],
  risposta: null as null | { message: string },
  chiamate: [] as Record<string, unknown>[],
  letture: [] as string[],
  recuperiLancia: false,
}));

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
  const val = resto.slice(p2 + 1);
  const base = (r: Riga): boolean => {
    const v = r[col];
    switch (op) {
      case 'eq': return v !== null && v !== undefined && String(v) === val;
      case 'is': return val === 'null' ? v === null || v === undefined : String(v) === val;
      case 'in': return v !== null && v !== undefined && val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
      default: throw new Error(`operatore non previsto dal finto server: ${op}`);
    }
  };
  return nega ? (r) => (op === 'is' ? !base(r) : r[col] !== null && r[col] !== undefined && !base(r)) : base;
}

function tabella(nome: string) {
  const filtri: Array<(r: Riga) => boolean> = [];
  let ordine: { col: string; asc: boolean } | null = null;
  let limite = Infinity;
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filtri.push(condizione(`${c}.eq.${String(v)}`)); return b; },
    is: (c: string, v: unknown) => { filtri.push(condizione(`${c}.is.${String(v)}`)); return b; },
    in: (c: string, v: unknown[]) => { filtri.push(condizione(`${c}.in.(${v.join(',')})`)); return b; },
    not: (c: string, op: string, v: unknown) => { filtri.push(condizione(`${c}.not.${op}.${String(v)}`)); return b; },
    or: (s: string) => { filtri.push(condizione(`or(${s})`)); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { ordine = { col: c, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let righe = (nome === 'orders' ? stato.ordini : nome === 'returns' ? stato.resi : []).filter((r) => filtri.every((f) => f(r)));
      const totale = righe.length;
      if (ordine) {
        const { col, asc } = ordine;
        righe = [...righe].sort((x, y) => (asc ? 1 : -1) * String(x[col] ?? '').localeCompare(String(y[col] ?? '')));
      }
      righe = righe.slice(0, Math.min(limite, 1000));
      return Promise.resolve({ data: righe, error: null, count: totale }).then(ok, ko);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => tabella(t),
    rpc: vi.fn(async (n: string, args: Record<string, unknown>) => {
      stato.letture.push(n);
      if (n === 'bonifici_manuali_per_mese') return { data: stato.manuali, error: null };
      if (n === 'contanti_da_recuperare') {
        if (stato.recuperiLancia) throw new Error('rete giù');
        return { data: stato.recuperi, error: null };
      }
      stato.chiamate.push({ n, ...args });
      if (stato.risposta) return { data: null, error: stato.risposta };
      return { data: (args.p_order_ids as string[]).length, error: null };
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
  stato.manuali = [];
  stato.recuperi = [];
  stato.letture = [];
  stato.recuperiLancia = false;
  stato.resi = [];
  stato.risposta = null;
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const forno = { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' };
const ordine = (id: string, extra: Riga): Riga => ({
  id, seller_id: 'forno', total_price: 20, seller_payout_cents: 1800, seller_payout_reversed_cents: 0, application_fee_cents: 200,
  dispute_status: null, internal_dispute_status: null, payment_status: 'PAID',
  payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
  payment_method: 'cod', created_at: '2026-11-18T09:00:00Z', delivered_at: '2026-11-18T15:00:00Z',
  seller: forno, ...extra,
});
const contante = (id: string, netto: number, giorno: string, extra: Riga = {}) =>
  ordine(id, { seller_payout_cents: netto, created_at: `${giorno}T09:00:00Z`, delivered_at: `${giorno}T15:00:00Z`, ...extra });
const ritiro = (id: string, commissione: number, giorno: string, extra: Riga = {}) =>
  ordine(id, {
    payout_status: 'CASH_IN_STORE', application_fee_cents: commissione, seller_payout_cents: commissione * 9,
    created_at: `${giorno}T09:00:00Z`, delivered_at: `${giorno}T15:00:00Z`, ...extra,
  });

async function apri() {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  return r.host;
}

function bloccoDi(host: HTMLElement, negozio: string): HTMLElement {
  const nome = Array.from(host.querySelectorAll('p')).find((p) => p.textContent === negozio);
  return nome!.closest('div.overflow-hidden') as HTMLElement;
}
function daVersareLunedi(blocco: HTMLElement): string {
  const etichetta = Array.from(blocco.querySelectorAll('p')).find((p) => p.textContent === 'Da versare lunedì');
  return etichetta?.nextElementSibling?.textContent ?? '';
}
const tastoIn = (blocco: HTMLElement) => blocco.querySelector('button') as HTMLButtonElement | null;
async function premi(tasto: HTMLButtonElement) {
  await act(async () => { tasto.click(); await new Promise((ok) => setTimeout(ok, 20)); });
}

describe('R22-003 — dopo il bonifico a mano: quote da recuperare, ritiri fermi, secondo clic', () => {
  it('un contante versato a mano e poi rimborsato: «Da recuperare dal negozio», anche per chi non ha ordini in elenco', async () => {
    stato.ordini = [contante('c1', 1800, '2026-11-18', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-16T08:00:00Z', seller_payout_reversed_cents: 450 })];
    stato.recuperi = [
      { order_id: 'c1', seller_id: 'forno', store_name: 'Pane Quotidiano', da_recuperare_cents: 450 },
      { order_id: 'b7', seller_id: 'bottega', store_name: 'Bottega Verde', da_recuperare_cents: 1800 },
    ];
    const host = await apri();
    expect(bloccoDi(host, 'Pane Quotidiano').textContent, 'la quota rimborsata dopo il bonifico resta invisibile')
      .toMatch(/Da recuperare dal negozio: 4,50\s*€ \(1 ordine rimborsato dopo il bonifico a mano\)/);
    const bottega = bloccoDi(host, 'Bottega Verde');
    expect(bottega, 'un negozio con solo una quota da recuperare non compare').toBeTruthy();
    expect(bottega.textContent).toMatch(/Da recuperare dal negozio: 18,00\s*€/);
    expect(daVersareLunedi(bottega), 'la quota da recuperare non si toglie dal lunedì').toMatch(/0,00/);
  });

  it('un ritiro con un reso, un reclamo interno o un rimborso parziale non si regola: la commissione aspetta', async () => {
    stato.ordini = [
      contante('c1', 1800, '2026-11-18'),
      ritiro('r1', 200, '2026-11-19'),
      ritiro('r2', 300, '2026-11-19'),
      ritiro('r3', 400, '2026-11-19', { internal_dispute_status: 'OPEN' }),
      ritiro('r4', 500, '2026-11-19', { payment_status: 'PARTIALLY_REFUNDED' }),
    ];
    stato.resi = [{ order_id: 'r2', status: 'REQUESTED' }];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(daVersareLunedi(blocco), 'si trattiene la commissione di ritiri fermi').toMatch(/16,00/);
    const tasto = tastoIn(blocco);
    vi.stubGlobal('prompt', vi.fn(() => 'CRO-0099887766'));
    await premi(tasto!);
    expect(stato.chiamate[0]).toMatchObject({ n: 'segna_bonifico_manuale', p_ritiri: ['r1'], p_importo_cents: 1600 });
  });

  it('il secondo clic con un altro CRO: la pagina dice il CRO già scritto', async () => {
    stato.ordini = [contante('c1', 1800, '2026-11-18')];
    stato.risposta = { message: 'BONIFICO_GIA_SEGNATO: questo bonifico è già scritto col riferimento CRO-PRIMO e 1800 centesimi' };
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    vi.stubGlobal('prompt', vi.fn(() => 'CRO-SECONDO'));
    await premi(tastoIn(blocco)!);
    expect(host.textContent, 'la risposta della funzione si perde in un «riprova»').toMatch(/già scritto col riferimento CRO-PRIMO/);
    expect(host.textContent).not.toMatch(/Non sono riuscito a segnarlo/);
  });
});

describe('R22-003 (giro corto) — le quote da recuperare si leggono solo se c\'è un bonifico a mano, e non fanno cadere la pagina', () => {
  it('senza bonifici a mano la lettura non parte: la prima chiamata al server è il bonifico', async () => {
    stato.ordini = [contante('c1', 1800, '2026-11-18')];
    const host = await apri();
    vi.stubGlobal('prompt', vi.fn(() => 'CRO-0011223344'));
    await premi(tastoIn(bloccoDi(host, 'Pane Quotidiano'))!);
    expect(stato.letture, 'la pagina legge le quote da recuperare senza un bonifico a mano').not.toContain('contanti_da_recuperare');
    expect(stato.letture[0]).toBe('segna_bonifico_manuale');
  });

  it('con un contante versato a mano la lettura parte; esito strano o eccezione: l\'avviso, mai una pagina rotta', async () => {
    const versato = () => [contante('c1', 1800, '2026-11-18', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-16T08:00:00Z' })];
    stato.ordini = versato();
    stato.recuperi = { da_recuperare_cents: 450 } as unknown as Record<string, unknown>[];
    let host = await apri();
    expect(stato.letture).toContain('contanti_da_recuperare');
    expect(host.textContent).toMatch(/Non riesco a leggere i contanti da recuperare/);
    chiudi?.();
    chiudi = null;

    stato.ordini = versato();
    stato.recuperiLancia = true;
    host = await apri();
    expect(host.textContent, 'un\'eccezione nella lettura fa cadere la pagina').toMatch(/Pane Quotidiano/);
    expect(host.textContent).toMatch(/Non riesco a leggere i contanti da recuperare/);
  });
});
