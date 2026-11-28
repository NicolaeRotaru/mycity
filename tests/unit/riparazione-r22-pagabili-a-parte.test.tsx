// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { disegna, contantiDaStripeVuota } from './aiuti/cabina-admin';

/**
 * R22-001 (giro di correzione) — I contanti da versare si leggono a parte, col loro tetto e per data di
 * consegna: le righe ferme non li nascondono, e lo storno non riuscito non esce dalla pagina.
 *
 * Prima il tetto valeva su un insieme che mescolava i pagabili (contanti HELD, ritiri da regolare) con
 * righe ferme (contanti dal fattorino, reclami, IBAN, carte), ordinato per data di creazione mentre la
 * settimana si conta per consegna; con l'elenco tagliato il tasto non diceva che era solo una parte; e lo
 * storno non riuscito usciva con i chiusi oltre i mille più recenti.
 * Il finto server applica filtri, ordinamenti (più d'uno) e limite come quello vero.
 * Orologio finto: lunedì 23/11/2026 (settimana prima: 16-22/11, ora di Roma).
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

describe('R22-001 — i contanti da versare a parte: le righe ferme non li nascondono', () => {
  it('mille contanti ancora dal fattorino dall\'1/9 e un contante da versare del 17/11: il lunedì dice 18,00 € e c\'è il tasto', async () => {
    stato.ordini = [
      ...tanti(1000, 'fattorino', '2026-09-01T09:00:00Z', { payout_status: 'AWAITING_REMITTANCE' }),
      contante('da-versare', 1800, '2026-11-17'),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(daVersareLunedi(blocco), 'le righe ferme spingono fuori il contante da versare').toMatch(/^18,00/);
    vi.stubGlobal('prompt', () => 'CRO-R22');
    const tasto = tastoIn(blocco);
    expect(tasto?.textContent).toMatch(/Bonifico fatto · 18,00/);
    expect(tasto?.textContent, 'i pagabili non sono tagliati').not.toMatch(/una parte/);
    await premi(tasto!);
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['da-versare'], p_importo_cents: 1800 });
  }, 60_000);

  it('mille contanti creati dall\'1/10 e consegnati oggi, uno creato e consegnato il 12/11: il 12/11 entra nel lunedì', async () => {
    stato.ordini = [
      ...tanti(1000, 'oggi', '2026-10-01T09:00:00Z', {}).map((o) => ({ ...o, delivered_at: '2026-11-23T07:00:00Z' })),
      contante('del-12', 1800, '2026-11-12'),
    ];
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    expect(daVersareLunedi(blocco), 'il tetto si conta per creazione, la settimana per consegna').toMatch(/18,00/);
  }, 60_000);

  it('con i contanti da versare tagliati il tasto e la conferma dicono che è solo una parte', async () => {
    stato.ordini = tanti(1001, 'vecchio', '2026-09-01T09:00:00Z', {});
    const host = await apri();
    const blocco = bloccoDi(host, 'Pane Quotidiano');
    const tasto = tastoIn(blocco);
    expect(tasto?.textContent, 'il tasto spaccia una parte per il tutto').toMatch(/Bonifico fatto · .*\(solo una parte\)/);
    expect(daVersareLunedi(blocco)).toMatch(/^almeno /);
    const prompt = vi.fn((_t?: string) => 'CRO-R22');
    vi.stubGlobal('prompt', prompt);
    await premi(tasto!);
    expect(String(prompt.mock.calls[0]?.[0] ?? '')).toMatch(/solo una parte/);
    expect(stato.chiamate[0]?.p_order_ids as string[]).toHaveLength(1000);
  }, 60_000);

  it('uno storno non riuscito dell\'1/9 resta in pagina anche dietro mille bonifici fatti più recenti', async () => {
    stato.ordini = [
      ordine('storno-vecchio', { payout_status: 'REVERSAL_FAILED', payment_status: 'REFUNDED', created_at: '2026-09-01T09:00:00Z', delivered_at: '2026-09-01T15:00:00Z' }),
      ...tanti(1000, 'pagato', '2026-09-10T09:00:00Z', { payout_status: 'PAID_MANUALLY', payout_at: '2026-11-16T08:00:00Z' }),
    ];
    const host = await apri();
    expect(host.textContent, 'lo storno da recuperare a mano sparisce oltre i mille chiusi').toMatch(/Storno non riuscito/);
  }, 60_000);
});
