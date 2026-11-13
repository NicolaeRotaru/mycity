import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * R14 — il sorvegliante degli allarmi (app/api/cron/operational-alerts/route.ts) e gli ordini.
 *
 * Il finto database qui sotto applica davvero i filtri (eq, lt, gte, in, is, not, or, order,
 * limit) alle righe che la prova gli mette dentro, e ricorda quello che il giro scrive
 * (operational_alert_log, notifications): il giro dopo lo rilegge. L'orologio è finto (solo
 * `Date`), così le soglie di tempo si provano senza aspettare.
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
    ordine: null as { col: string; asc: boolean } | null,
    limite: null as number | null,
    valori: [] as Riga[],
    modifica: {} as Riga,
    opzioni: {} as { onConflict?: string; ignoreDuplicates?: boolean },
    ritorna: false,
    soloConto: false,
  };
  const esegui = async (): Promise<Esito> => {
    // Ogni risposta arriva al giro dopo dell'event loop, come una rete vera: due giri lanciati
    // insieme si intrecciano (R14-011). L'istruzione si applica tutta insieme quando arriva.
    await new Promise((r) => setTimeout(r, 0));
    const righe = (db[nome] ??= []);
    const scelte = () => righe.filter((r) => st.filtri.every((f) => f(r)));
    const pk = st.opzioni.onConflict ?? CHIAVE_PRIMARIA[nome];
    if (st.op !== 'select' && rifiuta[nome]) return { data: null, error: { message: rifiuta[nome]! } };
    switch (st.op) {
      case 'select': {
        let out = scelte();
        if (st.ordine) {
          const { col, asc } = st.ordine;
          out = [...out].sort((x, y) => {
            const a = valore(x[col]) ?? '';
            const b = valore(y[col]) ?? '';
            return (a < b ? -1 : a > b ? 1 : 0) * (asc ? 1 : -1);
          });
        }
        if (st.limite !== null) out = out.slice(0, st.limite);
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
    order: (col: string, o?: { ascending?: boolean }) => { st.ordine = { col, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { st.limite = n; return b; },
    then: (ok: (v: Esito) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
  };
  return b;
}

vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (g: (r: unknown) => unknown) => (r: unknown) => g(r) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => ({ from: (t: string) => tabella(t) }) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true, id: 'finta' })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { POST as sorvegliante } from '@/app/api/cron/operational-alerts/route';
import { sendEmail } from '@/lib/email/client';

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { details?: Array<{ key: string; type: string; detail: string }>; fresh?: number } };
}

/** Lunedì 16 novembre 2026, 11:00 a Piacenza. */
const ADESSO = new Date('2026-11-16T10:00:00.000Z');
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const vaiAvanti = (m: number) => vi.setSystemTime(new Date(Date.now() + m * 60_000));

const chiaviDelGiro = (corpo: { details?: Array<{ key: string }> }) => (corpo.details ?? []).map((d) => d.key);
const campanelle = () => (db.notifications ?? []).filter((n) => n.user_id === 'admin-1');
const emailHtml = () => vi.mocked(sendEmail).mock.calls.map((c) => String((c[0] as { html?: string }).html ?? '')).join('\n');

const ORDINE = '11111111-aaaa-4aaa-8aaa-000000000001';

function ordineNuovo(o: Riga): Riga {
  return {
    id: ORDINE,
    delivery_status: 'NEW',
    created_at: minutiFa(6),
    delivery_slot: null,
    total_price: 18,
    payment_method: 'cod',
    profiles: { store_name: 'Pane Quotidiano' },
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
  process.env.SUPPORT_EMAIL = 'nicola@mycity.test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
});

describe('R14-003 — un ordine che il negozio non accetta suona dopo 5 minuti, non dopo un ora', () => {
  it('ordine nato 6 minuti fa e ancora nuovo: campanella ed email a Nicola', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6) })];
    const { corpo } = await giro();
    expect(chiaviDelGiro(corpo), 'il primo allarme per un ordine non accettato non può aspettare un ora').toContain(`ORDINE_DA_ACCETTARE|${ORDINE}`);
    expect(campanelle()).toHaveLength(1);
    expect(String(campanelle()[0].body)).toContain('#11111111');
    expect(emailHtml()).toContain('#11111111');
    expect(emailHtml()).toContain('Pane Quotidiano');
  });

  it('a 3 minuti dalla nascita il negozio ha ancora tempo: nessun allarme', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(3) })];
    const { corpo } = await giro();
    expect(chiaviDelGiro(corpo)).not.toContain(`ORDINE_DA_ACCETTARE|${ORDINE}`);
    expect(campanelle()).toHaveLength(0);
  });

  it('l ordine della sera per domani: avviso di ordine nuovo, ma non «bloccato»', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(7), delivery_slot: 'Domani · 9:00–12:00' })];
    const { corpo } = await giro();
    const chiavi = chiaviDelGiro(corpo);
    expect(chiavi).toContain(`ORDINE_DA_ACCETTARE|${ORDINE}`);
    expect(chiavi).not.toContain(`ORDER_STUCK_NEW|${ORDINE}`);
    expect(emailHtml()).toContain('Domani');
  });

  it('una volta sola per ordine: i giri dopo non lo ripetono, nemmeno quando l attesa di sei ore scade', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6), delivery_slot: 'Domani · 9:00–12:00' })];
    await giro();
    expect(campanelle()).toHaveLength(1);
    vaiAvanti(15);
    const secondo = await giro();
    expect(chiaviDelGiro(secondo.corpo)).not.toContain(`ORDINE_DA_ACCETTARE|${ORDINE}`);
    expect(campanelle()).toHaveLength(1);
    vaiAvanti(6 * 60 + 10);
    const terzo = await giro();
    expect(chiaviDelGiro(terzo.corpo)).not.toContain(`ORDINE_DA_ACCETTARE|${ORDINE}`);
  });
});
