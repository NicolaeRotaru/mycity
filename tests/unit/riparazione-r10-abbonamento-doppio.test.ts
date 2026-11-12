import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';

/**
 * R10-019 — Con due schede aperte nascevano due abbonamenti da 50 €, e il
 * secondo copriva il primo nel profilo: il primo restava orfano, pagato ogni
 * mese e non più disdicibile dal sito.
 *
 *  ① La cassa: due richieste dello stesso negozio portano a Stripe la stessa
 *    chiave di idempotenza, quindi ricevono la stessa sessione.
 *  ② Il webhook: se arriva comunque un secondo abbonamento mentre il primo è in
 *    corso, il primo resta sul profilo e il doppione si annulla su Stripe.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

type Evento = { id: string; type: string; data: { object: Record<string, unknown> } };
const stato = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } } as Evento,
  suStripe: {} as Record<string, string>,
  annullati: [] as string[],
  chiavi: [] as Array<string | undefined>,
  profiloCassa: {} as Record<string, unknown>,
  rispostaPersa: false,
}));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<typeof import('@/lib/env')>()),
  env: { ...(await orig<typeof import('@/lib/env')>()).env, appUrl: () => 'http://localhost' },
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    h({ user: { id: 's1', email: 'negozio@example.com' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => stato.db.client,
  getServerSupabase: async () => ({
    from: (tabella: string) => tabella === 'orders'
      // Un negozio che ha già incassato (R10-020): la cassa si apre.
      ? { select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: [{ id: 'o1' }], error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ single: async () => ({ data: stato.profiloCassa, error: null }) }) }) },
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    subscriptions: {
      retrieve: async (id: string) => {
        if (stato.suStripe[id] === 'introvabile') throw new Error(`No such subscription: ${id}`);
        return { id, status: stato.suStripe[id] ?? 'canceled', current_period_end: 1_802_000_000 };
      },
      cancel: async (id: string) => {
        stato.annullati.push(id);
        stato.suStripe[id] = 'canceled';
        if (stato.rispostaPersa) { stato.rispostaPersa = false; throw new Error('timeout'); }
        return { id, status: 'canceled' };
      },
      list: async () => ({ data: [] }),
    },
    checkout: {
      sessions: {
        create: async (_p: unknown, opzioni?: { idempotencyKey?: string }) => {
          stato.chiavi.push(opzioni?.idempotencyKey);
          return { url: `https://cassa/${opzioni?.idempotencyKey ?? Math.random()}` };
        },
      },
    },
  }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
}));

const { POST: webhook } = await import('@/app/api/stripe/webhook/route');
const { POST: cassa } = await import('@/app/api/seller/subscription/checkout/route');

async function consegna(evento: Evento): Promise<number> {
  stato.evento = evento;
  const r = await webhook(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' }, body: '{}',
    }) as never,
  );
  return r.status;
}
const apriCassa = async () => {
  const r = await (cassa as unknown as (q: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return { status: r.status, corpo: (await r.json()) as { url?: string } };
};
const pagato = (sub: string): Evento => ({
  id: `evt_${sub}`, type: 'checkout.session.completed',
  data: { object: { id: `cs_${sub}`, mode: 'subscription', payment_status: 'paid', status: 'complete', customer: 'cus_1', subscription: sub, metadata: { kind: 'seller_subscription', seller_id: 's1' } } },
});
const profilo = () => stato.db.tabelle.profiles!.find((r) => r.id === 's1')!;

beforeEach(() => {
  stato.annullati = [];
  stato.chiavi = [];
  stato.rispostaPersa = false;
  stato.profiloCassa = { role: 'seller', is_approved: true, stripe_customer_id: null, subscription_status: null };
  stato.db = fintoDatabase({
    profiles: [{ id: 's1', role: 'seller', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active', subscription_renews_at: null }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
  stato.suStripe = { sub_1: 'active', sub_2: 'active' };
});

describe('R10-019 — due schede non fanno due abbonamenti', () => {
  it('① due casse aperte dallo stesso negozio ricevono la stessa sessione', async () => {
    const prima = await apriCassa();
    const seconda = await apriCassa();
    expect(prima.status).toBe(200);
    expect(stato.chiavi[0], 'nessuna chiave di idempotenza: Stripe crea due sessioni').toBeTruthy();
    expect(stato.chiavi[1]).toBe(stato.chiavi[0]);
    expect(seconda.corpo.url).toBe(prima.corpo.url);
  });

  it('② il secondo abbonamento pagato non copre il primo: il doppione si annulla', async () => {
    expect(await consegna(pagato('sub_2'))).toBe(200);
    expect(profilo().stripe_subscription_id, 'il primo abbonamento è rimasto orfano').toBe('sub_1');
    expect(stato.annullati).toEqual(['sub_2']);
  });

  it('l’annullamento riesce ma la risposta si perde: al ritentativo il primo resta', async () => {
    stato.rispostaPersa = true;
    expect(await consegna(pagato('sub_2')), 'la risposta persa fa riprovare Stripe').toBe(500);
    expect(await consegna(pagato('sub_2'))).toBe(200);
    expect(profilo().stripe_subscription_id, 'al ritentativo il doppione annullato copre il primo').toBe('sub_1');
    expect(profilo().subscription_status).toBe('active');
  });

  it('il primo è in ritardo di pagamento e il nuovo è pagato: resta quello pagato', async () => {
    stato.suStripe = { sub_1: 'past_due', sub_2: 'active' };
    expect(await consegna(pagato('sub_2'))).toBe(200);
    expect(profilo().stripe_subscription_id).toBe('sub_2');
    expect(stato.annullati, 'si annulla l’abbonamento appena pagato').toEqual(['sub_1']);
  });

  it('collaudo K03 — Stripe non trova il precedente: il nuovo abbonamento pagato si attiva lo stesso', async () => {
    stato.suStripe = { sub_1: 'introvabile', sub_2: 'active' };
    expect(await consegna(pagato('sub_2')), 'a ogni ritentativo 500: l’abbonamento pagato non si attiva mai').toBe(200);
    expect(profilo().stripe_subscription_id).toBe('sub_2');
    expect(profilo().subscription_status).toBe('active');
    expect(stato.annullati).toEqual([]);
  });

  it('dopo una disdetta vera il nuovo abbonamento si scrive come prima', async () => {
    stato.suStripe = { sub_1: 'canceled', sub_2: 'active' };
    expect(await consegna(pagato('sub_2'))).toBe(200);
    expect(profilo().stripe_subscription_id).toBe('sub_2');
    expect(stato.annullati).toEqual([]);
  });

  it('lo stesso abbonamento riconsegnato da Stripe non si annulla', async () => {
    expect(await consegna(pagato('sub_1'))).toBe(200);
    expect(profilo().stripe_subscription_id).toBe('sub_1');
    expect(stato.annullati).toEqual([]);
  });
});
