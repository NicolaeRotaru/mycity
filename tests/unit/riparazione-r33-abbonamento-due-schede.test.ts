import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';

/**
 * R33-008 — Con l'abbonamento acceso, due schede aperte creavano due abbonamenti da 50 €:
 * la cassa partiva senza cliente Stripe (`customer_email`), quindi ogni sessione nasceva
 * su un cliente nuovo; la chiave di idempotenza valeva solo dentro la stessa finestra di
 * 10 minuti; e il webhook scriveva il secondo abbonamento sopra al primo. Il primo restava
 * orfano: pagato ogni mese, e il portale del sito apriva solo il cliente del secondo.
 */

type Sessione = { id: string; url: string; customer: string; status: 'open' | 'complete'; metadata: Record<string, string> };
const stato = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  clientiCreati: [] as string[],
  sessioni: [] as Sessione[],
  perChiave: {} as Record<string, Sessione>,
  abbonamenti: [] as Array<{ id: string; status: string; customer: string }>,
  suStripe: {} as Record<string, string>,
  annullati: [] as string[],
}));

vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  ABBONAMENTO_NEGOZI_ACCESO: true,
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
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
      // Un negozio che ha già incassato: la cassa si apre.
      ? { select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: [{ id: 'o1' }], error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ single: async () => ({
          data: { ...stato.db.tabelle.profiles!.find((r) => r.id === 's1') }, error: null,
        }) }) }) },
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    customers: {
      list: async () => ({ data: [] }),
      create: async () => {
        const id = `cus_${stato.clientiCreati.length + 1}`;
        stato.clientiCreati.push(id);
        return { id };
      },
    },
    subscriptions: {
      list: async ({ customer }: { customer: string }) => ({ data: stato.abbonamenti.filter((a) => a.customer === customer) }),
      retrieve: async (id: string) => ({ id, status: stato.suStripe[id] ?? 'canceled', current_period_end: 1_802_000_000 }),
      cancel: async (id: string) => { stato.annullati.push(id); return { id, status: 'canceled' }; },
    },
    checkout: {
      sessions: {
        list: async ({ customer, status }: { customer: string; status: string }) => ({
          data: stato.sessioni.filter((s) => s.customer === customer && s.status === status),
        }),
        create: async (p: { customer?: string; metadata: Record<string, string> }, opzioni?: { idempotencyKey?: string }) => {
          const chiave = opzioni?.idempotencyKey;
          if (chiave && stato.perChiave[chiave]) return stato.perChiave[chiave];
          const n = stato.sessioni.length + 1;
          // Senza `customer` Stripe crea un cliente nuovo per la sessione (da customer_email).
          const s: Sessione = { id: `cs_${n}`, url: `https://cassa/${n}`, customer: p.customer ?? `cus_da_email_${n}`, status: 'open', metadata: p.metadata };
          stato.sessioni.push(s);
          if (chiave) stato.perChiave[chiave] = s;
          return s;
        },
      },
    },
  }),
}));

const { POST: cassa } = await import('@/app/api/seller/subscription/checkout/route');
const { handleSellerSubscription } = await import('@/lib/stripe/webhook/abbonamenti');

const apriCassa = async () => {
  const r = await (cassa as unknown as (q: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return { status: r.status, corpo: (await r.json()) as { url?: string } };
};
const profilo = () => stato.db.tabelle.profiles!.find((r) => r.id === 's1')!;
const pagata = (sub: string) =>
  ({ id: `cs_${sub}`, mode: 'subscription', customer: 'cus_1', subscription: sub, metadata: { kind: 'seller_subscription', seller_id: 's1' } }) as never;
const avvisiDoppio = () => stato.db.tabelle.notifications!.filter((n) => /due abbonamenti/i.test(String(n.title)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T10:09:00+01:00'));
  stato.clientiCreati = [];
  stato.sessioni = [];
  stato.perChiave = {};
  stato.abbonamenti = [];
  stato.annullati = [];
  stato.suStripe = {};
  stato.db = fintoDatabase({
    profiles: [{ id: 's1', role: 'seller', is_approved: true, stripe_customer_id: null, stripe_subscription_id: null, subscription_status: null, subscription_renews_at: null }],
    notifications: [],
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('R33-008 — la cassa: un cliente solo e una cassa sola per negozio', () => {
  it('due schede a cavallo dei 10 minuti ricevono la stessa cassa, sullo stesso cliente', async () => {
    const prima = await apriCassa();
    vi.setSystemTime(new Date('2026-11-17T10:11:00+01:00'));
    const seconda = await apriCassa();
    expect(prima.status).toBe(200);
    expect(seconda.status).toBe(200);
    expect(seconda.corpo.url, 'la seconda scheda apre una seconda cassa: due abbonamenti').toBe(prima.corpo.url);
    expect(stato.sessioni).toHaveLength(1);
    expect(profilo().stripe_customer_id, 'il cliente Stripe del negozio non è salvato prima della cassa').toBe('cus_1');
    expect(stato.sessioni[0]!.customer).toBe('cus_1');
  });

  it('due schede nello stesso istante, senza cliente: tutte e due usano il cliente salvato per primo', async () => {
    const [a, b] = await Promise.all([apriCassa(), apriCassa()]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const salvato = profilo().stripe_customer_id;
    expect(salvato).toBeTruthy();
    expect(stato.sessioni.length).toBeGreaterThan(0);
    for (const s of stato.sessioni) expect(s.customer, 'una cassa su un cliente diverso da quello del negozio').toBe(salvato);
  });

  it('un abbonamento «incompleto» sul cliente blocca la seconda cassa', async () => {
    profilo().stripe_customer_id = 'cus_1';
    stato.abbonamenti = [{ id: 'sub_1', status: 'incomplete', customer: 'cus_1' }];
    const r = await apriCassa();
    expect(r.status, 'col primo pagamento in corso si apre un secondo abbonamento').toBe(409);
    expect(stato.sessioni).toHaveLength(0);
  });
});

describe('R33-008 — il webhook: il secondo abbonamento non lascia orfano il primo', () => {
  beforeEach(() => {
    Object.assign(profilo(), { stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1', subscription_status: 'active' });
  });

  it('il primo è in corso: resta sul profilo, niente si annulla da solo e il negozio è avvisato', async () => {
    stato.suStripe = { sub_1: 'active', sub_2: 'active' };
    await handleSellerSubscription(pagata('sub_2'));
    expect(profilo().stripe_subscription_id, 'il secondo copre il primo: il primo resta orfano').toBe('sub_1');
    expect(profilo().subscription_status).toBe('active');
    expect(stato.annullati).toEqual([]);
    expect(avvisiDoppio()).toHaveLength(1);
  });

  it('il primo è in ritardo di pagamento e il nuovo è pagato: resta il nuovo, e il negozio è avvisato del vecchio', async () => {
    stato.suStripe = { sub_1: 'past_due', sub_2: 'active' };
    await handleSellerSubscription(pagata('sub_2'));
    expect(profilo().stripe_subscription_id).toBe('sub_2');
    expect(profilo().subscription_status).toBe('active');
    expect(stato.annullati).toEqual([]);
    expect(avvisiDoppio()).toHaveLength(1);
  });

  it('dopo una disdetta vera il nuovo si scrive come prima, senza avviso di doppione', async () => {
    stato.suStripe = { sub_1: 'canceled', sub_2: 'active' };
    await handleSellerSubscription(pagata('sub_2'));
    expect(profilo().stripe_subscription_id).toBe('sub_2');
    expect(avvisiDoppio()).toHaveLength(0);
  });
});
