/**
 * Il giro del cron delle notifiche (app/api/cron/send-push) e l'invio subito della push del nuovo
 * ordine (lib/push/subito.ts) corrono insieme.
 *
 * Il giro legge le campanelle con `pushed_at` vuoto e, prima, le mandava tutte: se fra la sua
 * lettura e il suo invio l'invio subito aveva già preso e mandato la stessa campanella, il telefono
 * del negozio suonava due volte. Adesso il giro, dopo la lettura, PRENDE IN CARICO le righe con la
 * stessa condizione dell'invio subito (`pushed_at` da vuoto ad adesso, solo dove è ancora vuoto) e
 * lavora solo quelle prese; le prese che non riesce a gestire tornano al giro dopo.
 *
 * Qui: un database finto che applica davvero i filtri, il servizio push finto, l'orologio finto, e
 * l'invio subito VERO che corre fra la lettura del giro e la sua presa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Riga = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  notifiche: [] as Array<Record<string, unknown> & { id: string }>,
  /** Quello che succede subito dopo la lettura del giro (l'invio subito che corre). */
  dopoLaLettura: null as null | (() => Promise<unknown>),
  /** La presa del giro (la scrittura che mette l'ora in pushed_at) cade. */
  presaRotta: false,
  /** Il servizio push: 'ok' consegna, 'giu' non consegna su un telefono che c'è. */
  servizio: 'ok' as 'ok' | 'giu',
  invii: [] as Array<{ utente: string; titolo: string }>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, utenti: string[]) =>
    new Map(utenti.map((u) => [u, [{ id: `s-${u}`, endpoint: `https://push.test/${u}`, p256dh: 'p', auth: 'a' }]])),
  sendPushToUser: vi.fn(async (_s: unknown, utente: string, corpo: { title: string }) => {
    if (db.servizio === 'giu') return { delivered: 0, total: 1 };
    db.invii.push({ utente, titolo: corpo.title });
    return { delivered: 1, total: 1 };
  }),
}));

function tabella() {
  let op: 'select' | 'update' = 'select';
  let valori: Record<string, unknown> = {};
  let conSelect = false;
  let limite = Infinity;
  const filtri: Array<(r: Riga) => boolean> = [];
  const esegui = async () => {
    const scelte = db.notifiche.filter((r) => filtri.every((f) => f(r)));
    if (op === 'update') {
      if (db.presaRotta && valori.pushed_at) return { data: null, error: { message: 'scrittura caduta' } };
      for (const r of scelte) Object.assign(r, valori);
      return { data: conSelect ? scelte.map((r) => ({ ...r })) : null, error: null };
    }
    const lette = scelte.slice(0, limite).map((r) => ({ ...r }));
    const intanto = db.dopoLaLettura;
    db.dopoLaLettura = null;
    if (intanto) await intanto();
    return { data: lette, error: null };
  };
  const q = {
    select: () => { conSelect = true; return q; },
    update: (v: Record<string, unknown>) => { op = 'update'; valori = v; return q; },
    in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return q; },
    is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    gte: (c: string, v: string) => { filtri.push((r) => String(r[c]) >= v); return q; },
    or: () => q,
    order: () => q,
    limit: (n: number) => { limite = n; return q; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
  };
  return q;
}

const supa = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => supa.client }));

import { mandaSubitoLaPushDelNuovoOrdine } from '@/lib/push/subito';

const client = { from: () => tabella(), rpc: async () => ({ data: true, error: null }) };
supa.client = client;

const ORDINE = '7a1b2c3d-0000-4000-8000-000000000001';
const NEGOZIO = 'negozio-1';
const ADESSO = new Date('2026-11-24T18:42:10Z');

async function giroAOrario() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  const r = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return { stato: r.status, corpo: (await r.json()) as { sent?: number; retried?: number } };
}

const riga = () => db.notifiche.find((n) => n.id === 'n-negozio')!;
const inviiAlNegozio = () => db.invii.filter((i) => i.utente === NEGOZIO);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  db.notifiche = [{
    id: 'n-negozio', user_id: NEGOZIO, category: 'order', title: 'Nuovo ordine!', body: 'Ordine #7A1B2C',
    link: `/seller/orders/${ORDINE}`, created_at: new Date(ADESSO.getTime() - 10_000).toISOString(), pushed_at: null,
  }];
  db.dopoLaLettura = null;
  db.presaRotta = false;
  db.servizio = 'ok';
  db.invii = [];
});
afterEach(() => vi.useRealTimers());

describe('il giro del cron prende in carico le push come l invio subito', () => {
  it('l invio subito prende la campanella fra la lettura del giro e la sua presa: il giro non la rimanda', async () => {
    const oraDellInvioSubito = new Date(ADESSO.getTime() + 2_000).toISOString();
    db.dopoLaLettura = async () => {
      vi.setSystemTime(new Date(oraDellInvioSubito));
      const esito = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
      expect(esito, 'l invio subito non ha mandato la campanella: la prova non prova niente').toEqual({ mandate: 1, prese: 1, ridateAlGiro: 0 });
    };

    const { stato, corpo } = await giroAOrario();

    expect(stato).toBe(200);
    expect(inviiAlNegozio(), 'doppia push: il giro rimanda la campanella già presa e mandata dall invio subito').toHaveLength(1);
    expect(corpo.sent).toBe(0);
    expect(riga().pushed_at, 'il giro ha riscritto il segno dell invio subito').toBe(oraDellInvioSubito);
  });

  it('controprova: senza l invio subito il giro la manda, una volta, e la segna', async () => {
    const { stato, corpo } = await giroAOrario();
    expect(stato).toBe(200);
    expect(inviiAlNegozio()).toHaveLength(1);
    expect(corpo.sent).toBe(1);
    expect(riga().pushed_at).toBe(ADESSO.toISOString());
  });

  it('la presa non mandata (servizio push giù) torna al giro dopo, che poi la manda', async () => {
    db.servizio = 'giu';
    const primo = await giroAOrario();
    expect(primo.corpo.retried).toBe(1);
    expect(riga().pushed_at, 'la campanella non mandata resta presa: nessun giro la riprende più').toBeNull();

    db.servizio = 'ok';
    vi.setSystemTime(new Date(ADESSO.getTime() + 5 * 60_000));
    await giroAOrario();
    expect(inviiAlNegozio()).toHaveLength(1);
  });

  it('la presa cade (database): il giro risponde come per la lettura caduta e non manda niente', async () => {
    db.presaRotta = true;
    const { stato } = await giroAOrario();
    expect(stato).toBe(503);
    expect(db.invii).toHaveLength(0);
    expect(riga().pushed_at).toBeNull();
  });
});
