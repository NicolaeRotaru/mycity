// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest } from 'next/server';
import { disegna } from './aiuti/cabina-admin';

/**
 * R05-002 — Il pannello dei bonifici dice a Nicola quanto versare a ogni negozio il lunedì.
 *
 * I quattro punti rimasti aperti il 26/11, un caso per punto, con la pagina vera, un Supabase finto
 * che applica i filtri e l'orologio finto (lunedì 23/11/2026: la settimana prima va dal 16 al 22/11):
 *  ① la commissione di un ritiro al banco già regolata non si toglie di nuovo quando il contante di
 *     quel bonifico viene poi rimborsato (PAID_MANUALLY → REFUNDED);
 *  ② il resto da mettere in fattura (commissione oltre i contanti) resta dopo «Bonifico fatto», sommato
 *     sul mese con i bonifici di prima;
 *  ③ la commissione di una settimana senza bonifico segnato entra nel lunedì dopo, non si perde;
 *  ④ con PAGAMENTI_CONTANTI_DA_STRIPE_DAL valida i contanti consegnati da quel giorno (mezzanotte di
 *     Piacenza) escono dal lunedì e dal tasto: «In sospeso · lo paga Stripe». La pagina lo chiede al
 *     server: la richiesta la serve la rotta che Next aprirebbe per quell'indirizzo, cercata nella
 *     cartella app/ come fa Next, con il controllo vero del ruolo (solo admin).
 */

type Riga = Record<string, unknown>;
type Bonifico = { seller_id: string; fatto_il: string; importo_cents: number; in_fattura_cents: number };
const stato = vi.hoisted(() => ({
  tabelle: {} as Record<string, Record<string, unknown>[]>,
  bonifici: [] as { seller_id: string; fatto_il: string; importo_cents: number; in_fattura_cents: number }[],
  chiamate: [] as { p_order_ids: string[]; p_ritiri: string[]; p_importo_cents: number; p_riferimento: string | null }[],
  ruolo: 'admin' as string,
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

/** Come la 916: contanti → PAID_MANUALLY, ritiri → commissione regolata, e la riga del bonifico. */
function segnaBonificoManuale(a: { p_seller: string; p_order_ids: string[]; p_ritiri: string[]; p_importo_cents: number }) {
  const ordini = new Map((stato.tabelle.orders ?? []).map((o) => [o.id as string, o]));
  const contanti = a.p_order_ids.map((id) => ordini.get(id)).filter((o) => o && o.payout_status === 'HELD' && o.payment_method === 'cod');
  const ritiri = a.p_ritiri.map((id) => ordini.get(id)).filter((o) => o && o.payout_status === 'CASH_IN_STORE' && !o.payout_at);
  if (contanti.length !== a.p_order_ids.length || ritiri.length !== a.p_ritiri.length) return { data: null, error: { message: 'BONIFICO_CAMBIATO' } };
  const contantiCents = contanti.reduce((s, o) => s + Number(o!.seller_payout_cents) - Number(o!.seller_payout_reversed_cents ?? 0), 0);
  const commissione = ritiri.reduce((s, o) => s + Number(o!.application_fee_cents ?? 0), 0);
  const trattenuta = Math.min(contantiCents, commissione);
  if (a.p_importo_cents !== contantiCents - trattenuta) return { data: null, error: { message: 'BONIFICO_CAMBIATO' } };
  const adesso = new Date().toISOString();
  for (const o of contanti) Object.assign(o!, { payout_status: 'PAID_MANUALLY', payout_at: adesso });
  for (const o of ritiri) Object.assign(o!, { payout_at: adesso });
  stato.bonifici.push({ seller_id: a.p_seller, fatto_il: adesso, importo_cents: contantiCents - trattenuta, in_fattura_cents: commissione - trattenuta });
  return { data: contanti.length, error: null };
}

/** Come bonifici_manuali_per_mese (916): somma per negozio e mese di Roma. */
function bonificiPerMese() {
  const mese = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(new Date(iso));
  const somme = new Map<string, { seller_id: string; mese: string; importo_cents: number; in_fattura_cents: number }>();
  for (const b of stato.bonifici as Bonifico[]) {
    const k = `${b.seller_id}|${mese(b.fatto_il)}`;
    const s = somme.get(k) ?? { seller_id: b.seller_id, mese: mese(b.fatto_il), importo_cents: 0, in_fattura_cents: 0 };
    s.importo_cents += b.importo_cents;
    s.in_fattura_cents += b.in_fattura_cents;
    somme.set(k, s);
  }
  return [...somme.values()];
}

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => tabella(t),
    rpc: vi.fn(async (nome: string, args: never) => {
      if (nome === 'segna_bonifico_manuale') {
        stato.chiamate.push(args);
        return segnaBonificoManuale(args);
      }
      if (nome === 'bonifici_manuali_per_mese') return { data: bonificiPerMese(), error: null };
      return { data: [], error: null };
    }),
  },
}));
// Il lato server della richiesta: chi è collegato e il suo ruolo, letti come li legge withAdminAuth.
vi.mock('@/lib/supabase/server', () => ({
  getCurrentUser: async () => ({ id: 'nicola' }),
  getServerSupabase: async () => ({}),
  getAdminSupabase: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'nicola', role: stato.ruolo, is_approved: true }, error: null }) }) }) }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), spesa: vi.fn() } }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children?: ReactNode }) => createElement('a', { href }, children) }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k, useLocale: () => 'it' }));

/** La rotta che Next aprirebbe per un indirizzo `/api/...`: cartelle esatte, `route.ts` in fondo. */
function rottaPer(percorso: string): string | null {
  let dir = join(process.cwd(), 'app');
  for (const pezzo of percorso.split('/').filter(Boolean)) {
    if (!readdirSync(dir, { withFileTypes: true }).some((d) => d.isDirectory() && d.name === pezzo)) return null;
    dir = join(dir, pezzo);
  }
  const file = join(dir, 'route.ts');
  return existsSync(file) ? file : null;
}

/** Le richieste ancora in volo: la prova aspetta che il server abbia risposto. */
const inVolo: Promise<unknown>[] = [];
function server(input: unknown): Promise<Response> {
  const p = rispondi(input);
  inVolo.push(p);
  return p;
}

/** Il server finto: ogni richiesta della pagina va alla rotta vera, se c'è; altrimenti 404. */
async function rispondi(input: unknown): Promise<Response> {
  const indirizzo = new URL(String(input), 'https://mycity.test');
  const file = rottaPer(indirizzo.pathname);
  if (!file) return new Response(JSON.stringify({ ok: false, error: 'non trovata' }), { status: 404 });
  const rotta = (await import(/* @vite-ignore */ file)) as { GET: (r: NextRequest) => Promise<Response> };
  return rotta.GET(new NextRequest(indirizzo));
}

let chiudi: (() => void) | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T08:00:00Z'));
  stato.tabelle = {};
  stato.bonifici = [];
  stato.chiamate = [];
  stato.ruolo = 'admin';
  vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '');
  vi.stubGlobal('fetch', server);
});
afterEach(() => {
  chiudi?.();
  chiudi = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
const ritiro = (id: string, consegnato: string, commissione: number, altro: Riga = {}) =>
  ordine(id, consegnato, 2000, { payout_status: 'CASH_IN_STORE', application_fee_cents: commissione, ...altro });

/** Aspetta le risposte del server e che React Query le consegni alla pagina. */
async function asciuga() {
  while (inVolo.length) await Promise.allSettled(inVolo.splice(0));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });
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
const riga = (host: HTMLElement, id: string) =>
  Array.from(host.querySelectorAll('tr')).find((tr) => tr.querySelector(`a[href="/admin/orders/${id}"]`))?.textContent ?? '';

async function premi(host: HTMLElement, testo: string) {
  vi.stubGlobal('prompt', () => 'TRN-R05-002');
  vi.stubGlobal('confirm', () => true);
  const tasto = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes(testo));
  expect(tasto, `il tasto «${testo}» non c’è`).toBeDefined();
  await act(async () => { tasto!.click(); await new Promise((ok) => setTimeout(ok, 20)); });
  // Dopo il bonifico la pagina rilegge (ordini e bonifici del mese).
  await act(async () => { await new Promise((ok) => setTimeout(ok, 20)); });
  await asciuga();
}

describe('R05-002 — quanto versare a ogni negozio il lunedì', () => {
  it('① la commissione già regolata non si toglie di nuovo se il contante di quel bonifico viene rimborsato', async () => {
    stato.tabelle.orders = [
      // Il bonifico del 16/11: il contante, poi rimborsato per intero, e il ritiro la cui commissione (3,00) si è trattenuta lì.
      ordine('contante-rimborsato', '2026-11-10T10:00:00Z', 2000, { payout_status: 'REFUNDED', payment_status: 'REFUNDED', payout_at: '2026-11-16T09:00:00Z', seller_payout_reversed_cents: 2000 }),
      ritiro('ritiro-regolato', '2026-11-12T10:00:00Z', 300, { payout_at: '2026-11-16T09:00:00Z' }),
      // Il contante di questa settimana: 15,00 da versare, senza nessuna commissione da togliere.
      ordine('contante-nuovo', '2026-11-18T10:00:00Z', 1500),
    ];
    stato.bonifici = [{ seller_id: 'forno', fatto_il: '2026-11-16T09:00:00Z', importo_cents: 1700, in_fattura_cents: 0 }];
    const host = await apri();

    expect(daVersareLunedi(host), 'la commissione del ritiro già regolato è stata tolta una seconda volta').toMatch(/^15,00/);
    await premi(host, 'Bonifico fatto');
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['contante-nuovo'], p_ritiri: [], p_importo_cents: 1500 });
  });

  it('② il resto da mettere in fattura resta dopo «Bonifico fatto» e si somma sul mese', async () => {
    stato.tabelle.orders = [
      // Il 9/11 una compensazione: 2,00 di commissione andati in fattura.
      ritiro('ritiro-del-9', '2026-11-06T10:00:00Z', 200, { payout_at: '2026-11-09T09:00:00Z' }),
      ritiro('ritiro-grosso', '2026-11-17T10:00:00Z', 800),
      ordine('contante-piccolo', '2026-11-18T10:00:00Z', 500),
    ];
    stato.bonifici = [{ seller_id: 'forno', fatto_il: '2026-11-09T09:00:00Z', importo_cents: 0, in_fattura_cents: 200 }];
    const host = await apri();

    // Contanti 5,00, commissione 8,00: nessun bonifico, 3,00 in fattura.
    expect(daVersareLunedi(host)).toMatch(/^0,00/);
    expect(host.textContent).toMatch(/3,00\s*€ di commissione non entrano nel bonifico/);
    await premi(host, 'Segna la compensazione');
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['contante-piccolo'], p_ritiri: ['ritiro-grosso'], p_importo_cents: 0 });

    const inFattura = Array.from(host.querySelectorAll('p')).map((p) => p.textContent ?? '').filter((t) => t.includes('di commissione in fattura ('));
    expect(inFattura, 'dopo «Bonifico fatto» il resto da fatturare è sparito o non si somma sul mese').toEqual([expect.stringMatching(/^5,00\s*€ di commissione in fattura \(novembre 2026\)$/)]);
  });

  it('③ la commissione di una settimana senza bonifico segnato entra nel lunedì dopo', async () => {
    stato.tabelle.orders = [
      // Ritiro del 4/11: quel lunedì nessun bonifico è stato segnato, la commissione (2,50) è ancora da regolare.
      ritiro('ritiro-vecchio', '2026-11-04T10:00:00Z', 250),
      ordine('contante', '2026-11-19T10:00:00Z', 2000),
    ];
    const host = await apri();

    expect(daVersareLunedi(host), 'la commissione della settimana senza bonifico si è persa').toMatch(/^17,50/);
    await premi(host, 'Bonifico fatto');
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['contante'], p_ritiri: ['ritiro-vecchio'], p_importo_cents: 1750 });
  });

  const treContanti = () => [
    ordine('prima-del-16', '2026-11-13T10:00:00Z', 1000),
    // 00:30 del 16/11 a Piacenza: è già dal 16.
    ordine('mezzanotte-e-mezza', '2026-11-15T23:30:00Z', 600),
    ordine('dopo-il-16', '2026-11-17T10:00:00Z', 2400),
  ];

  it('④ con PAGAMENTI_CONTANTI_DA_STRIPE_DAL valida i contanti da quel giorno escono dal lunedì: «In sospeso · lo paga Stripe»', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-11-16');
    stato.tabelle.orders = treContanti();
    const host = await apri();

    expect(daVersareLunedi(host), 'i contanti che paga Stripe sono ancora «Da versare»: si pagano due volte').toMatch(/^10,00/);
    expect(riga(host, 'dopo-il-16')).toContain('In sospeso · lo paga Stripe');
    expect(riga(host, 'mezzanotte-e-mezza')).toContain('In sospeso · lo paga Stripe');
    expect(riga(host, 'prima-del-16')).toContain('Da versare');
    expect(host.textContent).toContain('li paga Stripe: sono «In sospeso · lo paga Stripe», non li versi tu');
    await premi(host, 'Bonifico fatto');
    expect(stato.chiamate[0]).toMatchObject({ p_order_ids: ['prima-del-16'], p_importo_cents: 1000 });
  });

  it('④ con la variabile vuota i contanti li versi tu, tutti', async () => {
    stato.tabelle.orders = treContanti();
    const host = await apri();

    expect(daVersareLunedi(host)).toMatch(/^40,00/);
    expect(host.textContent).not.toContain('lo paga Stripe');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('④ se il server non risponde (qui: chi chiede non è admin) la pagina lo dice e non tace', async () => {
    vi.stubEnv('PAGAMENTI_CONTANTI_DA_STRIPE_DAL', '2026-11-16');
    stato.ruolo = 'seller';
    stato.tabelle.orders = treContanti();
    const host = await apri();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Non so da quando i contanti li paga Stripe');
    expect(daVersareLunedi(host)).toMatch(/^40,00/);
  });
});
