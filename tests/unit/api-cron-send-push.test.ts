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
}));
vi.mock('@/lib/env', () => ({
  requireSupabaseService: () => ({ url: 'https://x.supabase.co', key: 'svc' }),
}));

const marked: string[] = [];
const pending: Array<{ id: string; user_id: string; title: string; body: string | null; link: string | null; category?: string }> = [];
/** Risposta della funzione che dice se la persona vuole quella categoria. */
let vuoleNotifica: boolean = true;

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (_nome: string) => Promise.resolve({ data: vuoleNotifica, error: null }),
    from: () => {
      const b: Record<string, unknown> = {
        _update: false,
        select: () => b,
        is: () => b,
        gte: () => b,
        order: () => b,
        limit: () => Promise.resolve({ data: pending, error: null }),
        update: () => ((b._update = true), b),
        eq: (_c: string, v: string) => {
          if (b._update) {
            marked.push(v);
            return Promise.resolve({ error: null });
          }
          return b;
        },
      };
      return b;
    },
  }),
}));

async function run() {
  const { POST } = await import('@/app/api/cron/send-push/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
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
    const res = await run();
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
