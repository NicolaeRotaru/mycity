import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * 6/9/2026 — IL MECCANISMO C'ERA, MA CHI SPEDISCE NON LO USAVA.
 *
 * Il 27/8 (R067) `sendEmail` ha imparato a tenere il piede «annulla
 * l'iscrizione» fuori dalle email di servizio: basta dichiarare
 * `tipo: 'transazionale'`. Il ripiego, di proposito, e' «marketing» — meglio un
 * link di troppo in fondo a una ricevuta che una promozione senza il modo di
 * smettere di riceverla.
 *
 * Il giro della coda (`app/api/cron/send-emails/route.ts`) non dichiarava
 * niente. Quindi «ordine pronto» e «ordine consegnato» — che sono avvisi
 * sull'ordine di una persona, e in questa coda ci sono dal 30/8 — uscivano col
 * piede di disiscrizione e con le due intestazioni che accendono il pulsante
 * «Annulla iscrizione» dentro Gmail.
 *
 * Chi lo premeva li' credeva di spegnere gli avvisi del suo ordine. Invece
 * spegneva le promozioni (`email_marketing` e `notif_promos`, migrazione 118),
 * e gli avvisi dell'ordine gli arrivavano lo stesso: perso un contatto per un
 * equivoco scritto da noi, e un cliente che ci segnala come spam.
 *
 * Questa prova NON guarda l'argomento passato: guarda il messaggio vero che
 * esce, quello che arriva al servizio di posta. Il pacchetto lo prepara
 * `lib/email/client.ts` per davvero, qui e' finto solo Resend.
 */

/** Il pacchetto vero, come lo riceve il servizio di posta. */
const alServizioDiPosta: Array<{ html?: string; headers?: Record<string, string> }> = [];

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: { html?: string; headers?: Record<string, string> }) => {
        alServizioDiPosta.push(payload);
        return { data: { id: 'msg-1' }, error: null };
      },
    };
  },
}));

vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

let coda: Array<{ id: string; user_id: string; template: string; metadata?: Record<string, unknown> }> = [];
let profili: Array<{ id: string; full_name: string | null; email_marketing: boolean | null }> = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: coda, error: null }),
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'maria@example.it' } } }),
      },
    },
    from: (tabella: string) => {
      if (tabella === 'profiles') {
        return { select: () => ({ in: async () => ({ data: profili, error: null }) }) };
      }
      return { update: () => ({ eq: async () => ({ error: null }) }) };
    },
  }),
}));

async function giroDellaPosta(): Promise<void> {
  vi.resetModules();
  const { POST } = await import('@/app/api/cron/send-emails/route');
  await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/cron/send-emails', { method: 'POST' }),
  );
}

beforeEach(() => {
  alServizioDiPosta.length = 0;
  coda = [];
  profili = [{ id: 'u1', full_name: 'Maria Rossi', email_marketing: true }];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('UNSUBSCRIBE_SECRET', 'un-segreto-lungo-abbastanza');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('gli avvisi sull ordine che partono dalla coda', () => {
  it('«ordine pronto» esce senza il piede «annulla l\'iscrizione»', async () => {
    coda = [{ id: 'q1', user_id: 'u1', template: 'order_ready', metadata: { orderId: 'ab12cd34', pickupInStore: true, storeName: 'Pane Quotidiano', storeAddress: 'Via Roma 1', pickupCode: '4821' } }];

    await giroDellaPosta();

    expect(alServizioDiPosta, "l'avviso non e nemmeno partito").toHaveLength(1);
    const html = String(alServizioDiPosta[0].html ?? '');
    expect(html, "chi lo preme sull'avviso del suo ordine spegne le promozioni credendo di spegnere gli avvisi").not.toContain('/api/unsubscribe');
    expect(html).not.toContain("Annulla l'iscrizione");
  });

  it('«ordine consegnato» non accende il pulsante «Annulla iscrizione» di Gmail', async () => {
    coda = [{ id: 'q1', user_id: 'u1', template: 'order_delivered', metadata: { orderId: 'ab12cd34', totalEuro: 24.5 } }];

    await giroDellaPosta();

    const intestazioni = (alServizioDiPosta[0]?.headers ?? {}) as Record<string, string>;
    expect(intestazioni['List-Unsubscribe'], 'un clic distratto sul pulsante di Gmail spegneva le promozioni di chi voleva solo archiviare un avviso di consegna').toBeUndefined();
    expect(intestazioni['List-Unsubscribe-Post']).toBeUndefined();
  });

  it('benvenuto e tutorial, che sono servizio anche loro, escono puliti', async () => {
    coda = [
      { id: 'q1', user_id: 'u1', template: 'welcome' },
      { id: 'q2', user_id: 'u1', template: 'tutorial_day2' },
    ];

    await giroDellaPosta();

    expect(alServizioDiPosta).toHaveLength(2);
    for (const m of alServizioDiPosta) {
      expect(String(m.html ?? ''), 'stanno in TEMPLATE_DI_SERVIZIO: o sono di servizio per tutte e due le cose, o per nessuna').not.toContain('/api/unsubscribe');
      expect(m.headers).toBeUndefined();
    }
  });

  it("sui messaggi commerciali il modo di smettere resta, che li' e' obbligatorio", async () => {
    coda = [
      { id: 'q1', user_id: 'u1', template: 'winback_60d' },
      { id: 'q2', user_id: 'u1', template: 'reengagement_14d' },
    ];

    await giroDellaPosta();

    expect(alServizioDiPosta).toHaveLength(2);
    for (const m of alServizioDiPosta) {
      expect(String(m.html ?? ''), "togliere il link a una email commerciale e' molto peggio del difetto che sto chiudendo").toContain('/api/unsubscribe');
      const intestazioni = (m.headers ?? {}) as Record<string, string>;
      expect(intestazioni['List-Unsubscribe']).toMatch(/^<https:\/\/mycity\.example\/api\/unsubscribe/);
      expect(intestazioni['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    }
  });
});
