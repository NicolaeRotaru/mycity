import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Webhook Stripe — IDEMPOTENZA via stripe_event_log.
 * Stripe puo' rispedire lo stesso evento piu' volte. Regole:
 *  - evento nuovo               -> processa l'handler e marca processed=true
 *  - duplicato gia' processed   -> ritorna {duplicated:true} SENZA riprocessare
 *  - duplicato NON processed    -> lo si RIVENDICA e si riprocessa; se la
 *    rivendicazione non passa (un'altra consegna concorrente ce l'ha in mano)
 *    si risponde 200 e non si fa niente.
 *
 * 062 — Prima bastava leggere `processed`: due consegne dello stesso evento
 * arrivate insieme leggevano entrambe «non processato» e creavano entrambe gli
 * ordini. La rivendicazione è ciò che rende la lettura una decisione.
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
  /** Righe restituite dalla rivendicazione: vuoto = un altro l'ha già presa. */
  rivendicate: Array<{ event_id: string }>;
} = {
  insertResult: { error: null },
  existing: { data: { processed: false } },
  rivendicate: [{ event_id: 'evt_dup' }],
};

// Spy sull'UPDATE di stripe_event_log: viene chiamato SOLO dopo che l'handler ha
// avuto successo (mai nel ramo "duplicato gia' processed", che ritorna prima).
const eventLogUpdate = vi.fn();
const claimUpdate = vi.fn();

/** L'update su stripe_event_log serve a due cose: rivendicare (finisce con
 *  `.select()`) e marcare come processato (finisce con `.eq()` atteso). */
function updateChain(patch: Record<string, unknown>) {
  const marcaturaFinale = 'processed' in patch;
  if (marcaturaFinale) eventLogUpdate(patch); else claimUpdate(patch);
  const chain: Record<string, unknown> = {
    eq: () => chain,
    or: () => chain,
    select: () => Promise.resolve({ data: state.rivendicate, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ error: null }),
  };
  return chain;
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => EVENT } }),
  computeApplicationFeeCents: (c: number) => Math.round((c * 800) / 10000),
  computeOrderSplit: (a: { totalCents: number; deliveryFeeCents: number; shippingCents: number }) => {
    const subtotalCents = Math.max(0, a.totalCents - a.deliveryFeeCents - a.shippingCents);
    const applicationFeeCents = Math.round((subtotalCents * 800) / 10000);
    return { subtotalCents, applicationFeeCents, sellerPayoutCents: Math.max(0, subtotalCents - applicationFeeCents) };
  },
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
          update: updateChain,
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
    state.rivendicate = [{ event_id: 'evt_dup' }];
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
    // Un evento già processato non si rivendica: la condizione processed=false
    // non lo prende.
    state.rivendicate = [];
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicated).toBe(true);
    expect(eventLogUpdate).not.toHaveBeenCalled(); // handler NON rieseguito
  });

  // 062 — Il caso che prima passava due volte: stesso evento, due consegne
  // insieme, nessuna delle due ancora completata. Chi non rivendica se ne va.
  it('due consegne concorrenti dello stesso evento: la seconda non riprocessa', async () => {
    state.insertResult = { error: { code: '23505' } };
    state.existing = { data: { processed: false } };
    state.rivendicate = []; // l'altra consegna l'ha già in mano
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicated).toBe(true);
    expect(eventLogUpdate).not.toHaveBeenCalled();
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
