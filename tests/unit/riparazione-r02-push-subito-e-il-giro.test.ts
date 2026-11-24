/**
 * R02-004 — L'INVIO SUBITO DELLA PUSH E IL GIRO DEL CRON CHE CORRONO INSIEME.
 *
 * L'invio subito (`mandaSubitoLaPushDelNuovoOrdine`) prende la campanella mettendo la sua ora in
 * `pushed_at`; se l'invio non va, la ridà al giro rimettendo `pushed_at` vuoto. Ma il giro a orario
 * (app/api/cron/send-push) può aver letto la stessa campanella un attimo prima della presa, averla
 * mandata lui e segnata con la SUA ora: ridarla al giro senza guardare cancellava quel segno, e il
 * giro dopo la rimandava una seconda volta. Adesso si ridà solo la campanella che ha ancora la
 * nostra presa. Qui l'orologio è finto e il giro «corre» dentro l'invio, fra la presa e la
 * restituzione.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Riga = Record<string, unknown> & { id: string };

const stato = vi.hoisted(() => ({
  notifiche: [] as Array<Record<string, unknown> & { id: string }>,
  /** Quello che succede mentre l'invio subito aspetta il servizio push (il giro che corre). */
  intanto: null as null | (() => void),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  iscrizioniPerUtenti: async (_s: unknown, utenti: string[]) =>
    new Map(utenti.map((u) => [u, [{ id: `s-${u}`, endpoint: `https://push.test/${u}`, p256dh: 'p', auth: 'a' }]])),
  // Il servizio push è giù per l'invio subito: niente consegnato su un telefono che c'è.
  sendPushToUser: vi.fn(async () => {
    stato.intanto?.();
    return { delivered: 0, total: 1 };
  }),
}));

function tabella() {
  let op: 'select' | 'update' = 'select';
  let valori: Record<string, unknown> = {};
  let conSelect = false;
  const filtri: Array<(r: Riga) => boolean> = [];
  const esegui = async () => {
    const scelte = stato.notifiche.filter((r) => filtri.every((f) => f(r)));
    if (op === 'update') {
      for (const r of scelte) Object.assign(r, valori);
      return { data: conSelect ? scelte.map((r) => ({ ...r })) : null, error: null };
    }
    return { data: scelte.map((r) => ({ ...r })), error: null };
  };
  const q = {
    select: () => { conSelect = true; return q; },
    update: (v: Record<string, unknown>) => { op = 'update'; valori = v; return q; },
    in: (c: string, vs: unknown[]) => { filtri.push((r) => vs.includes(r[c])); return q; },
    is: (c: string, v: unknown) => { filtri.push((r) => (r[c] ?? null) === v); return q; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return q; },
    gte: (c: string, v: string) => { filtri.push((r) => String(r[c]) >= v); return q; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
  };
  return q;
}

import { mandaSubitoLaPushDelNuovoOrdine } from '@/lib/push/subito';

const client = { from: () => tabella(), rpc: async () => ({ data: true, error: null }) } as never;

const ORDINE = '7a1b2c3d-0000-4000-8000-000000000001';
const ADESSO = new Date('2026-11-24T18:42:10Z');
const riga = () => stato.notifiche.find((n) => n.id === 'n-negozio')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ADESSO);
  stato.intanto = null;
  stato.notifiche = [{
    id: 'n-negozio', user_id: 'negozio-1', category: 'order', title: 'Nuovo ordine!', body: 'Ordine #7A1B2C',
    link: `/seller/orders/${ORDINE}`, created_at: new Date(ADESSO.getTime() - 2_000).toISOString(), pushed_at: null,
  }];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R02-004 · l invio subito non cancella il segno del giro del cron', () => {
  it('il giro l ha già mandata e segnata mentre l invio subito falliva: la campanella resta segnata dal giro', async () => {
    // Il giro aveva letto la campanella prima della presa; mentre l'invio subito aspetta il servizio
    // push, il giro la consegna e la segna con la sua ora (tre secondi dopo).
    const oraDelGiro = new Date(ADESSO.getTime() + 3_000).toISOString();
    stato.intanto = () => { riga().pushed_at = oraDelGiro; };

    const esito = await mandaSubitoLaPushDelNuovoOrdine(client, [ORDINE]);

    expect(esito.prese, 'l invio subito non ha preso la campanella: la prova non prova niente').toBe(1);
    expect(riga().pushed_at, 'il segno del giro è sparito: il giro dopo la rimanda una seconda volta').toBe(oraDelGiro);
  });

  it('controprova: senza il giro di mezzo, la campanella non mandata torna al giro (pushed_at vuoto)', async () => {
    const esito = await mandaSubitoLaPushDelNuovoOrdine(client, [ORDINE]);
    expect(esito).toEqual({ mandate: 0, prese: 1, ridateAlGiro: 1 });
    expect(riga().pushed_at).toBeNull();
  });

  it('una campanella già segnata dal giro non si prende', async () => {
    riga().pushed_at = new Date(ADESSO.getTime() - 1_000).toISOString();
    const esito = await mandaSubitoLaPushDelNuovoOrdine(client, [ORDINE]);
    expect(esito.prese).toBe(0);
  });
});
