import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * R06-001 — Un ordine fermo su «accettato» o «ritirato dal fattorino» non faceva suonare nessun
 * allarme. Il sorvegliante (app/api/cron/operational-alerts/route.ts) chiedeva alla tabella degli
 * ordini solo NEW, OUT_FOR_DELIVERY, DELIVERED, READY e ASSIGNED: il fornaio che accetta e si
 * dimentica «Pronto» (il fattorino non può prenderlo: prendi_ordine vuole READY) o il fattorino che
 * ritira e non passa mai a «in consegna» restavano lì in silenzio.
 *
 * Le soglie sono quelle del registro: ACCEPTED oltre la fine della fascia, o 2 ore senza fascia;
 * PICKED_UP da più di 30 minuti (solo allarme: la merce è già col fattorino). La scadenza
 * automatica dell'accettato è una scelta di Nicola e qui non si prova.
 *
 * Il finto database applica davvero i filtri (eq, lt, gte, in, is, not, or, order con i vuoti come
 * Postgres, limit) e ricorda quello che il giro scrive; l'orologio è finto (solo `Date`).
 * Dati finti: nessun negozio, cliente o fattorino vero.
 */

type Riga = Record<string, unknown>;
type Esito = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

const CHIAVE_PRIMARIA: Record<string, string> = {
  operational_alert_log: 'alert_key',
  notifications: 'id',
};

let db: Record<string, Riga[]> = {};
/** Una scrittura che il database rifiuta, per tabella. */
let rifiuta: Record<string, string | null> = {};

function valore(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function filtroSemplice(col: string, op: string, x: unknown): (r: Riga) => boolean {
  return (r) => {
    const v = r[col];
    if (op === 'is') return x === null || x === 'null' ? v === null || v === undefined : v === x;
    if (op === 'in') {
      const lista = Array.isArray(x) ? x : String(x).replace(/^\(|\)$/g, '').split(',');
      return lista.map(String).includes(String(v));
    }
    const a = valore(v);
    const b = valore(x);
    if (a === null || b === null) return false;
    switch (op) {
      case 'eq': return a === b;
      case 'neq': return a !== b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'gt': return a > b;
      case 'gte': return a >= b;
      default: throw new Error(`filtro non previsto dal finto database: ${op}`);
    }
  };
}

/** Divide «a,b(c,d),e» sulle virgole che non stanno fra parentesi. */
function pezzi(s: string): string[] {
  const out: string[] = [];
  let livello = 0;
  let corrente = '';
  for (const ch of s) {
    if (ch === '(') livello++;
    if (ch === ')') livello--;
    if (ch === ',' && livello === 0) {
      out.push(corrente);
      corrente = '';
    } else corrente += ch;
  }
  if (corrente) out.push(corrente);
  return out;
}

function condizione(s: string): (r: Riga) => boolean {
  const e = s.trim();
  if (e.startsWith('and(') && e.endsWith(')')) {
    const parti = pezzi(e.slice(4, -1)).map(condizione);
    return (r) => parti.every((f) => f(r));
  }
  if (e.startsWith('or(') && e.endsWith(')')) {
    const parti = pezzi(e.slice(3, -1)).map(condizione);
    return (r) => parti.some((f) => f(r));
  }
  const p1 = e.indexOf('.');
  const p2 = e.indexOf('.', p1 + 1);
  return filtroSemplice(e.slice(0, p1), e.slice(p1 + 1, p2), e.slice(p2 + 1));
}

function tabella(nome: string): unknown {
  const st = {
    op: 'select' as 'select' | 'insert' | 'upsert' | 'update' | 'delete',
    filtri: [] as Array<(r: Riga) => boolean>,
    ordine: null as { col: string; asc: boolean; nulliPrima: boolean } | null,
    limite: null as number | null,
    inizio: 0,
    valori: [] as Riga[],
    modifica: {} as Riga,
    opzioni: {} as { onConflict?: string; ignoreDuplicates?: boolean },
    ritorna: false,
    soloConto: false,
  };
  const esegui = async (): Promise<Esito> => {
    // Ogni risposta arriva al giro dopo dell'event loop, come una rete vera: due giri lanciati
    // insieme si intrecciano. L'istruzione si applica tutta insieme quando arriva.
    await new Promise((r) => setTimeout(r, 0));
    const righe = (db[nome] ??= []);
    const scelte = () => righe.filter((r) => st.filtri.every((f) => f(r)));
    const pk = st.opzioni.onConflict ?? CHIAVE_PRIMARIA[nome];
    if (st.op !== 'select' && rifiuta[nome]) return { data: null, error: { message: rifiuta[nome]! } };
    switch (st.op) {
      case 'select': {
        let out = scelte();
        if (st.ordine) {
          // Come Postgres: senza `nullsFirst` i vuoti vanno in fondo in salita e in cima in discesa.
          const { col, asc, nulliPrima } = st.ordine;
          out = [...out].sort((x, y) => {
            const a = valore(x[col]);
            const b = valore(y[col]);
            if (a === null || b === null) return a === b ? 0 : (a === null) === nulliPrima ? -1 : 1;
            return (a < b ? -1 : a > b ? 1 : 0) * (asc ? 1 : -1);
          });
        }
        if (st.limite !== null) out = out.slice(st.inizio, st.inizio + st.limite);
        if (st.soloConto) return { data: null, error: null, count: out.length };
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      case 'insert': {
        if (pk && st.valori.some((v) => v[pk] != null && righe.some((r) => r[pk] === v[pk]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        righe.push(...st.valori.map((v) => ({ ...v })));
        return { data: st.ritorna ? st.valori : null, error: null };
      }
      case 'upsert': {
        const scritte: Riga[] = [];
        for (const v of st.valori) {
          const i = righe.findIndex((r) => r[pk] === v[pk]);
          if (i >= 0) {
            if (st.opzioni.ignoreDuplicates) continue;
            righe[i] = { ...righe[i], ...v };
          } else righe.push({ ...v });
          scritte.push({ ...v });
        }
        return { data: st.ritorna ? scritte : null, error: null };
      }
      case 'update': {
        const toccate = scelte();
        for (const r of toccate) Object.assign(r, st.modifica);
        return { data: st.ritorna ? toccate.map((r) => ({ ...r })) : null, error: null };
      }
      case 'delete': {
        const via = new Set(scelte());
        db[nome] = righe.filter((r) => !via.has(r));
        return { data: null, error: null };
      }
    }
  };
  const b: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => {
      if (st.op === 'select') st.soloConto = Boolean(o?.head);
      else st.ritorna = true;
      return b;
    },
    insert: (v: Riga | Riga[]) => { st.op = 'insert'; st.valori = ([] as Riga[]).concat(v); return b; },
    upsert: (v: Riga | Riga[], o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
      st.op = 'upsert'; st.valori = ([] as Riga[]).concat(v); st.opzioni = o ?? {}; return b;
    },
    update: (v: Riga) => { st.op = 'update'; st.modifica = v; return b; },
    delete: () => { st.op = 'delete'; return b; },
    eq: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'eq', v)); return b; },
    neq: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'neq', v)); return b; },
    lt: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'lt', v)); return b; },
    lte: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'lte', v)); return b; },
    gt: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'gt', v)); return b; },
    gte: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'gte', v)); return b; },
    in: (c: string, v: unknown[]) => { st.filtri.push(filtroSemplice(c, 'in', v)); return b; },
    is: (c: string, v: unknown) => { st.filtri.push(filtroSemplice(c, 'is', v)); return b; },
    not: (c: string, op: string, v: unknown) => {
      const f = filtroSemplice(c, op, v);
      st.filtri.push((r) => !f(r));
      return b;
    },
    or: (s: string) => { st.filtri.push(condizione(`or(${s})`)); return b; },
    order: (col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => {
      const asc = o?.ascending !== false;
      // Il primo ordinamento comanda; i successivi (lo spareggio per id) qui non servono.
      st.ordine ??= { col, asc, nulliPrima: o?.nullsFirst ?? !asc };
      return b;
    },
    limit: (n: number) => { st.limite = n; return b; },
    // Onda 2 (R06-001) — Le letture a pagine: da `a` a `b` compresi, come PostgREST.
    range: (a: number, z: number) => { st.inizio = a; st.limite = z - a + 1; return b; },
    then: (ok: (v: Esito) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
  };
  return b;
}




vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (g: (r: unknown) => unknown) => (r: unknown) => g(r) }));
// R05-004 (onda 2) — Il sorvegliante legge anche i bonifici di rimborso ai clienti: qui nessuno da fare.
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => tabella(t),
    rpc: async (nome: string) => (nome === 'admin_bonifici_rimborso' ? { data: [], error: null } : { data: null, error: { message: `rpc finta: ${nome}` } }),
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'finta' })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { sendEmail } from '@/lib/email/client';
import { ORDER_STATUS_LABEL } from '@/lib/order-status';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { details?: Array<{ key: string; type: string; detail: string }> } };
}

/** Lunedì 16 novembre 2026, 11:30 a Piacenza (UTC+1). */
const ADESSO = new Date('2026-11-16T10:30:00.000Z');
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const vaiAvanti = (m: number) => vi.setSystemTime(new Date(Date.now() + m * 60_000));

const chiaviDelGiro = (corpo: { details?: Array<{ key: string }> }) => (corpo.details ?? []).map((d) => d.key);
const campanelle = () => (db.notifications ?? []).filter((n) => n.user_id === 'admin-1');
const emailHtml = () => vi.mocked(sendEmail).mock.calls.map((c) => String((c[0] as { html?: string }).html ?? '')).join('\n');

const accettato = (id: string) => `ACCETTATO_MAI_PRONTO|${id}`;
const ritirato = (id: string) => `RITIRATO_MAI_IN_CONSEGNA|${id}`;

function ordine(id: string, o: Riga): Riga {
  return {
    id,
    delivery_status: 'ACCEPTED',
    created_at: minutiFa(60),
    accepted_at: null,
    ready_at: null,
    picked_up_at: null,
    delivered_at: null,
    delivery_slot: null,
    rider_id: null,
    payment_method: 'card',
    total_price: 18.4,
    profiles: { store_name: 'Bottega di prova', full_name: 'Fattorino di prova' },
    ...o,
  };
}

const salvato = { ...process.env };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  db = { profiles: [{ id: 'admin-1', role: 'admin' }], orders: [] };
  rifiuta = {};
  vi.mocked(sendEmail).mockClear();
  vi.mocked(sendEmail).mockImplementation(async () => ({ ok: true, id: 'finta' }));
  process.env.SUPPORT_EMAIL = 'allarmi@mycity.test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.AI_GLOBAL_DAILY_BUDGET_EUR;
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
});

describe('R06-001 — l ordine accettato e mai segnato «Pronto» fa suonare un allarme', () => {
  it('la fascia è finita e l ordine è ancora accettato: allarme, in campanella e per email', async () => {
    const id = 'a1000001-aaaa-4aaa-8aaa-000000000001';
    // Nato alle 8:00 per «Oggi · 9:00–11:00», accettato alle 8:10: alle 11:30 la fascia è finita da mezz'ora.
    db.orders = [ordine(id, { created_at: '2026-11-16T07:00:00.000Z', accepted_at: '2026-11-16T07:10:00.000Z', delivery_slot: 'Oggi · 9:00–11:00' })];
    const { http, corpo } = await giro();
    expect(http).toBe(200);
    expect(chiaviDelGiro(corpo), 'ordine accettato con la fascia finita e nessun allarme').toContain(accettato(id));
    expect(campanelle()).toHaveLength(1);
    expect(emailHtml()).toContain('#a1000001');
    expect(emailHtml()).toContain('Bottega di prova');
  });

  it('dentro la fascia non suona, anche se è accettato da tre ore; finita la fascia sì', async () => {
    const id = 'a1000002-aaaa-4aaa-8aaa-000000000002';
    db.orders = [ordine(id, { created_at: '2026-11-16T07:00:00.000Z', accepted_at: '2026-11-16T07:30:00.000Z', delivery_slot: 'Oggi · 11:00–13:00' })];
    const prima = await giro();
    expect(chiaviDelGiro(prima.corpo), 'la fascia 11-13 non è finita: il negozio è ancora nei tempi').not.toContain(accettato(id));
    vi.setSystemTime(new Date('2026-11-16T12:05:00.000Z')); // 13:05 a Piacenza
    const dopo = await giro();
    expect(chiaviDelGiro(dopo.corpo)).toContain(accettato(id));
  });

  it('senza fascia: dopo 2 ore dall accettazione suona, prima no (anche la veloce e l ordine senza ora d accettazione)', async () => {
    const oltre = 'a1000003-aaaa-4aaa-8aaa-000000000003';
    const neiTempi = 'a1000004-aaaa-4aaa-8aaa-000000000004';
    const veloce = 'a1000005-aaaa-4aaa-8aaa-000000000005';
    const senzaOra = 'a1000006-aaaa-4aaa-8aaa-000000000006';
    db.orders = [
      ordine(oltre, { created_at: minutiFa(140), accepted_at: minutiFa(130) }),
      ordine(neiTempi, { created_at: minutiFa(115), accepted_at: minutiFa(110) }),
      ordine(veloce, { created_at: minutiFa(130), accepted_at: minutiFa(125), delivery_slot: ETICHETTA_ADESSO }),
      ordine(senzaOra, { created_at: minutiFa(180), accepted_at: null }),
    ];
    const { corpo } = await giro();
    const chiavi = chiaviDelGiro(corpo);
    expect(chiavi, 'accettato da 2 ore e 10 minuti senza fascia: nessun allarme').toContain(accettato(oltre));
    expect(chiavi).not.toContain(accettato(neiTempi));
    expect(chiavi, 'la veloce non ha una fascia: vale la regola delle 2 ore').toContain(accettato(veloce));
    expect(chiavi, 'senza l ora dell accettazione conta la nascita').toContain(accettato(senzaOra));
  });

  it('gli accettati dimenticati da giorni non tengono il posto a quello fermo da poco', async () => {
    const vecchi = Array.from({ length: 60 }, (_, i) =>
      ordine(`b${String(i).padStart(7, '0')}-aaaa-4aaa-8aaa-000000000000`, {
        created_at: minutiFa(5 * 24 * 60 + i),
        // Cinquanta senza l'ora dell'accettazione, come gli ordini di prima: letti in discesa con i
        // vuoti in cima (il default di Postgres) riempirebbero da soli il tetto.
        accepted_at: i < 50 ? null : minutiFa(5 * 24 * 60 + i - 10),
      }),
    );
    const nuovo = 'a1000007-aaaa-4aaa-8aaa-000000000007';
    db.orders = [...vecchi, ordine(nuovo, { created_at: minutiFa(150), accepted_at: minutiFa(130) })];
    const { corpo } = await giro();
    expect(chiaviDelGiro(corpo), 'sessanta accettati vecchi riempiono il tetto e il nuovo fermo non suona').toContain(accettato(nuovo));
  });
});

describe('R06-001 — l ordine ritirato dal fattorino e mai «in consegna» fa suonare un allarme', () => {
  it('ritirato da 31 minuti: allarme col nome del fattorino, e l ordine resta com è (niente annullo)', async () => {
    const id = 'c1000001-aaaa-4aaa-8aaa-000000000001';
    db.orders = [ordine(id, { delivery_status: 'PICKED_UP', created_at: minutiFa(120), accepted_at: minutiFa(110), ready_at: minutiFa(60), picked_up_at: minutiFa(31), rider_id: 'rider-1' })];
    const { http, corpo } = await giro();
    expect(http).toBe(200);
    expect(chiaviDelGiro(corpo), 'ritirato da più di 30 minuti e nessun allarme').toContain(ritirato(id));
    expect(emailHtml()).toContain('#c1000001');
    expect(emailHtml()).toContain('Fattorino di prova');
    expect(db.orders.find((r) => r.id === id)?.delivery_status).toBe('PICKED_UP');
  });

  it('ritirato da 20 minuti: nessun allarme', async () => {
    const id = 'c1000002-aaaa-4aaa-8aaa-000000000002';
    db.orders = [ordine(id, { delivery_status: 'PICKED_UP', picked_up_at: minutiFa(20), rider_id: 'rider-1' })];
    const { corpo } = await giro();
    expect(chiaviDelGiro(corpo)).not.toContain(ritirato(id));
  });

  it('i dieci posti delle consegne ferme restano loro: il ritirato fermo suona lo stesso', async () => {
    const inConsegna = Array.from({ length: 12 }, (_, i) =>
      ordine(`d${String(i).padStart(7, '0')}-aaaa-4aaa-8aaa-000000000000`, { delivery_status: 'OUT_FOR_DELIVERY', picked_up_at: minutiFa(50 + i), rider_id: 'rider-2' }),
    );
    const id = 'c1000003-aaaa-4aaa-8aaa-000000000003';
    db.orders = [...inConsegna, ordine(id, { delivery_status: 'PICKED_UP', picked_up_at: minutiFa(45), rider_id: 'rider-1' })];
    const { corpo } = await giro();
    const chiavi = chiaviDelGiro(corpo);
    expect(chiavi.filter((k) => k.startsWith('RIDER_STUCK|'))).toHaveLength(10);
    expect(chiavi).toContain(ritirato(id));
  });
});

describe('R06-001 — gli allarmi che c erano non cambiano, e l attesa è quella di tutti', () => {
  it('stessi allarmi di prima sugli altri stati, e niente allarme per accettati e ritirati nei tempi', async () => {
    const nuovo = 'e1000001-aaaa-4aaa-8aaa-000000000001';
    const inConsegna = 'e1000002-aaaa-4aaa-8aaa-000000000002';
    const pronto = 'e1000003-aaaa-4aaa-8aaa-000000000003';
    const assegnato = 'e1000004-aaaa-4aaa-8aaa-000000000004';
    const contanti = 'e1000005-aaaa-4aaa-8aaa-000000000005';
    const accettatoOra = 'e1000006-aaaa-4aaa-8aaa-000000000006';
    const ritiratoOra = 'e1000007-aaaa-4aaa-8aaa-000000000007';
    db.orders = [
      ordine(nuovo, { delivery_status: 'NEW', created_at: minutiFa(240) }),
      ordine(inConsegna, { delivery_status: 'OUT_FOR_DELIVERY', picked_up_at: minutiFa(50), rider_id: 'rider-1' }),
      ordine(pronto, { delivery_status: 'READY', ready_at: minutiFa(180) }),
      ordine(assegnato, { delivery_status: 'ASSIGNED', ready_at: minutiFa(40), rider_id: 'rider-1' }),
      ordine(contanti, { delivery_status: 'DELIVERED', payment_method: 'cod', delivered_at: minutiFa(120), cash_confirmed_at: null }),
      ordine(accettatoOra, { created_at: minutiFa(20), accepted_at: minutiFa(10) }),
      ordine(ritiratoOra, { delivery_status: 'PICKED_UP', picked_up_at: minutiFa(10), rider_id: 'rider-1' }),
    ];
    const { http, corpo } = await giro();
    expect(http).toBe(200);
    const ids = new Set((db.orders as Riga[]).map((r) => String(r.id)));
    const degliOrdini = chiaviDelGiro(corpo).filter((k) => ids.has(k.split('|')[1])).sort();
    expect(degliOrdini).toEqual(
      [
        `COD_NOT_CONFIRMED|${contanti}`,
        `DELIVERY_STALLED|${assegnato}`,
        `ORDER_STUCK_NEW|${nuovo}`,
        `ORDINE_DA_ACCETTARE|${nuovo}`,
        `PRONTO_SENZA_FATTORINO|${pronto}`,
        `RIDER_STUCK|${inConsegna}`,
      ].sort(),
    );
  });

  it('una volta ogni sei ore come gli altri allarmi: il giro dopo non ripete campanella ed email', async () => {
    const acc = 'f1000001-aaaa-4aaa-8aaa-000000000001';
    const rit = 'f1000002-aaaa-4aaa-8aaa-000000000002';
    db.orders = [
      ordine(acc, { created_at: minutiFa(200), accepted_at: minutiFa(190) }),
      ordine(rit, { delivery_status: 'PICKED_UP', picked_up_at: minutiFa(40), rider_id: 'rider-1' }),
    ];
    const primo = await giro();
    expect(chiaviDelGiro(primo.corpo)).toEqual(expect.arrayContaining([accettato(acc), ritirato(rit)]));
    expect(campanelle()).toHaveLength(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
    vaiAvanti(5);
    const secondo = await giro();
    expect(chiaviDelGiro(secondo.corpo)).not.toContain(accettato(acc));
    expect(chiaviDelGiro(secondo.corpo)).not.toContain(ritirato(rit));
    expect(campanelle()).toHaveLength(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });
});

describe('R06-001 — ogni stato non finale dell ordine ha un tempo massimo', () => {
  it('un ordine fermo da tre giorni in qualunque stato non finale fa suonare un allarme', async () => {
    const finali = new Set(['DELIVERED', 'CANCELED']);
    const stati = Object.keys(ORDER_STATUS_LABEL).filter((s) => !finali.has(s));
    expect(stati.length).toBeGreaterThanOrEqual(6);
    const tre = minutiFa(3 * 24 * 60);
    const perStato = new Map(stati.map((s, i) => [s, `${String(i + 1).padStart(8, '9')}-aaaa-4aaa-8aaa-00000000000${i}`]));
    db.orders = stati.map((s) =>
      ordine(perStato.get(s)!, { delivery_status: s, created_at: tre, accepted_at: tre, ready_at: tre, picked_up_at: tre }),
    );
    const { corpo } = await giro();
    const chiavi = chiaviDelGiro(corpo);
    const senzaAllarme = stati.filter((s) => !chiavi.some((k) => k.endsWith(`|${perStato.get(s)}`)));
    expect(senzaAllarme, `stati in cui un ordine resta fermo per sempre senza allarme: ${senzaAllarme.join(', ')}`).toEqual([]);
  });
});
