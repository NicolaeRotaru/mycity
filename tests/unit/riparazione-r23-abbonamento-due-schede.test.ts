import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R23-011 — Con l'abbonamento acceso, due schede aperte creavano due abbonamenti da 50 €, e il
 * primo restava orfano e non si disdiceva dal sito.
 *
 * La chiave di idempotenza della cassa (R10-019) vale dieci minuti: due schede a cavallo della
 * finestra avevano due casse vive. Al primo abbonamento la cassa partiva con `customer_email`,
 * quindi ogni pagamento faceva un cliente Stripe nuovo: il controllo «c'è già un abbonamento?»
 * (che chiede per cliente) non vedeva l'altro, e il portale si apre sul cliente salvato dal
 * webhook, cioè sull'ultimo. Il primo abbonamento dal sito non si raggiungeva più.
 *
 * Qui Stripe è finto ma con memoria: clienti, casse (con la loro chiave di idempotenza) e
 * abbonamenti nascono e si ritrovano come su Stripe. Nessuna chiamata vera.
 */

type Cassa = {
  id: string; url: string; status: 'open' | 'complete'; customer: string | null;
  customer_email: string | null; metadata: Record<string, string>; chiave?: string;
};
const stato = vi.hoisted(() => ({
  clienti: [] as Array<{ id: string; email: string; metadata: Record<string, string>; chiave?: string }>,
  casse: [] as Cassa[],
  abbonamenti: [] as Array<{ id: string; customer: string; status: string }>,
  profilo: {} as Record<string, unknown>,
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
    h({ user: { id: 's1', email: 'forno@example.com' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (tabella: string) => tabella === 'orders'
      // Un negozio che ha già incassato (R10-020): la cassa si apre.
      ? { select: () => ({ eq: () => ({ or: () => ({ limit: async () => ({ data: [{ id: 'o1' }], error: null }) }) }) }) }
      : { select: () => ({ eq: () => ({ single: async () => ({ data: stato.profilo, error: null }) }) }) },
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    customers: {
      list: async (p: { email?: string }) => ({ data: stato.clienti.filter((c) => c.email === p.email) }),
      create: async (p: { email: string; metadata?: Record<string, string> }, o?: { idempotencyKey?: string }) => {
        const gia = o?.idempotencyKey ? stato.clienti.find((c) => c.chiave === o.idempotencyKey) : undefined;
        if (gia) return gia;
        const nuovo = { id: `cus_${stato.clienti.length + 1}`, email: p.email, metadata: p.metadata ?? {}, chiave: o?.idempotencyKey };
        stato.clienti.push(nuovo);
        return nuovo;
      },
    },
    subscriptions: {
      list: async (p: { customer: string }) => ({ data: stato.abbonamenti.filter((a) => a.customer === p.customer) }),
    },
    checkout: {
      sessions: {
        list: async (p: { customer?: string; status?: string }) => ({
          data: stato.casse.filter((c) => (!p.customer || c.customer === p.customer) && (!p.status || c.status === p.status)),
        }),
        create: async (p: Record<string, any>, o?: { idempotencyKey?: string }) => {
          // Stessa chiave, stessa sessione: come Stripe.
          const gia = o?.idempotencyKey ? stato.casse.find((c) => c.chiave === o.idempotencyKey) : undefined;
          if (gia) return gia;
          const n = stato.casse.length + 1;
          const cassa: Cassa = {
            id: `cs_${n}`, url: `https://cassa.test/cs_${n}`, status: 'open',
            customer: p.customer ?? null, customer_email: p.customer_email ?? null,
            metadata: p.metadata ?? {}, chiave: o?.idempotencyKey,
          };
          stato.casse.push(cassa);
          return cassa;
        },
      },
    },
  }),
}));

const { POST } = await import('@/app/api/seller/subscription/checkout/route');

async function apriScheda(): Promise<{ status: number; url?: string }> {
  const r = await (POST as unknown as (q: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  const corpo = (await r.json()) as { url?: string };
  return { status: r.status, url: corpo.url };
}

/** Il negoziante paga la cassa di quella scheda: come Stripe, con `customer_email` nasce un cliente nuovo. */
function paga(url: string): string {
  const cassa = stato.casse.find((c) => c.url === url);
  if (!cassa || cassa.status !== 'open') return '';
  let cliente = cassa.customer;
  if (!cliente) {
    cliente = `cus_${stato.clienti.length + 1}`;
    stato.clienti.push({ id: cliente, email: cassa.customer_email ?? '', metadata: {} });
    cassa.customer = cliente;
  }
  cassa.status = 'complete';
  const sub = `sub_${stato.abbonamenti.length + 1}`;
  stato.abbonamenti.push({ id: sub, customer: cliente, status: 'active' });
  return sub;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.clienti = [];
  stato.casse = [];
  stato.abbonamenti = [];
  // Primo abbonamento: il webhook non ha ancora scritto niente sul profilo.
  stato.profilo = { role: 'seller', is_approved: true, stripe_customer_id: null, subscription_status: null };
});
afterEach(() => {
  vi.useRealTimers();
});

describe('R23-011 — due schede, un abbonamento solo', () => {
  it('due schede a cavallo dei dieci minuti ricevono la stessa cassa, e si paga una volta sola', async () => {
    vi.setSystemTime(new Date('2026-11-13T10:09:59.000+01:00'));
    const prima = await apriScheda();
    vi.setSystemTime(new Date('2026-11-13T10:10:01.000+01:00'));
    const seconda = await apriScheda();

    expect(prima.status).toBe(200);
    expect(seconda.status).toBe(200);
    expect(seconda.url, 'due casse vive: tutte e due si possono pagare').toBe(prima.url);

    paga(prima.url!);
    paga(seconda.url!);
    expect(stato.abbonamenti, 'due abbonamenti da 50 € per lo stesso negozio').toHaveLength(1);
  });

  it('la prima scheda ha già pagato e il webhook non è ancora arrivato: la seconda non apre un altra cassa', async () => {
    vi.setSystemTime(new Date('2026-11-13T10:00:00.000+01:00'));
    const prima = await apriScheda();
    paga(prima.url!);

    vi.setSystemTime(new Date('2026-11-13T10:15:00.000+01:00'));
    const seconda = await apriScheda();
    expect(seconda.status, 'il secondo abbonamento si poteva pagare').toBe(409);
    expect(stato.casse).toHaveLength(1);
    expect(stato.abbonamenti).toHaveLength(1);
  });

  it('ogni cassa del negozio sta sullo stesso cliente Stripe: il portale raggiunge ogni abbonamento', async () => {
    vi.setSystemTime(new Date('2026-11-13T10:00:00.000+01:00'));
    const prima = await apriScheda();
    vi.setSystemTime(new Date('2026-11-13T10:20:00.000+01:00'));
    await apriScheda();

    const clientiDelleCasse = new Set(stato.casse.map((c) => c.customer));
    expect(clientiDelleCasse.size).toBe(1);
    expect([...clientiDelleCasse][0], 'cassa senza cliente: Stripe ne crea uno nuovo a ogni pagamento').toBeTruthy();

    const sub = paga(prima.url!);
    const clienteSalvato = stato.casse.find((c) => c.url === prima.url)!.customer;
    // Il portale (portal/route.ts) si apre sul cliente che il webhook salva: ci sono tutti gli abbonamenti.
    expect(stato.abbonamenti.filter((a) => a.customer === clienteSalvato).map((a) => a.id)).toEqual([sub]);
    expect(stato.clienti.filter((c) => c.email === 'forno@example.com')).toHaveLength(1);
  });

  it('il negozio che ha già un cliente Stripe lo riusa, senza crearne un altro', async () => {
    stato.clienti.push({ id: 'cus_vecchio', email: 'forno@example.com', metadata: {} });
    stato.profilo = { ...stato.profilo, stripe_customer_id: 'cus_vecchio', subscription_status: 'canceled' };
    vi.setSystemTime(new Date('2026-11-13T10:00:00.000+01:00'));
    const prima = await apriScheda();
    expect(prima.status).toBe(200);
    expect(stato.casse[0]!.customer).toBe('cus_vecchio');
    expect(stato.clienti).toHaveLength(1);
  });
});
