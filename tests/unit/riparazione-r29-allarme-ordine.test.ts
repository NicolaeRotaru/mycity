import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R29-002 — Nicola deve sapere di un ordine che il negozio non accetta dopo 5 minuti, non dopo un'ora.
 *
 * Due pezzi, e servono tutti e due:
 *  ① il sorvegliante (app/api/cron/operational-alerts/route.ts) segnala ogni ordine ancora nuovo
 *    dopo 5 minuti dalla nascita (ORDINE_DA_ACCETTARE), una volta sola per ordine;
 *  ② il sorvegliante gira abbastanza spesso (vercel.json → crons): ogni 5 minuti. A ogni 15 il
 *    primo allarme arrivava fra 5 e 20 minuti, non a 5.
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

async function giro() {
  const res = await sorvegliante({ url: 'http://localhost/api/cron/operational-alerts', headers: new Headers() } as unknown as NextRequest);
  return { http: res.status, corpo: (await res.json()) as { details?: Array<{ key: string; type: string; detail: string }> } };
}

/** Lunedì 16 novembre 2026, 12:00:30 a Piacenza: un ordine di mezzogiorno. */
const ADESSO = new Date('2026-11-16T11:00:30.000Z');
const minutiFa = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const vaiAvanti = (m: number) => vi.setSystemTime(new Date(Date.now() + m * 60_000));

const chiaviDelGiro = (corpo: { details?: Array<{ key: string }> }) => (corpo.details ?? []).map((d) => d.key);
const campanelle = () => (db.notifications ?? []).filter((n) => n.user_id === 'admin-1');
const emailHtml = () => vi.mocked(sendEmail).mock.calls.map((c) => String((c[0] as { html?: string }).html ?? '')).join('\n');

const ORDINE = '29292929-aaaa-4aaa-8aaa-000000000002';
const DA_ACCETTARE = `ORDINE_DA_ACCETTARE|${ORDINE}`;

function ordineNuovo(o: Riga): Riga {
  return {
    id: ORDINE,
    delivery_status: 'NEW',
    created_at: minutiFa(6),
    delivery_slot: null,
    total_price: 23.5,
    payment_method: 'cod',
    profiles: { store_name: 'Bottega di prova' },
    ...o,
  };
}

/** Ogni quanti minuti parte il sorvegliante, letto da vercel.json come lo legge Vercel. */
function cadenzaDelSorvegliante(): number {
  const conf = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as { crons?: Array<{ path: string; schedule: string }> };
  const voce = (conf.crons ?? []).find((c) => c.path === '/api/cron/operational-alerts');
  if (!voce) throw new Error('in vercel.json manca il lavoro periodico del sorvegliante');
  const ogni = /^\*\/(\d+) \* \* \* \*$/.exec(voce.schedule);
  if (ogni) return Number(ogni[1]);
  if (voce.schedule === '* * * * *') return 1;
  throw new Error(`la cadenza del sorvegliante non è più «ogni N minuti» ma «${voce.schedule}»: la prova va ripensata`);
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
});
afterEach(() => {
  vi.useRealTimers();
  process.env = { ...salvato };
});

describe('R29-002 — il sorvegliante avvisa di un ordine non accettato dopo 5 minuti', () => {
  it('ordine nato 6 minuti fa e ancora nuovo: allarme, campanella ed email', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6) })];
    const { http, corpo } = await giro();
    expect(http).toBe(200);
    expect(chiaviDelGiro(corpo), 'il primo allarme per un ordine non accettato non può aspettare un ora').toContain(DA_ACCETTARE);
    expect(campanelle()).toHaveLength(1);
    expect(String(campanelle()[0].body)).toContain('#29292929');
    expect(emailHtml()).toContain('#29292929');
    expect(emailHtml()).toContain('Bottega di prova');
  });

  it('a 4 minuti dalla nascita il negozio ha ancora tempo: nessun allarme', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(4) })];
    const { corpo } = await giro();
    expect(chiaviDelGiro(corpo)).not.toContain(DA_ACCETTARE);
    expect(campanelle()).toHaveLength(0);
  });

  it('un ordine già accettato non suona', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(8), delivery_status: 'ACCEPTED' })];
    const { corpo } = await giro();
    expect(chiaviDelGiro(corpo)).not.toContain(DA_ACCETTARE);
  });

  it('l ordine della sera per domani: avviso di ordine nuovo, ma non «bloccato»', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(7), delivery_slot: 'Domani · 9:00–12:00' })];
    const { corpo } = await giro();
    const chiavi = chiaviDelGiro(corpo);
    expect(chiavi).toContain(DA_ACCETTARE);
    expect(chiavi).not.toContain(`ORDER_STUCK_NEW|${ORDINE}`);
    // Il messaggio dice la fascia: chi legge sa che è un ordine per domani (come chiedeva R14).
    expect(emailHtml()).toContain('Domani');
  });

  it('una volta sola per ordine: i giri dopo non lo ripetono, nemmeno quando l attesa di sei ore scade', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6), delivery_slot: 'Domani · 9:00–12:00' })];
    await giro();
    expect(campanelle()).toHaveLength(1);
    vaiAvanti(5);
    const secondo = await giro();
    expect(chiaviDelGiro(secondo.corpo)).not.toContain(DA_ACCETTARE);
    expect(campanelle()).toHaveLength(1);
    vaiAvanti(6 * 60 + 10);
    const terzo = await giro();
    expect(chiaviDelGiro(terzo.corpo)).not.toContain(DA_ACCETTARE);
  });
});

describe('R29-002 — il sorvegliante gira ogni 5 minuti, così il primo allarme arriva davvero a 5', () => {
  it('vercel.json fa partire il sorvegliante ogni 5 minuti', () => {
    expect(cadenzaDelSorvegliante(), 'a ogni 15 minuti il primo allarme arriva fra 5 e 20 minuti dalla nascita').toBeLessThanOrEqual(5);
  });

  it('con la cadenza vera, nel caso peggiore Nicola ha il primo allarme entro 10 minuti dall ordine', async () => {
    const ogni = cadenzaDelSorvegliante();
    // Il caso peggiore: l'ordine nasce 30 secondi dopo un giro, quando l'orologio segna un multiplo
    // della cadenza (Vercel parte ai minuti :00, :05, :10… per «*/5»).
    const giroPrima = new Date('2026-11-16T11:00:00.000Z');
    vi.setSystemTime(new Date(giroPrima.getTime() + 30_000));
    db.orders = [ordineNuovo({ created_at: new Date().toISOString() })];
    const nascita = Date.now();
    let primoAllarme: number | null = null;
    for (let n = 1; n <= 24 && primoAllarme === null; n++) {
      vi.setSystemTime(new Date(giroPrima.getTime() + n * ogni * 60_000));
      const { corpo } = await giro();
      if (chiaviDelGiro(corpo).includes(DA_ACCETTARE)) primoAllarme = Date.now();
    }
    expect(primoAllarme, 'in due ore di giri l ordine non ha mai suonato').not.toBeNull();
    const minuti = (primoAllarme! - nascita) / 60_000;
    expect(minuti).toBeGreaterThanOrEqual(5);
    expect(minuti, `primo allarme dopo ${minuti} minuti: l ordine aspetta troppo`).toBeLessThanOrEqual(10);
    expect(campanelle()).toHaveLength(1);
  });
});

/**
 * R29-004 — Se due giri del sorvegliante partono nello stesso istante (il calendario e un giro a
 * mano, o due calendari), l'amministratore riceveva due volte la stessa campanella (e due email):
 * l'attesa di sei ore era «leggi, poi suona, poi scrivi». Adesso il turno si prende prima di
 * suonare (codice di R14-011, commit 2e81dd8d), e il finto database qui sopra fa intrecciare i due
 * giri come una rete vera.
 */
describe('R29-004 — due giri del sorvegliante partiti insieme suonano una volta sola', () => {
  const chiave = DA_ACCETTARE;

  it('due giri nello stesso istante: una campanella e una email, non due', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6) })];
    await Promise.all([giro(), giro()]);
    expect(campanelle(), 'l amministratore riceve due volte la stessa campanella').toHaveLength(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });

  it('anche quando l attesa di sei ore è appena scaduta: uno solo la rinfresca e suona', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6) })];
    db.operational_alert_log = [
      { alert_key: chiave, last_sent_at: minutiFa(7 * 60) },
      { alert_key: `CAMPANELLA|${chiave}`, last_sent_at: minutiFa(7 * 60) },
    ];
    await Promise.all([giro(), giro()]);
    expect(campanelle()).toHaveLength(1);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(1);
  });

  it('la campanella rifiutata restituisce il turno: il giro dopo suona', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6) })];
    rifiuta.notifications = 'rifiutata';
    const primo = await giro();
    expect(primo.http).toBe(500);
    expect(campanelle()).toHaveLength(0);
    rifiuta.notifications = null;
    vaiAvanti(5);
    await giro();
    expect(campanelle()).toHaveLength(1);
  });

  it('l email non partita restituisce il turno: il giro dopo la ritenta', async () => {
    db.orders = [ordineNuovo({ created_at: minutiFa(6) })];
    vi.mocked(sendEmail).mockImplementation(async () => ({ ok: false, error: 'domain is not verified' }));
    const primo = await giro();
    expect(primo.http).toBe(500);
    expect((db.operational_alert_log ?? []).map((r) => r.alert_key)).not.toContain(chiave);
    vi.mocked(sendEmail).mockImplementation(async () => ({ ok: true, id: 'finta' }));
    vaiAvanti(5);
    const secondo = await giro();
    expect(secondo.http).toBe(200);
    expect(vi.mocked(sendEmail)).toHaveBeenCalledTimes(2);
    // E la campanella, già suonata al primo giro, non risuona.
    expect(campanelle()).toHaveLength(1);
  });
});

/**
 * R29-019 — Il fattorino che invia la verifica d'identità legge «KYC inviato, verifica in corso», e
 * col fornitore della revisione manuale lo stato resta PENDING finché una persona non decide:
 * nessuna parte del sistema lo chiude da sola. Il sorvegliante avvisava solo per i negozi
 * (`.eq('role', 'seller')`): per il fattorino l'attesa era infinita e nessuno lo sapeva.
 * Dati finti: nessuna persona vera.
 */
describe('R29-019 — la verifica d identita del fattorino ferma da 48 ore avvisa l amministratore', () => {
  const FATTORINO = '29292929-bbbb-4bbb-8bbb-000000000019';
  const NEGOZIO = '29292929-cccc-4ccc-8ccc-000000000019';
  const oreFa = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  it('fattorino in attesa da tre giorni: allarme KYC con il suo nome, come per il negozio', async () => {
    db.profiles = [
      { id: 'admin-1', role: 'admin' },
      { id: FATTORINO, role: 'rider', full_name: 'Fattorino di prova', kyc_provider_status: 'PENDING', kyc_provider_checked_at: oreFa(72) },
      { id: NEGOZIO, role: 'seller', store_name: 'Bottega di prova', kyc_provider_status: 'PENDING', kyc_provider_checked_at: oreFa(72) },
    ];
    const { corpo } = await giro();
    const kyc = (corpo.details ?? []).filter((d) => d.type === 'KYC_PENDING_TOO_LONG');
    expect(kyc.map((d) => d.key).sort(), 'la verifica del fattorino ferma da 72 ore non avvisa nessuno').toEqual(
      [`KYC_PENDING_TOO_LONG|${FATTORINO}`, `KYC_PENDING_TOO_LONG|${NEGOZIO}`].sort(),
    );
    expect(kyc.find((d) => d.key.endsWith(FATTORINO))?.detail).toMatch(/^Fattorino Fattorino di prova /);
    expect(kyc.find((d) => d.key.endsWith(NEGOZIO))?.detail).toMatch(/^Seller Bottega di prova /);
  });

  it('una verifica inviata da un giorno, o già decisa, non suona', async () => {
    db.profiles = [
      { id: 'admin-1', role: 'admin' },
      { id: FATTORINO, role: 'rider', full_name: 'Fattorino di prova', kyc_provider_status: 'PENDING', kyc_provider_checked_at: oreFa(24) },
      { id: NEGOZIO, role: 'rider', full_name: 'Altro fattorino', kyc_provider_status: 'APPROVED', kyc_provider_checked_at: oreFa(72) },
    ];
    const { corpo } = await giro();
    expect((corpo.details ?? []).filter((d) => d.type === 'KYC_PENDING_TOO_LONG')).toEqual([]);
  });

  it('con più di 20 verifiche ferme avvisano le più vecchie: le stesse 20 non tengono il posto per sempre', async () => {
    // 20 fattorini fermi da 3 giorni, messi per primi; uno fermo da 10 giorni, messo per ultimo.
    const recenti = Array.from({ length: 20 }, (_, i) => ({
      id: `29292929-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`,
      role: 'rider',
      full_name: `Fattorino ${i}`,
      kyc_provider_status: 'PENDING',
      kyc_provider_checked_at: oreFa(72),
    }));
    db.profiles = [
      { id: 'admin-1', role: 'admin' },
      ...recenti,
      { id: FATTORINO, role: 'rider', full_name: 'Il piu vecchio', kyc_provider_status: 'PENDING', kyc_provider_checked_at: oreFa(240) },
    ];
    const { corpo } = await giro();
    const kyc = (corpo.details ?? []).filter((d) => d.type === 'KYC_PENDING_TOO_LONG').map((d) => d.key);
    expect(kyc).toHaveLength(20);
    expect(kyc, 'la verifica ferma da dieci giorni resta fuori dall elenco').toContain(`KYC_PENDING_TOO_LONG|${FATTORINO}`);
  });

  it('un cliente non ha verifiche d identita da sorvegliare', async () => {
    db.profiles = [
      { id: 'admin-1', role: 'admin' },
      { id: FATTORINO, role: 'buyer', kyc_provider_status: 'PENDING', kyc_provider_checked_at: oreFa(72) },
    ];
    const { corpo } = await giro();
    expect((corpo.details ?? []).filter((d) => d.type === 'KYC_PENDING_TOO_LONG')).toEqual([]);
  });
});
