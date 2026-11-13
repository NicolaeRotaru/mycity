import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase } from './aiuti/finto-database-dei-pagamenti';
import { tassoAutorizzazione, type TentativoPagamento } from '@/lib/pagamenti/tasso-autorizzazione';

/**
 * R23-008 — Il tasso dei pagamenti riusciti mescolava i clienti che comprano con i negozi che
 * pagano noi.
 *
 * Stripe manda `payment_intent.succeeded` / `payment_failed` per ogni pagamento: un ordine di un
 * cliente, un buono regalo, ma anche la fattura dell'abbonamento di un negozio (50 €) o uno
 * spazio sponsorizzato. Il webhook li scriveva tutti in `payment_attempts`, e la Panoramica
 * dell'admin ne faceva una percentuale sola. Una carta del negozio rifiutata sul canone faceva
 * sembrare rotta la cassa dei clienti, e viceversa.
 *
 * Qui: il webhook vero (Stripe finto), il database finto dei pagamenti, il conto della Panoramica
 * (`tassoAutorizzazione`) e la cassa vera del buono regalo, per vedere che segno porta il suo pagamento.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } } as { id: string; type: string; data: { object: Record<string, unknown> } },
  parametriCassa: null as null | Record<string, any>,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/funzioni-al-lancio', async (orig) => ({
  ...(await orig<typeof import('@/lib/funzioni-al-lancio')>()),
  BUONI_REGALO_IN_VENDITA: true,
}));
vi.mock('@/lib/env', async (orig) => ({
  ...(await orig<typeof import('@/lib/env')>()),
  env: { ...(await orig<typeof import('@/lib/env')>()).env, appUrl: () => 'http://localhost' },
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: Record<string, unknown>) => unknown) => (req: Request) =>
    h({ user: { id: 'cliente-1', email: 'mamma@example.com', email_confirmed_at: '2026-10-01T10:00:00Z' }, req }),
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    // La charge non serve a questa prova: senza `latest_charge` non si chiede niente.
    paymentIntents: { retrieve: async (id: string) => ({ id, metadata: {} }) },
    checkout: {
      sessions: {
        create: async (p: Record<string, any>) => {
          stato.parametriCassa = p;
          return { id: 'cs_buono', url: 'https://cassa.test/cs_buono' };
        },
      },
    },
  }),
}));

const { POST: webhook } = await import('@/app/api/stripe/webhook/route');
const { POST: cassaBuono } = await import('@/app/api/gift-cards/checkout/route');

async function esito(id: string, type: 'payment_intent.succeeded' | 'payment_intent.payment_failed', pi: Record<string, unknown>) {
  stato.evento = { id, type, data: { object: pi } };
  const r = await webhook(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' }, body: '{}',
    }) as never,
  );
  expect(r.status).toBe(200);
}

/** Il pagamento del buono come lo crea Stripe dalla cassa: i metadati sono quelli di `payment_intent_data`. */
async function pagamentoDelBuono(): Promise<Record<string, unknown>> {
  const r = await (cassaBuono as unknown as (q: Request) => Promise<Response>)(new Request('http://x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': 'tentativo-1' },
    body: JSON.stringify({ amountEuro: 25, recipientName: 'Nonna', recipientEmail: 'nonna@example.com' }),
  }));
  expect(r.status).toBe(200);
  return { id: 'pi_buono', amount: 2500, metadata: { ...(stato.parametriCassa?.payment_intent_data?.metadata ?? {}) }, latest_charge: null };
}

const tasso = () => tassoAutorizzazione((stato.db.tabelle.payment_attempts ?? []) as TentativoPagamento[]);

beforeEach(() => {
  stato.parametriCassa = null;
  stato.db = fintoDatabase({ payment_attempts: [], stripe_event_log: [], notifications: [] });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
});

describe('R23-008 — il tasso dei pagamenti è quello dei clienti', () => {
  it('ordini e buoni regalo contano; il canone di un negozio e lo spazio sponsorizzato no', async () => {
    // Due clienti: un ordine passato e un buono regalo passato.
    await esito('evt_ordine', 'payment_intent.succeeded', {
      id: 'pi_ordine', amount: 2790, latest_charge: null,
      metadata: { buyer_user_id: 'u1', pending_checkout_id: '11111111-1111-1111-1111-111111111111', seller_count: '1' },
    });
    await esito('evt_buono', 'payment_intent.succeeded', await pagamentoDelBuono());
    // Due negozi che pagano noi: la carta del Forno rifiutata sul canone da 50 €, e uno spazio sponsorizzato rifiutato.
    await esito('evt_canone', 'payment_intent.payment_failed', {
      id: 'pi_canone', amount: 5000, latest_charge: null, metadata: {}, invoice: 'in_1', description: 'Subscription creation',
      last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
    });
    await esito('evt_vetrina', 'payment_intent.payment_failed', {
      id: 'pi_vetrina', amount: 1500, latest_charge: null, metadata: {},
      last_payment_error: { code: 'card_declined', decline_code: 'do_not_honor' },
    });

    const righe = stato.db.tabelle.payment_attempts ?? [];
    expect(righe.map((r) => r.payment_intent_id), 'i pagamenti dei negozi sono finiti nel tasso dei clienti').toEqual(['pi_ordine', 'pi_buono']);
    expect(tasso(), '2 su 4 = la cassa dei clienti sembra rotta a metà').toMatchObject({ riusciti: 2, tentativi: 2, tasso: 1 });
  });

  it('la cassa del buono regalo mette il segno anche sul pagamento, non solo sulla sessione', async () => {
    await pagamentoDelBuono();
    expect(stato.parametriCassa?.payment_intent_data?.metadata).toMatchObject({ kind: 'gift_card', buyer_id: 'cliente-1' });
    // E la sessione resta com'era: il webhook del buono la riconosce dal suo `kind`.
    expect(stato.parametriCassa?.metadata?.kind).toBe('gift_card');
  });

  it('un rifiuto sulla carta di un cliente conta ancora come rifiuto', async () => {
    await esito('evt_rifiuto', 'payment_intent.payment_failed', {
      id: 'pi_ordine2', amount: 1200, latest_charge: null,
      metadata: { buyer_user_id: 'u2', pending_checkout_id: '22222222-2222-2222-2222-222222222222', seller_count: '1' },
      last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
    });
    expect(tasso()).toMatchObject({ riusciti: 0, falliti: 1, tentativi: 1 });
  });
});
