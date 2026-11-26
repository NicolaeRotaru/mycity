import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 6/9/2026 — TRE COSE CHE MANCAVANO AL GIRO DELLE NOTIFICHE PUSH.
 *
 * Passo indietro: ogni cinque minuti un lavoro automatico prende le notifiche
 * non ancora spedite e le manda al servizio push di Apple, Google o Mozilla,
 * che le consegna al telefono. In mezzo mancavano tre istruzioni:
 *
 * ① nessun tetto di tempo sulla chiamata: un telefono che non risponde teneva
 *    appeso tutto il giro, e le notifiche dietro («il tuo ordine e' pronto»)
 *    non partivano;
 * ② nessuna scadenza sul messaggio: senza istruzioni il servizio push lo tiene
 *    in coda quattro settimane, cosi' un «in consegna» di sabato arriva
 *    lunedi';
 * ③ il contrassegno era diverso per ogni avviso: i quattro stati dello stesso
 *    ordine si impilavano invece di sostituirsi.
 *
 * Questa prova non legge il codice: guarda cosa arriva davvero alla libreria
 * di invio.
 */

/** Cosa e' stato passato a web-push, invio per invio. */
const invii: Array<{ body: string; opzioni: Record<string, unknown> | undefined }> = [];

const inSospeso: Array<{ id: string; user_id: string; title: string; body: string | null; link: string | null; category: string }> = [];
const iscrizioni: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> = [];

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (_sub: unknown, body: string, opzioni?: Record<string, unknown>) => {
      invii.push({ body, opzioni });
      return { statusCode: 201 };
    },
  },
}));
vi.mock('@/lib/env', () => ({
  env: {
    vapidPublicKey: () => 'pub',
    vapidPrivateKey: () => 'priv',
    vapidSubject: () => 'mailto:prova@mycity.test',
  },
}));

function tabella() {
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
    from: () => tabella(),
    rpc: async () => ({ data: true, error: null }),
  }),
}));

async function giro() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
}

beforeEach(() => {
  invii.length = 0;
  inSospeso.length = 0;
  iscrizioni.length = 0;
  iscrizioni.push({ id: 's1', user_id: 'u1', endpoint: 'https://push.test/u1', p256dh: 'k', auth: 'a' });
});

describe('le notifiche push del giro automatico', () => {
  it('non aspettano senza fine: ogni invio ha il suo tetto di tempo', async () => {
    inSospeso.push({ id: 'n1', user_id: 'u1', title: 'Il tuo ordine è pronto', body: null, link: '/orders/o1', category: 'order' });
    await giro();

    expect(invii, 'la push non è nemmeno partita').toHaveLength(1);
    expect(
      invii[0].opzioni?.timeout,
      'senza tetto di tempo un telefono che non risponde tiene appeso tutto il giro delle notifiche',
    ).toBe(5000);
  });

  it('scadono in un\'ora quando parlano di un ordine, non in quattro settimane', async () => {
    inSospeso.push({ id: 'n1', user_id: 'u1', title: 'Il tuo ordine è in consegna', body: null, link: '/orders/o1', category: 'order' });
    await giro();

    expect(
      invii[0].opzioni?.TTL,
      'senza scadenza l\'avviso «in consegna» può arrivare giorni dopo la consegna',
    ).toBe(3600);
    expect(invii[0].opzioni?.urgency).toBe('high');
  });

  it('durano di più quando sono promozioni: quelle possono aspettare', async () => {
    inSospeso.push({ id: 'n2', user_id: 'u1', title: 'Sconto dal tuo negozio', body: null, link: '/shops/pane', category: 'promo' });
    await giro();

    expect(invii[0].opzioni?.TTL).toBe(86400);
    expect(invii[0].opzioni?.urgency).toBe('normal');
  });

  it('gli stati dello stesso ordine si sostituiscono invece di impilarsi', async () => {
    inSospeso.push(
      { id: 'n1', user_id: 'u1', title: 'Ordine confermato', body: null, link: '/orders/o1', category: 'order' },
      { id: 'n2', user_id: 'u1', title: 'Ordine in consegna', body: null, link: '/orders/o1', category: 'order' },
    );
    await giro();

    const contrassegni = invii.map((i) => (JSON.parse(i.body) as { tag?: string }).tag);
    expect(
      new Set(contrassegni).size,
      'due contrassegni diversi per lo stesso ordine: sul telefono restano due avvisi impilati',
    ).toBe(1);
    expect(contrassegni[0]).toBe('/orders/o1');
    expect((JSON.parse(invii[1].body) as { renotify?: boolean }).renotify).toBe(true);
  });

  it('due promozioni diverse restano due avvisi diversi', async () => {
    inSospeso.push(
      { id: 'n1', user_id: 'u1', title: 'Sconto pane', body: null, link: null, category: 'promo' },
      { id: 'n2', user_id: 'u1', title: 'Sconto fiori', body: null, link: '/', category: 'promo' },
    );
    await giro();

    const contrassegni = invii.map((i) => (JSON.parse(i.body) as { tag?: string }).tag);
    expect(new Set(contrassegni).size, 'senza collegamento preciso le promozioni si mangiano a vicenda').toBe(2);
  });
});

/**
 * La pagina della privacy non nominava le notifiche push in nessun punto,
 * mentre le iscrizioni conservano l'indirizzo del servizio push, due chiavi e
 * il programma di navigazione. Un trattamento che non compare nell'informativa
 * è un trattamento senza informativa.
 */
describe('l\'informativa dichiara le notifiche push', () => {
  const pagina = readFileSync(path.join(process.cwd(), 'app/privacy/page.tsx'), 'utf8');

  it('cita l\'iscrizione alle notifiche fra i dati raccolti', () => {
    expect(pagina).toContain('Iscrizione alle notifiche push');
    expect(pagina).toMatch(/endpoint/i);
  });

  it('ha la sua riga nella tabella delle finalità, con base giuridica e conservazione', () => {
    expect(pagina).toContain('Notifiche push (stato dell&apos;ordine e avvisi di servizio)');
    expect(pagina).toContain('Notifiche push promozionali');
    expect(pagina).toMatch(/art\.\s*6\.1\.a/);
  });
});
