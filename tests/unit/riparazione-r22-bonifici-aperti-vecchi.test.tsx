// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, contantiDaStripeVuota } from './aiuti/cabina-admin';

/**
 * R22-001 — I contanti vecchi ancora da versare non spariscono dal pannello dei bonifici quando gli
 * ordini aperti superano mille.
 *
 * Gli aperti si leggevano dal più recente e se ne tenevano mille: oltre il tetto restavano fuori
 * proprio i contanti più vecchi, cioè quelli da versare da più tempo, e il tasto «Bonifico fatto»
 * non li segnava. E gli storni non riusciti (REVERSAL_FAILED), fuori dai totali, prendevano posto
 * fra gli aperti. Gli aperti restano letti dal più recente: i contanti da versare hanno la loro lettura
 * (dal consegnato prima), e l'avviso «Mancano i più vecchi» vale per le righe ferme. Il finto server applica filtri, ordinamento e limite (mille righe) come quello vero.
 * Orologio finto: lunedì 23/11/2026.
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  ordini: [] as Record<string, unknown>[],
  manuali: [] as Record<string, unknown>[],
  chiamate: [] as Record<string, unknown>[],
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
  const ordine: { col: string; asc: boolean }[] = [];
  let limite = Infinity;
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { filtri.push(condizione(`${c}.eq.${String(v)}`)); return b; },
    is: (c: string, v: unknown) => { filtri.push(condizione(`${c}.is.${String(v)}`)); return b; },
    in: (c: string, v: unknown[]) => { filtri.push(condizione(`${c}.in.(${v.join(',')})`)); return b; },
    not: (c: string, op: string, v: unknown) => { filtri.push(condizione(`${c}.not.${op}.${String(v)}`)); return b; },
    or: (s: string) => { filtri.push(condizione(`or(${s})`)); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { ordine.push({ col: c, asc: o?.ascending !== false }); return b; },
    limit: (n: number) => { limite = n; return b; },
    then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      let righe = (nome === 'orders' ? stato.ordini : []).filter((r) => filtri.every((f) => f(r)));
      const totale = righe.length;
      // Come PostgREST: più ordinamenti uno dopo l'altro (il secondo decide i pari del primo).
      righe = [...righe].sort((x, y) => {
        for (const { col, asc } of ordine) {
          const d = (asc ? 1 : -1) * String(x[col] ?? '').localeCompare(String(y[col] ?? ''));
          if (d !== 0) return d;
        }
        return 0;
      });
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
      if (n === 'bonifici_manuali_per_mese') return { data: stato.manuali, error: null };
      if (n === 'contanti_da_recuperare') return { data: [], error: null };
      stato.chiamate.push({ n, ...args });
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

/** `n` ordini da 9,00 €, uno all'ora a partire da `dal`. */
function tanti(n: number, prefisso: string, dal: string, extra: Riga): Riga[] {
  return Array.from({ length: n }, (_, i) => {
    const quando = new Date(Date.parse(dal) + i * 3_600_000).toISOString();
    return ordine(`${prefisso}-${i}`, { seller_payout_cents: 900, created_at: quando, delivered_at: quando, ...extra });
  });
}

describe('R22-001 — il contante vecchio da versare resta nel pannello oltre i mille aperti', () => {
  it('1.001 contanti da versare dall\'1/10 e uno del 2/8: quello del 2/8 entra nel lunedì e nel bonifico', async () => {
    stato.ordini = [
      ...tanti(1001, 'recente', '2026-10-01T09:00:00Z', {}),
      contante('contante-vecchio', 1800, '2026-08-02'),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(host.textContent, 'oltre il tetto la pagina deve dirlo').toMatch(/Elenco tagliato/);
    // Gli aperti si leggono dal più recente: oltre il tetto mancano i più vecchi fra quelli fermi, ma il
    // contante da versare del 2/8 arriva dalla lettura dei pagabili (sotto: lunedì e tasto).
    expect(host.textContent, 'l\'avviso deve dire che mancano i più vecchi').toMatch(/Mancano i più\s+vecchi/);
    expect(daVersareLunedi(blocco), 'il contante del 2/8 sparisce dal lunedì: 999 da 9,00 € + 18,00 €').toMatch(/9\.?009,00/);

    vi.stubGlobal('prompt', () => 'CRO-R22');
    const tasto = tastoIn(blocco);
    expect(tasto?.textContent).toMatch(/Bonifico fatto/);
    await premi(tasto!);
    const segnati = stato.chiamate[0]?.p_order_ids as string[];
    expect(segnati, 'il contante più vecchio è finito oltre il tetto e il bonifico non lo segna').toContain('contante-vecchio');
    expect(segnati).toHaveLength(1000);
  }, 60_000);

  it('mille storni non riusciti più vecchi non tolgono il posto a un contante da versare', async () => {
    stato.ordini = [
      ...tanti(1000, 'storno', '2026-09-01T09:00:00Z', { payout_status: 'REVERSAL_FAILED', payment_status: 'REFUNDED' }),
      contante('contante', 1800, '2026-11-10'),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(daVersareLunedi(blocco), 'gli storni non riusciti occupano i posti degli aperti').toMatch(/18,00/);
    expect(host.textContent, 'mille storni chiusi non fanno tagliare gli aperti').not.toMatch(/Elenco tagliato/);
  }, 60_000);
});
