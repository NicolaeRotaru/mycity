import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';

/**
 * R33-002 — Il reclamo del cliente ferma il bonifico al negozio, e nessuno lo ricordava più.
 *
 * Un reclamo aperto (open) o in esame (under_review) tiene fermo il bonifico dell'ordine: il giro
 * dei bonifici lo salta finché il reclamo non si decide. Alla nascita l'amministratore riceve un
 * avviso solo (/api/disputes): se si perde, il reclamo resta lì e il negozio aspetta senza scadenza.
 * Adesso il sorvegliante (app/api/cron/operational-alerts/route.ts) avvisa l'amministratore di ogni
 * reclamo aperto da più di 24 ore (RECLAMO_FERMO), una volta al giorno per reclamo: non a ogni giro
 * di 5 minuti, e nemmeno ogni sei ore come gli altri allarmi.
 *
 * Il finto database è quello della prova di R29 (tests/unit/riparazione-r29-allarme-ordine.test.ts):
 * applica davvero i filtri alle righe che la prova gli mette dentro e ricorda quello che il giro
 * scrive (operational_alert_log, notifications), così il giro dopo lo rilegge. In più qui una
 * lettura può non rispondere (`leggeMale`). L'orologio è finto (solo `Date`). Dati finti: nessuna
 * persona vera.
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
/** Una lettura che il database non risponde, per tabella. */
let leggeMale: Record<string, string | null> = {};

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
    // insieme si intrecciano. L'istruzione si applica tutta insieme quando arriva.
    await new Promise((r) => setTimeout(r, 0));
    const righe = (db[nome] ??= []);
    const scelte = () => righe.filter((r) => st.filtri.every((f) => f(r)));
    const pk = st.opzioni.onConflict ?? CHIAVE_PRIMARIA[nome];
    if (st.op !== 'select' && rifiuta[nome]) return { data: null, error: { message: rifiuta[nome]! } };
    if (st.op === 'select' && leggeMale[nome]) return { data: null, error: { message: leggeMale[nome]! } };
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

type Dettaglio = { key: string; type: string; detail: string; url?: string };

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { details?: Dettaglio[]; controlliSaltati?: string[]; problemi?: string[] } };
}

/** Martedì 17 novembre 2026, 10:00:30 a Piacenza. */
const ADESSO = new Date('2026-11-17T09:00:30.000Z');
const oreFa = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const vaiAvanti = (minuti: number) => vi.setSystemTime(new Date(Date.now() + minuti * 60_000));

const RECLAMO = '33333333-aaaa-4aaa-8aaa-000000000002';
const ORDINE = '33333333-bbbb-4bbb-8bbb-000000000002';
const CHIAVE = `RECLAMO_FERMO|${RECLAMO}`;

const reclamiDelGiro = (corpo: { details?: Dettaglio[] }) => (corpo.details ?? []).filter((d) => d.type === 'RECLAMO_FERMO');
const campanelle = () => (db.notifications ?? []).filter((n) => n.user_id === 'admin-1');
const campanelleSulReclamo = () => campanelle().filter((n) => String(n.body).includes('#33333333'));
const emailSulReclamo = () => vi.mocked(sendEmail).mock.calls.filter((c) => String((c[0] as { html?: string }).html ?? '').includes(`Reclamo #33333333`));

function reclamo(o: Riga): Riga {
  return {
    id: RECLAMO,
    order_id: ORDINE,
    opener_id: '33333333-cccc-4ccc-8ccc-000000000002',
    reason: 'damaged',
    description: 'Il vasetto è arrivato rotto, finto per la prova',
    status: 'open',
    created_at: oreFa(25),
    ...o,
  };
}

const salvato = { ...process.env };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  db = { profiles: [{ id: 'admin-1', role: 'admin' }], orders: [], disputes: [] };
  rifiuta = {};
  leggeMale = {};
  vi.mocked(sendEmail).mockClear();
  vi.mocked(sendEmail).mockImplementation(async () => ({ ok: true, id: 'finta' }));
  process.env.SUPPORT_EMAIL = 'allarmi@mycity.test';
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.test';
  process.env.LAVORI_A_ORARIO = 'accesi';
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
});

describe('R33-002 — il reclamo aperto da più di un giorno arriva all amministratore', () => {
  it('reclamo aperto da 25 ore: allarme RECLAMO_FERMO, campanella ed email, col bonifico fermo detto chiaro', async () => {
    db.disputes = [reclamo({ created_at: oreFa(25) })];
    const { http, corpo } = await giro();
    expect(http).toBe(200);
    const reclami = reclamiDelGiro(corpo);
    expect(reclami.map((d) => d.key), 'il reclamo fermo da un giorno non arriva a nessuno').toEqual([CHIAVE]);
    expect(reclami[0].detail).toContain('#33333333');
    expect(reclami[0].detail).toMatch(/aperto da 25 ore/);
    expect(reclami[0].detail).toMatch(/bonifico al negozio resta fermo/);
    expect(reclami[0].url).toBe('/admin/disputes');
    expect(campanelleSulReclamo()).toHaveLength(1);
    expect(campanelleSulReclamo()[0].category).toBe('system');
    expect(emailSulReclamo()).toHaveLength(1);
  });

  it('anche il reclamo «in esame» da tre giorni tiene fermo il bonifico: suona, e lo dice', async () => {
    db.disputes = [reclamo({ status: 'under_review', created_at: oreFa(72) })];
    const { corpo } = await giro();
    const reclami = reclamiDelGiro(corpo);
    expect(reclami.map((d) => d.key)).toEqual([CHIAVE]);
    expect(reclami[0].detail).toMatch(/in esame da 3 giorni/);
  });

  it('un reclamo nato 23 ore fa ha ancora tempo: nessun allarme', async () => {
    db.disputes = [reclamo({ created_at: oreFa(23) })];
    const { corpo } = await giro();
    expect(reclamiDelGiro(corpo)).toEqual([]);
    expect(campanelleSulReclamo()).toHaveLength(0);
  });

  it('un reclamo già deciso non ferma niente: nessun allarme, qualunque sia l esito', async () => {
    db.disputes = (['resolved_buyer', 'resolved_seller', 'rejected'] as const).map((status, i) =>
      reclamo({ id: `33333333-dddd-4ddd-8ddd-00000000000${i}`, status, created_at: oreFa(30) }));
    const { corpo } = await giro();
    expect(reclamiDelGiro(corpo)).toEqual([]);
  });

  it('una volta al giorno per reclamo: niente a 5 minuti, niente quando scadono le sei ore, di nuovo dopo un giorno', async () => {
    db.disputes = [reclamo({ created_at: oreFa(25) })];
    await giro();
    expect(campanelleSulReclamo()).toHaveLength(1);
    expect(emailSulReclamo()).toHaveLength(1);

    vaiAvanti(5);
    await giro();
    expect(campanelleSulReclamo(), 'il reclamo risuona a ogni giro di 5 minuti').toHaveLength(1);
    expect(emailSulReclamo()).toHaveLength(1);

    // Sei ore e dieci minuti dopo il primo avviso: l'attesa degli altri allarmi è scaduta, la sua no.
    vaiAvanti(6 * 60 + 5);
    await giro();
    expect(campanelleSulReclamo(), 'il reclamo risuona ogni sei ore, non una volta al giorno').toHaveLength(1);
    expect(emailSulReclamo(), 'l email del reclamo riparte ogni sei ore, non una volta al giorno').toHaveLength(1);

    // Ventitré ore dopo il primo avviso: ancora niente.
    vaiAvanti(17 * 60 - 10);
    await giro();
    expect(campanelleSulReclamo()).toHaveLength(1);
    expect(emailSulReclamo()).toHaveLength(1);

    // Un giorno e qualche minuto dopo il primo avviso: il reclamo è ancora lì, e lo si ricorda.
    vaiAvanti(70);
    await giro();
    expect(campanelleSulReclamo(), 'dopo un giorno il reclamo ancora aperto non si ricorda più').toHaveLength(2);
    expect(emailSulReclamo()).toHaveLength(2);
  });

  it('la memoria è per reclamo: un secondo reclamo che diventa vecchio il giorno dopo suona lui, il primo no', async () => {
    const SECONDO = '33333333-eeee-4eee-8eee-000000000002';
    db.disputes = [reclamo({ created_at: oreFa(25) }), reclamo({ id: SECONDO, order_id: ORDINE, created_at: oreFa(20) })];
    const primo = await giro();
    expect(reclamiDelGiro(primo.corpo).map((d) => d.key)).toEqual([CHIAVE]);
    vaiAvanti(8 * 60);
    const secondo = await giro();
    expect(reclamiDelGiro(secondo.corpo).map((d) => d.key)).toEqual([`RECLAMO_FERMO|${SECONDO}`]);
  });

  it('due giri partiti insieme: una campanella e una email, non due', async () => {
    db.disputes = [reclamo({ created_at: oreFa(25) })];
    await Promise.all([giro(), giro()]);
    expect(campanelleSulReclamo()).toHaveLength(1);
    expect(emailSulReclamo()).toHaveLength(1);
  });

  it('due giri partiti insieme dopo un giorno: uno solo prende il turno e ricorda il reclamo', async () => {
    db.disputes = [reclamo({ created_at: oreFa(50) })];
    db.operational_alert_log = [
      { alert_key: CHIAVE, last_sent_at: oreFa(25) },
      { alert_key: `CAMPANELLA|${CHIAVE}`, last_sent_at: oreFa(25) },
    ];
    await Promise.all([giro(), giro()]);
    expect(campanelleSulReclamo()).toHaveLength(1);
    expect(emailSulReclamo()).toHaveLength(1);
  });

  it('l email non partita si ritenta al giro dopo, e la campanella già suonata non risuona', async () => {
    db.disputes = [reclamo({ created_at: oreFa(25) })];
    vi.mocked(sendEmail).mockImplementation(async () => ({ ok: false, error: 'domain is not verified' }));
    const primo = await giro();
    expect(primo.http).toBe(500);
    expect(campanelleSulReclamo()).toHaveLength(1);
    vi.mocked(sendEmail).mockImplementation(async () => ({ ok: true, id: 'finta' }));
    vaiAvanti(5);
    const secondo = await giro();
    expect(secondo.http).toBe(200);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2);
    expect(String((vi.mocked(sendEmail).mock.calls[1][0] as { html?: string }).html)).toContain('Reclamo #33333333');
    expect(campanelleSulReclamo()).toHaveLength(1);
  });

  it('se i reclami non si leggono, il giro non si dichiara sano', async () => {
    db.disputes = [reclamo({ created_at: oreFa(25) })];
    leggeMale.disputes = 'permission denied for table disputes';
    const { http, corpo } = await giro();
    expect(http).toBe(500);
    expect(String(corpo.controlliSaltati)).toMatch(/reclami/);
  });

  it('un reclamo ricordato dieci ore fa non si ricorda di nuovo: la memoria guarda indietro un giorno, non sei ore', async () => {
    db.disputes = [reclamo({ created_at: oreFa(40) })];
    db.operational_alert_log = [
      { alert_key: CHIAVE, last_sent_at: oreFa(10) },
      { alert_key: `CAMPANELLA|${CHIAVE}`, last_sent_at: oreFa(10) },
    ];
    const { http, corpo } = await giro();
    expect(http).toBe(200);
    expect(reclamiDelGiro(corpo)).toEqual([]);
    expect(campanelleSulReclamo(), 'il reclamo ricordato dieci ore fa risuona').toHaveLength(0);
    expect(emailSulReclamo()).toHaveLength(0);
  });

  it('se la memoria degli avvisi non si legge, si avvisa lo stesso e il giro lo dice', async () => {
    db.disputes = [reclamo({ created_at: oreFa(25) })];
    leggeMale.operational_alert_log = 'canceling statement due to statement timeout';
    const { http, corpo } = await giro();
    expect(http).toBe(500);
    expect(corpo.problemi ?? []).toContain('attesa di un giorno non letta');
    expect(campanelleSulReclamo()).toHaveLength(1);
    expect(emailSulReclamo()).toHaveLength(1);
  });
});
