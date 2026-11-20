/**
 * R02-004 — La push sul telefono per un nuovo ordine arrivava fino a 5 minuti dopo: la mandava solo
 * il giro a orario (app/api/cron/send-push, ogni 5 minuti).
 *
 * Scelta di Nicola: la push del nuovo ordine parte SUBITO, alla creazione dell'ordine; il giro resta
 * la rete di sicurezza, senza doppio invio. L'aiutante è `mandaSubitoLaPushDelNuovoOrdine`
 * (lib/push/subito.ts); i due punti che creano l'ordine (rotta dei contanti, webhook della carta)
 * lo chiamano dopo aver scritto la campanella — modifica consegnata a parte, i file non sono di R02.
 *
 * Qui: un database finto con le campanelle e le iscrizioni, il servizio push finto, l'orologio
 * finto, e il giro VERO dopo l'invio subito, per vedere che non rimanda niente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Riga = Record<string, unknown> & { id: string };

const db = vi.hoisted(() => ({
  notifiche: [] as Array<Record<string, unknown> & { id: string }>,
  iscrizioni: [] as Array<Record<string, unknown> & { id: string }>,
  /** La scrittura sulle campanelle cade (la presa o la restituzione). */
  scritturaRotta: false,
  /** La preferenza «vuole gli avvisi degli ordini». */
  preferenza: true as boolean,
  /** La domanda sulle preferenze lancia invece di rispondere (un guasto inatteso). */
  preferenzaLancia: false,
  /** Il servizio push risponde: 'ok' o un errore passeggero. */
  servizio: 'ok' as 'ok' | 'giu',
  invii: [] as Array<{ endpoint: string; corpo: { title: string; tag?: string; url?: string } }>,
}));

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/env', () => ({
  env: { vapidPublicKey: () => 'pub', vapidPrivateKey: () => 'priv', vapidSubject: () => 'mailto:prova@mycity.test' },
}));
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (s: { endpoint: string }, corpo: string) => {
      if (db.servizio === 'giu') throw Object.assign(new Error('servizio push giù'), { statusCode: 503 });
      db.invii.push({ endpoint: s.endpoint, corpo: JSON.parse(corpo) });
      return { statusCode: 201 };
    },
  },
}));

function tabella(nome: string) {
  let op: 'select' | 'update' | 'delete' = 'select';
  let valori: Record<string, unknown> = {};
  let conSelect = false;
  let limite = Infinity;
  const filtri: Array<(r: Riga) => boolean> = [];
  const righe = () => (nome === 'notifications' ? db.notifiche : nome === 'push_subscriptions' ? db.iscrizioni : []);
  const esegui = async () => {
    const scelte = righe().filter((r) => filtri.every((f) => f(r)));
    if (op === 'update') {
      if (nome === 'notifications' && db.scritturaRotta) return { data: null, error: { message: 'scrittura caduta' } };
      for (const r of scelte) Object.assign(r, valori);
      return { data: conSelect ? scelte.map((r) => ({ ...r })) : null, error: null };
    }
    if (op === 'delete') return { data: null, error: null };
    return { data: scelte.slice(0, limite).map((r) => ({ ...r })), error: null };
  };
  const q = {
    select: () => { conSelect = true; return q; },
    update: (v: Record<string, unknown>) => { op = 'update'; valori = v; return q; },
    delete: () => { op = 'delete'; return q; },
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

const client = {
  from: (nome: string) => tabella(nome),
  rpc: async () => {
    if (db.preferenzaLancia) throw new Error('rete caduta a metà');
    return { data: db.preferenza, error: null };
  },
};
supa.client = client;

const ORDINE = '7a1b2c3d-0000-4000-8000-000000000001';
const NEGOZIO = 'negozio-1';
const CLIENTE = 'cliente-1';

/** Le due campanelle che la rotta dei contanti scrive alla nascita dell'ordine. */
function campanelleDelNuovoOrdine(adessoIso: string) {
  db.notifiche.push(
    { id: 'n-negozio', user_id: NEGOZIO, category: 'order', title: 'Nuovo ordine!', body: 'Ordine #7A1B2C · 24,50 € · pagamento alla consegna', link: `/seller/orders/${ORDINE}`, created_at: adessoIso, pushed_at: null },
    { id: 'n-cliente', user_id: CLIENTE, category: 'order', title: 'Ordine ricevuto', body: 'Il tuo ordine è stato inviato al negozio.', link: `/orders/${ORDINE}`, created_at: adessoIso, pushed_at: null },
  );
}

async function giroAOrario() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  const r = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return r.json() as Promise<{ sent: number }>;
}

const riga = (id: string) => db.notifiche.find((n) => n.id === id)!;
const inviiAlNegozio = () => db.invii.filter((i) => i.endpoint === 'https://push.test/negozio');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T18:42:10Z'));
  db.notifiche = [];
  db.iscrizioni = [
    { id: 's-negozio', user_id: NEGOZIO, endpoint: 'https://push.test/negozio', p256dh: 'k', auth: 'a' },
    { id: 's-cliente', user_id: CLIENTE, endpoint: 'https://push.test/cliente', p256dh: 'k', auth: 'a' },
  ];
  db.scritturaRotta = false;
  db.preferenza = true;
  db.preferenzaLancia = false;
  db.servizio = 'ok';
  db.invii = [];
});
afterEach(() => vi.useRealTimers());

describe('R02-004 · la push del nuovo ordine parte subito, una volta sola', () => {
  it('alla creazione dell ordine il telefono del negozio la riceve subito, col link dell ordine come contrassegno', async () => {
    campanelleDelNuovoOrdine(new Date().toISOString());
    const esito = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    expect(esito).toEqual({ mandate: 1, prese: 1, ridateAlGiro: 0 });
    expect(inviiAlNegozio()).toHaveLength(1);
    expect(inviiAlNegozio()[0].corpo).toMatchObject({ title: 'Nuovo ordine!', url: `/seller/orders/${ORDINE}`, tag: `/seller/orders/${ORDINE}` });
    expect(riga('n-negozio').pushed_at, 'la campanella mandata non è segnata: il giro la rimanda').toBe('2026-11-20T18:42:10.000Z');
  });

  it('il giro a orario, cinque minuti dopo, non la rimanda (e manda quella del cliente, che resta al giro)', async () => {
    campanelleDelNuovoOrdine(new Date().toISOString());
    await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    expect(riga('n-cliente').pushed_at, 'la campanella del cliente resta al giro').toBeNull();
    vi.setSystemTime(new Date('2026-11-20T18:45:00Z'));
    await giroAOrario();
    expect(inviiAlNegozio(), 'doppio invio: il giro rimanda la push del nuovo ordine').toHaveLength(1);
    expect(db.invii.filter((i) => i.endpoint === 'https://push.test/cliente')).toHaveLength(1);
  });

  it('chiamato due volte (un webhook ripetuto) non manda due volte', async () => {
    campanelleDelNuovoOrdine(new Date().toISOString());
    await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    const seconda = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    expect(seconda.prese).toBe(0);
    expect(inviiAlNegozio()).toHaveLength(1);
  });

  it('chi ha spento gli avvisi degli ordini non la riceve, e il giro non la rimanda', async () => {
    db.preferenza = false;
    campanelleDelNuovoOrdine(new Date().toISOString());
    const esito = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    expect(esito.mandate).toBe(0);
    expect(inviiAlNegozio()).toHaveLength(0);
    expect(riga('n-negozio').pushed_at).not.toBeNull();
  });
});

describe('R02-004 · un guasto non fa cadere l ordine: la push la riprende il giro', () => {
  it('servizio push giù: niente eccezione, la campanella torna al giro, e il giro dopo la manda', async () => {
    db.servizio = 'giu';
    campanelleDelNuovoOrdine(new Date().toISOString());
    const esito = await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE]);
    expect(esito).toEqual({ mandate: 0, prese: 1, ridateAlGiro: 1 });
    expect(riga('n-negozio').pushed_at, 'la push non partita resta segnata: il giro non la riprende più').toBeNull();
    db.servizio = 'ok';
    vi.setSystemTime(new Date('2026-11-20T18:45:00Z'));
    await giroAOrario();
    expect(inviiAlNegozio()).toHaveLength(1);
  });

  it('la presa cade (database): niente eccezione, niente inviato, la campanella resta al giro', async () => {
    campanelleDelNuovoOrdine(new Date().toISOString());
    db.scritturaRotta = true;
    await expect(mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE])).resolves.toEqual({ mandate: 0, prese: 0, ridateAlGiro: 0 });
    expect(db.invii).toHaveLength(0);
    expect(riga('n-negozio').pushed_at).toBeNull();
  });

  it('un guasto inatteso a metà (la domanda sulle preferenze lancia): niente eccezione, la campanella torna al giro', async () => {
    campanelleDelNuovoOrdine(new Date().toISOString());
    db.preferenzaLancia = true;
    await expect(mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE])).resolves.toMatchObject({ mandate: 0 });
    expect(riga('n-negozio').pushed_at).toBeNull();
  });

  it('niente da fare senza ordini, e una campanella già mandata non riparte', async () => {
    campanelleDelNuovoOrdine(new Date().toISOString());
    riga('n-negozio').pushed_at = '2026-11-20T18:40:00.000Z';
    expect(await mandaSubitoLaPushDelNuovoOrdine(client as never, [])).toEqual({ mandate: 0, prese: 0, ridateAlGiro: 0 });
    expect((await mandaSubitoLaPushDelNuovoOrdine(client as never, [ORDINE])).prese).toBe(0);
    expect(db.invii).toHaveLength(0);
  });
});
