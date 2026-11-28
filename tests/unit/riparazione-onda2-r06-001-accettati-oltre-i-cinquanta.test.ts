import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * Onda 2 · R06-001 — L'allarme dell'ordine accettato e mai «Pronto» leggeva solo i 50 accettati più
 * recenti.
 *
 * La fascia si confronta nel codice, non in SQL, e la lettura prendeva i primi cinquanta ACCEPTED per
 * accettazione decrescente. Con più di cinquanta accettati ancora nei tempi — i «Domani» presi la
 * sera e accettati dopo — l'ordine con la fascia di stamattina già finita, accettato prima, restava
 * fuori dai cinquanta e non suonava mai. Ora la lettura scorre le pagine.
 *
 * Stesso finto database della prova di prima (tests/unit/riparazione-r06-accettato-ritirato-fermi.test.ts).
 * La scadenza automatica dell'accettato resta una scelta di Nicola e qui non si prova.
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

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { details?: Array<{ key: string; type: string; detail: string }> } };
}

/** Lunedì 16 novembre 2026, 11:30 a Piacenza (UTC+1). */
const ADESSO = new Date('2026-11-16T10:30:00.000Z');
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const chiaviDelGiro = (corpo: { details?: Array<{ key: string }> }) => (corpo.details ?? []).map((d) => d.key);

const accettato = (id: string) => `ACCETTATO_MAI_PRONTO|${id}`;

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

describe('R06-001 · l accettato con la fascia finita non resta fuori dai primi cinquanta', () => {
  it('sessanta «Domani» accettati dopo di lui non gli tolgono l allarme', async () => {
    // Sessanta ordini per domani mattina, accettati negli ultimi 60 minuti: nei tempi.
    const domani = Array.from({ length: 60 }, (_, i) =>
      ordine(`d${String(i).padStart(7, '0')}-aaaa-4aaa-8aaa-000000000000`, {
        created_at: minutiFa(90 + i),
        accepted_at: minutiFa(1 + i),
        delivery_slot: 'Domani · 9:00–12:00',
      }),
    );
    // Nato alle 8:00 per «Oggi · 9:00–11:00», accettato alle 8:10: alle 11:30 la fascia è finita da mezz'ora.
    const fermo = 'a2000001-aaaa-4aaa-8aaa-000000000001';
    db.orders = [
      ...domani,
      ordine(fermo, { created_at: '2026-11-16T07:00:00.000Z', accepted_at: '2026-11-16T07:10:00.000Z', delivery_slot: 'Oggi · 9:00–11:00' }),
    ];

    const { http, corpo } = await giro();

    expect(http).toBe(200);
    expect(chiaviDelGiro(corpo), 'l accettato con la fascia finita era il sessantunesimo e non suonava').toContain(accettato(fermo));
    expect(chiaviDelGiro(corpo).filter((k) => k.startsWith('ACCETTATO_MAI_PRONTO|d')), 'i «Domani» sono nei tempi').toEqual([]);
  });
});
