import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/8/2026 (R076) — UNA DOMANDA AL DATABASE PER OGNI SINGOLA NOTIFICA, E CENTO
 * CHIAMATE APERTE TUTTE INSIEME.
 *
 * Il giro delle notifiche push prende fino a cento notifiche in sospeso. Poi
 * faceva due cose che non reggono al picco:
 *
 * ① le preferenze («questa persona vuole ancora questo tipo di avviso?») le
 *    chiedeva con un `Promise.all` senza tetto: fino a cento chiamate aperte
 *    nello stesso istante contro il gestore di connessioni di Supabase. Il
 *    tetto a gruppi di dieci esisteva, ma solo più sotto, per gli invii.
 * ② le iscrizioni push le rileggeva DENTRO l'invio, una volta per notifica:
 *    cento letture della stessa tabella dove ne bastava una.
 *
 * Al volume di oggi non si vede. Si vede al picco degli ordini — cioè
 * esattamente quando la notifica «il tuo ordine è pronto» serve davvero, e
 * quando ci sono anche i clienti veri che navigano sullo stesso database.
 *
 * Questa prova non legge il codice: conta le domande fatte al finto database e
 * guarda quante ne restano aperte insieme.
 */

const conteggioLetture: Record<string, number> = {};
let inVoloRpc = 0;
let massimoInVoloRpc = 0;

/** Le notifiche in sospeso che il giro trova. */
const inSospeso: Array<{ id: string; user_id: string; title: string; body: string | null; link: string | null; category: string }> = [];
/** Le iscrizioni push, per persona. */
const iscrizioni: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async () => ({ statusCode: 201 }),
  },
}));
vi.mock('@/lib/env', () => ({
  env: {
    vapidPublicKey: () => 'pub',
    vapidPrivateKey: () => 'priv',
    vapidSubject: () => 'mailto:prova@mycity.test',
  },
}));

function tabella(nome: string) {
  conteggioLetture[nome] = (conteggioLetture[nome] ?? 0) + 1;
  let filtroUtenti: string[] | null = null;
  let unSoloUtente: string | null = null;
  let inAggiornamento = false;
  const b: Record<string, unknown> = {
    select: () => b,
    is: () => b,
    gte: () => b,
    order: () => b,
    delete: () => b,
    update: () => { inAggiornamento = true; return b; },
    limit: () => Promise.resolve({ data: inSospeso, error: null }),
    in: (_c: string, valori: string[]) => {
      if (inAggiornamento) return Promise.resolve({ error: null });
      filtroUtenti = valori;
      return b;
    },
    eq: (_c: string, v: string) => { unSoloUtente = v; return b; },
    then: (risolvi: (v: unknown) => unknown) => {
      const righe = iscrizioni.filter(
        (i) =>
          (filtroUtenti === null || filtroUtenti.includes(i.user_id)) &&
          (unSoloUtente === null || i.user_id === unSoloUtente),
      );
      return Promise.resolve({ data: righe, error: null }).then(risolvi);
    },
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (nome: string) => tabella(nome),
    rpc: async () => {
      inVoloRpc++;
      massimoInVoloRpc = Math.max(massimoInVoloRpc, inVoloRpc);
      // Un giro di rete vero non risponde nello stesso tick.
      await new Promise((r) => setTimeout(r, 1));
      inVoloRpc--;
      return { data: true, error: null };
    },
  }),
}));

async function giro() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
}

beforeEach(() => {
  for (const k of Object.keys(conteggioLetture)) delete conteggioLetture[k];
  inSospeso.length = 0;
  iscrizioni.length = 0;
  inVoloRpc = 0;
  massimoInVoloRpc = 0;
});

/** Trenta notifiche per tre persone: il caso del picco, in piccolo. */
function trentaNotifichePerTrePersone() {
  for (let i = 0; i < 30; i++) {
    const persona = `u${i % 3}`;
    inSospeso.push({ id: `n${i}`, user_id: persona, title: 'Il tuo ordine è pronto', body: null, link: null, category: 'order' });
  }
  for (const persona of ['u0', 'u1', 'u2']) {
    iscrizioni.push({ id: `s-${persona}`, user_id: persona, endpoint: `https://push.test/${persona}`, p256dh: 'k', auth: 'a' });
  }
}

describe('il giro delle notifiche push', () => {
  it('legge le iscrizioni UNA volta sola, non una per notifica', async () => {
    trentaNotifichePerTrePersone();
    const res = await giro();
    expect(res.status).toBe(200);

    expect(
      conteggioLetture.push_subscriptions,
      'trenta notifiche, trenta letture della stessa tabella: al picco degli ordini sono cento',
    ).toBe(1);
  });

  it('e non apre piu di dieci domande sulle preferenze insieme', async () => {
    trentaNotifichePerTrePersone();
    // Tre persone → tre chiavi preferenza: per vedere il tetto servono piu'
    // persone di quante ne stiano in un gruppo.
    inSospeso.length = 0;
    for (let i = 0; i < 40; i++) {
      inSospeso.push({ id: `n${i}`, user_id: `p${i}`, title: 'Ordine pronto', body: null, link: null, category: 'order' });
    }
    await giro();

    expect(
      massimoInVoloRpc,
      `con ${massimoInVoloRpc} domande aperte insieme, il picco di notifiche colpisce il database nello stesso istante in cui ci navigano i clienti veri`,
    ).toBeLessThanOrEqual(10);
  });

  it('le push arrivano lo stesso: la riparazione non ne perde nessuna', async () => {
    trentaNotifichePerTrePersone();
    const res = await giro();
    const corpo = await res.json();
    expect(corpo.sent, 'trenta notifiche a tre persone iscritte: trenta consegne').toBe(30);
  });

  it('chi non ha nessuna iscrizione non blocca il giro', async () => {
    inSospeso.push({ id: 'n1', user_id: 'senza-telefono', title: 'T', body: null, link: null, category: 'order' });
    const res = await giro();
    expect((await res.json()).sent).toBe(0);
  });
});
