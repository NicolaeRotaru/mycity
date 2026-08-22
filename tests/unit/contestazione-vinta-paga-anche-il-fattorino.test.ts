import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #158 — CONTESTAZIONE VINTA: AL NEGOZIO I SOLDI TORNANO, AL FATTORINO NO.
 *
 * All'apertura di un chargeback il webhook richiama indietro sia il pagamento
 * del negozio sia il compenso del fattorino — ed è il caso normale, perché il
 * bonifico parte un'ora dopo la consegna mentre la contestazione arriva
 * settimane dopo.
 *
 * Quando poi la contestazione si vince, il codice rimetteva in coda SOLO il
 * venditore. Il fattorino restava a 'REVERSED' per sempre: aveva fatto la
 * consegna, la piattaforma teneva l'incasso, e lui non veniva pagato — senza
 * nessun avviso. Su chi è pagato a consegna questo diventa abbandono.
 *
 * Secondo strato: la chiave di idempotenza del bonifico era
 * `payout_rider_<ordine>`, sempre la stessa. Anche rimettendolo in coda,
 * Stripe avrebbe restituito il vecchio bonifico — quello già stornato. Serve
 * un numero di tentativo dentro la chiave, e questa prova pretende che salga.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const state: {
  ordini: Array<Record<string, unknown>>;
  aggiornamenti: Array<{ payload: Record<string, unknown>; id: string | null }>;
} = { ordini: [], aggiornamenti: [] };

function event() {
  return {
    id: 'evt_won_rider',
    type: 'charge.dispute.closed',
    data: { object: { id: 'dp_1', status: 'won', payment_intent: 'pi_1', charge: 'ch_1' } },
  };
}

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ webhooks: { constructEvent: () => event() } }),
  computeApplicationFeeCents: () => 0,
  computeSellerPayoutCents: () => 0,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
  isStripeConfigured: () => true,
}));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: vi.fn(),
  reverseRiderTransfer: vi.fn(),
  applyConnectAccountStatus: vi.fn(),
  refundOrder: vi.fn(),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({})) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: vi.fn(() => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
    from: (table: string) => {
      if (table === 'stripe_event_log') {
        return {
          insert: () => Promise.resolve({ error: null }),
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { processed: false } }) }) }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: state.ordini, error: null }) }),
          update: (payload: Record<string, unknown>) => ({
            in: () => {
              state.aggiornamenti.push({ payload, id: null });
              return Promise.resolve({ error: null });
            },
            eq: (_col: string, id: string) => {
              state.aggiornamenti.push({ payload, id });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === 'profiles') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'admin1' }], error: null }) }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  })),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function makeReq(): never {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
    body: '{}',
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.aggiornamenti = [];
  state.ordini = [{
    id: 'o1',
    payout_status: 'REVERSED',
    payout_tentativo: 0,
    rider_id: 'r1',
    rider_payout_status: 'REVERSED',
    rider_payout_tentativo: 0,
    rider_fee_cents: 300,
  }];
});

describe('contestazione vinta', () => {
  it('rimette in coda il compenso del fattorino, non solo il pagamento del negozio', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);

    const rider = state.aggiornamenti.find((a) => 'rider_payout_status' in a.payload);
    expect(rider, 'il fattorino non è stato rimesso in coda').toBeDefined();
    expect(rider!.payload).toMatchObject({
      rider_payout_status: 'HELD',
      rider_transfer_id: null,
      rider_payout_reversed_cents: 0,
    });
  });

  it('alza il numero del tentativo, così la chiave Stripe non restituisce il bonifico già stornato', async () => {
    await POST(makeReq());

    const venditore = state.aggiornamenti.find((a) => a.payload.payout_status === 'HELD');
    expect(venditore!.payload.payout_tentativo).toBe(1);

    const rider = state.aggiornamenti.find((a) => a.payload.rider_payout_status === 'HELD');
    expect(rider!.payload.rider_payout_tentativo).toBe(1);
  });

  it('un fattorino mai pagato non viene rimesso in coda per sbaglio', async () => {
    state.ordini = [{
      id: 'o2', payout_status: 'REVERSED', payout_tentativo: 0,
      rider_id: null, rider_payout_status: null, rider_payout_tentativo: 0,
    }];
    await POST(makeReq());
    expect(state.aggiornamenti.some((a) => 'rider_payout_status' in a.payload)).toBe(false);
  });
});
