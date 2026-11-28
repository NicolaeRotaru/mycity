// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { focusManager } from '@tanstack/react-query';
import { disegna } from './aiuti/cabina-admin';

/**
 * R05-002 (onda 2, collaudo) — Il pannello dei bonifici non conta «Da versare» i contanti che forse paga Stripe.
 *
 * Il giorno da cui i contanti li paga il giro con Stripe (PAGAMENTI_CONTANTI_DA_STRIPE_DAL) lo dice solo la rotta
 * /api/admin/contanti-da-stripe. Prima, se quella lettura era in corso o caduta, la pagina contava tutti i contanti
 * HELD «Da versare» e il tasto «Bonifico fatto» li segnava tutti (segna_bonifico_manuale con 40,00 invece di
 * 10,00): Nicola li versava a mano e il giro li pagava anche con Stripe. E dopo una prima lettura buona, una
 * rilettura caduta faceva tornare 40,00 (isSuccess falso, dato ancora lì).
 *
 * Adesso: senza nessuna lettura buona i contanti che Stripe potrebbe pagare restano «In sospeso», fuori dal
 * totale e dal tasto, con l'avviso; una rilettura caduta tiene l'ultima lettura buona.
 *
 * Orologio finto: lunedì 23/11/2026 (la settimana prima va dal 16 al 22/11). Contanti: 10,00 del 13/11,
 * 6,00 e 24,00 dal 16/11 (con la variabile al 16/11 li paga Stripe).
 */

type Riga = Record<string, unknown>;
const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Record<string, unknown>[]>,
  chiamate: [] as { p_order_ids: string[]; p_ritiri: string[]; p_importo_cents: number }[],
}));

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
    if (op === 'eq') return v !== null && v !== undefined && String(v) === val;
    if (op === 'is') return val === 'null' ? v === null || v === undefined : String(v) === val;
    if (op === 'in') return v !== null && v !== undefined && val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    throw new Error(`operatore non previsto dal finto server: ${op}`);
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
      // Copie: come il server vero, la pagina riceve righe nuove a ogni lettura.
      righe = righe.slice(0, Math.min(limite, 1000)).map((r) => ({ ...r }));
      return Promise.resolve({ data: righe, error: null, count: conta ? totale : null }).then(ok, ko);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => tabella(t),
    rpc: vi.fn(async (nome: string, args: never) => {
      if (nome === 'segna_bonifico_manuale') {
        stato.chiamate.push(args);
        return { data: (args as { p_order_ids: string[] }).p_order_ids.length, error: null };
      }
      return { data: [], error: null };
    }),
  },
}));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

/** La rotta del giorno d'inizio, finta: la prova decide cosa risponde a ogni lettura (l'ultima si ripete). */
type Risposta = 'stripe-dal-16' | 'nessuna' | 'errore' | 'appesa';
let risposte: Risposta[] = [];
let letture = 0;
const inizio16 = Date.parse('2026-11-15T23:00:00Z'); // mezzanotte del 16/11 a Piacenza
function rotta(): Promise<Response> {
  letture++;
  const r = risposte.length > 1 ? risposte.shift()! : risposte[0];
  if (r === 'appesa') return new Promise<Response>(() => {});
  if (r === 'errore') return Promise.resolve(new Response(JSON.stringify({ ok: false, error: 'giù' }), { status: 500 }));
  const dal = r === 'stripe-dal-16' ? inizio16 : null;
  return Promise.resolve(new Response(JSON.stringify({ ok: true, data: { dal } }), { status: 200 }));
}

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  stato.tabelle = {};
  stato.chiamate = [];
  risposte = [];
  letture = 0;
  vi.stubGlobal('fetch', rotta);
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const negozio = { store_name: 'Pane Quotidiano', billing_iban: 'IT60X0542811101000000123456' };
function ordine(id: string, consegnato: string, cents: number, altro: Riga = {}): Riga {
  return {
    id, seller_id: 'forno', total_price: cents / 100, seller_payout_cents: cents, seller_payout_reversed_cents: 0,
    application_fee_cents: 0, wallet_applied_cents: 0, dispute_status: null, internal_dispute_status: null,
    payment_status: 'PAID', payout_status: 'HELD', payout_at: null, stripe_transfer_id: null, delivery_status: 'DELIVERED',
    payment_method: 'cod', created_at: consegnato, delivered_at: consegnato, seller: negozio, ...altro,
  };
}
const treContanti = () => [
  ordine('prima-del-16', '2026-11-13T10:00:00Z', 1000),
  // 00:30 del 16/11 a Piacenza: è già dal 16.
  ordine('mezzanotte-e-mezza', '2026-11-15T23:30:00Z', 600),
  ordine('dopo-il-16', '2026-11-17T10:00:00Z', 2400),
];

async function asciuga() {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
}
async function apri() {
  const mod = (await import('@/app/admin/payouts/page')) as { default: () => ReactNode };
  const r = await disegna(createElement(mod.default));
  chiudi = r.chiudi;
  await asciuga();
  return r.host;
}
const daVersareLunedi = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('p')).find((p) => p.textContent === 'Da versare lunedì')?.nextElementSibling?.textContent ?? '';
const contantiDaVersare = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('*')).find((e) => e.children.length === 0 && e.textContent === 'Contanti da versare')?.parentElement?.nextElementSibling?.textContent ?? '';
const tasto = (host: HTMLElement) => Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Bonifico fatto'));
const riga = (host: HTMLElement, id: string) =>
  Array.from(host.querySelectorAll('tr')).find((tr) => tr.querySelector(`a[href="/admin/orders/${id}"]`))?.textContent ?? '';

async function premi(host: HTMLElement) {
  vi.stubGlobal('prompt', () => 'TRN-R05-002');
  const t = tasto(host);
  expect(t, 'il tasto «Bonifico fatto» non c’è').toBeDefined();
  await act(async () => { t!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
  await asciuga();
}

describe('R05-002 (collaudo) — senza sapere da quando paga Stripe, i contanti non sono «Da versare»', () => {
  it('A · la rotta è giù: niente «Da versare», niente tasto, l’avviso dice perché', async () => {
    risposte = ['errore'];
    stato.tabelle.orders = treContanti();
    const host = await apri();

    expect(letture).toBeGreaterThan(0);
    expect(daVersareLunedi(host), 'con la rotta giù i contanti sono ancora «Da versare»: si pagano due volte').toMatch(/^0,00/);
    expect(contantiDaVersare(host), 'il riquadro «Contanti da versare» conta i contanti incerti').toMatch(/^0,00/);
    expect(tasto(host), 'con la rotta giù il tasto «Bonifico fatto» segna anche i contanti che paga Stripe').toBeUndefined();
    expect(riga(host, 'dopo-il-16')).toContain('non so se lo paga Stripe');
    expect(riga(host, 'prima-del-16')).toContain('non so se lo paga Stripe');
    const avviso = host.querySelector('[role="alert"]')?.textContent ?? '';
    expect(avviso).toContain('Non so da quando i contanti li paga Stripe');
    expect(avviso).toMatch(/40,00\s*€ di contanti restano «In sospeso»/);
    expect(host.textContent).toContain('«Bonifico fatto» fermo');
    expect(stato.chiamate).toEqual([]);
  });

  it('A · la lettura è ancora in corso: lo stesso, senza tasto, e la pagina dice che aspetta', async () => {
    risposte = ['appesa'];
    stato.tabelle.orders = treContanti();
    const host = await apri();

    expect(daVersareLunedi(host), 'mentre si legge il giorno d’inizio i contanti sono già «Da versare»').toMatch(/^0,00/);
    expect(tasto(host), 'mentre si legge il giorno d’inizio il tasto segna tutto').toBeUndefined();
    expect(host.textContent).toContain('Controllo da quando i contanti li paga Stripe');
  });

  it('B · prima lettura buona, rilettura caduta: resta l’ultima lettura buona (10,00, non 40,00)', async () => {
    risposte = ['stripe-dal-16', 'errore'];
    stato.tabelle.orders = treContanti();
    const host = await apri();
    expect(daVersareLunedi(host)).toMatch(/^10,00/);
    expect(contantiDaVersare(host)).toMatch(/^10,00/);

    // La rilettura (la pagina torna in primo piano) cade.
    const prima = letture;
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await asciuga();
    expect(letture, 'la rilettura non è partita').toBeGreaterThan(prima);

    expect(daVersareLunedi(host), 'una rilettura caduta rimette «Da versare» i contanti che paga Stripe').toMatch(/^10,00/);
    expect(contantiDaVersare(host)).toMatch(/^10,00/);
    expect(riga(host, 'dopo-il-16')).toContain('In sospeso · lo paga Stripe');
    expect(host.textContent).toContain("uso l'ultima lettura buona");
    await premi(host);
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['prima-del-16'], p_importo_cents: 1000 });
  });

  it('con la variabile vuota (lettura buona, dal = null) i contanti li versi tu, tutti', async () => {
    risposte = ['nessuna'];
    stato.tabelle.orders = treContanti();
    const host = await apri();

    expect(daVersareLunedi(host)).toMatch(/^40,00/);
    expect(host.textContent).not.toContain('lo paga Stripe');
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await premi(host);
    expect(stato.chiamate[0]?.p_importo_cents).toBe(4000);
    expect([...(stato.chiamate[0]?.p_order_ids ?? [])].sort()).toEqual(['dopo-il-16', 'mezzanotte-e-mezza', 'prima-del-16']);
  });
});
