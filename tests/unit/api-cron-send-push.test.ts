import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * send-push — audit 🟠-10: la notifica viene marcata pushed_at SOLO se almeno
 * una push è stata consegnata, o se l'utente non ha subscription. Su fallimento
 * transitorio (delivered=0, total>0) NON si marca → ritentato al giro dopo.
 */

const pushResult = { delivered: 0, total: 0 };
const sendPushToUserMock = vi.fn(async () => pushResult);

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
vi.mock('@/lib/push/send', () => ({
  isPushConfigured: () => true,
  sendPushToUser: () => sendPushToUserMock(),
  // 30/8/2026 (R076) — il giro adesso legge le iscrizioni push UNA volta per
  // tutti, invece di rileggerle dentro ogni invio (erano cento letture della
  // stessa tabella col batch pieno). Qui l'esito dell'invio lo decide comunque
  // `pushResult`, quindi cosa contiene la mappa non cambia niente: serve solo
  // che la funzione esista. Chi prova la lettura unica sta in
  // le-notifiche-non-chiedono-al-database-una-volta-per-notifica.test.ts.
  iscrizioniPerUtenti: async () => new Map(),
}));
vi.mock('@/lib/env', () => ({
  requireSupabaseService: () => ({ url: 'https://x.supabase.co', key: 'svc' }),
}));

import { segnateIn, tabellaNotifiche, type RigaNotifica } from './aiuti/finte-notifiche-push';

/** Le notifiche rimaste segnate (`pushed_at` pieno) alla fine del giro. */
const marked: string[] = [];
const pending: Array<{ id: string; user_id: string; title: string; body: string | null; link: string | null; category?: string }> = [];
/** Risposta della funzione che dice se la persona vuole quella categoria. */
let vuoleNotifica: boolean = true;

// 28/11/2026 (R03-016) — Il giro prende le notifiche prima di mandarle e ridà quelle non partite:
// il finto tiene le righe in memoria (aiuti/finte-notifiche-push.ts) e «marcate» è lo stato finale.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (_nome: string) => Promise.resolve({ data: vuoleNotifica, error: null }),
    from: () => tabellaNotifiche(() => pending as RigaNotifica[]),
  }),
}));

async function run() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  marked.length = 0;
  marked.push(...segnateIn(pending as RigaNotifica[]));
  return res;
}

beforeEach(() => {
  marked.length = 0;
  pending.length = 0;
  vuoleNotifica = true;
  sendPushToUserMock.mockClear();
});

describe('cron send-push (audit 🟠-10)', () => {
  it('marca pushed_at quando almeno una push è consegnata', async () => {
    pending.push({ id: 'n1', user_id: 'u1', title: 'T', body: null, link: null });
    pushResult.delivered = 1;
    pushResult.total = 1;
    const res = await run();
    expect((await res.json()).sent).toBe(1);
    expect(marked).toEqual(['n1']);
  });

  it('[🟠-10] NON marca pushed_at su fallimento transitorio (delivered=0, total>0)', async () => {
    pending.push({ id: 'n2', user_id: 'u2', title: 'T', body: null, link: null });
    pushResult.delivered = 0;
    pushResult.total = 1;
    const res = await run();
    const json = await res.json();
    expect(json.retried).toBe(1);
    expect(marked).toEqual([]); // col codice vecchio sarebbe ['n2']
  });

  it('marca pushed_at quando l’utente non ha subscription (niente da consegnare)', async () => {
    pending.push({ id: 'n3', user_id: 'u3', title: 'T', body: null, link: null });
    pushResult.delivered = 0;
    pushResult.total = 0;
    await run();
    expect(marked).toEqual(['n3']);
  });
});

describe('le preferenze delle notifiche contano', () => {
  it('non manda la promozione a chi ha spento le promozioni', async () => {
    // Prima le quattro preferenze del profilo non venivano lette da nessuno:
    // nessun cron, nessuna rotta, nessun trigger. Chi spegneva l'interruttore
    // continuava a ricevere le promozioni.
    vuoleNotifica = false;
    pending.push({ id: 'n1', user_id: 'u1', title: 'Sconto!', body: null, link: null, category: 'promo' });
    pushResult.delivered = 1;
    pushResult.total = 1;

    await run();

    expect(sendPushToUserMock).not.toHaveBeenCalled();
    // Segnata come gestita: non deve tornare al giro dopo.
    expect(marked).toContain('n1');
  });

  it('manda l\'aggiornamento sull\'ordine a chi lo vuole', async () => {
    vuoleNotifica = true;
    pending.push({ id: 'n2', user_id: 'u1', title: 'In consegna', body: null, link: null, category: 'order' });
    pushResult.delivered = 1;
    pushResult.total = 1;

    await run();

    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(marked).toContain('n2');
  });
});
