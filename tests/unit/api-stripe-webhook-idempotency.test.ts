import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Webhook Stripe — IDEMPOTENZA via stripe_event_log.
 * Stripe puo' rispedire lo stesso evento piu' volte. Regole (route:54-73,120-124):
 *  - evento nuovo               -> processa l'handler e marca processed=true
 *  - duplicato gia' processed   -> ritorna {duplicated:true} SENZA riprocessare
 *  - duplicato NON processed    -> riprocessa (un tentativo precedente era fallito)
 * Usiamo l'evento payment_intent.payment_failed (handler = solo log) per isolare
 * la logica di idempotenza dal resto del DB.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const EVENT = {
  id: 'evt_dup',
  type: 'payment_intent.payment_failed',
  data: { object: { id: 'pi_x', last_payment_error: null } },
};

const state: {
  insertResult: { error: unknown };
  existing: { data: { processed: boolean } | null };
} = {
  insertResult: { error: null },
  existing: { data: { processed: false } },
};

// Spy sull'UPDATE di stripe_event_log: viene chiamato SOLO dopo che l'handler ha
// avuto successo (mai nel ramo "duplicato gia' processed", che ritorna prima).
const eventLogUpdate = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => EVENT } }),
  computeApplicationFeeCents: (c: number) => Math.round((c * 800) / 10000),
  isStripeConfigured: () => true,
}));

vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: vi.fn(),
  applyConnectAccountStatus: vi.fn(),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({})) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    from: (table: string) => {
      if (table === 'stripe_event_log') {
        return {
          insert: () => Promise.resolve(state.insertResult),
          select: () => ({ eq: () => ({ single: () => Promise.resolve(state.existing) }) }),
          update: eventLogUpdate,
        };
      }
      return {
        insert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function makeReq(): never {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
    body: JSON.stringify(EVENT),
  }) as never;
}

describe('POST /api/stripe/webhook — idempotenza', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.insertResult = { error: null };
    state.existing = { data: { processed: false } };
  });

  it('evento nuovo: processa e marca processed=true', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.duplicated).toBeUndefined();
    expect(eventLogUpdate).toHaveBeenCalledTimes(1); // marcato come processato
  });

  it('duplicato gia processato: ritorna duplicated senza riprocessare', async () => {
    state.insertResult = { error: { code: '23505' } }; // unique violation
    state.existing = { data: { processed: true } };
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicated).toBe(true);
    expect(eventLogUpdate).not.toHaveBeenCalled(); // handler NON rieseguito
  });

  it('duplicato non completato: riprocessa (retry dopo fallimento)', async () => {
    state.insertResult = { error: { code: '23505' } };
    state.existing = { data: { processed: false } };
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicated).toBeUndefined();
    expect(eventLogUpdate).toHaveBeenCalledTimes(1); // riprocessato e rimarcato
  });
});
