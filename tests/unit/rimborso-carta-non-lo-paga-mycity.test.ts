import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DUE DIFETTI SUI RIMBORSI CON CARTA, TROVATI DALLA RADIOGRAFIA DEL 21/8/2026.
 *
 * ① LA QUOTA DEL NEGOZIO NON VENIVA MAI ADDEBITATA, E LA METTEVA MYCITY.
 *    Quando si rimborsa un ordine il cui bonifico al negozio non è ancora
 *    partito, non c'è nessun bonifico da stornare. Il ramo dei CONTANTI se ne
 *    accorgeva e registrava comunque la quota in `seller_payout_reversed_cents`,
 *    così il pagamento successivo versava il residuo. Il ramo della CARTA non
 *    aveva niente di equivalente: il negozio incassava il netto pieno, rimborso
 *    compreso, e la differenza restava alla piattaforma.
 *    E non è il caso raro: il bonifico parte un'ora dopo la consegna, mentre
 *    resi e reclami arrivano dopo. Era una perdita su OGNI reso con carta.
 *
 * ② UN RIFIUTO DI STRIPE LASCIAVA L'ORDINE «RIMBORSATO» SENZA RIMBORSO.
 *    Il rimborso si registra nel database prima di chiamare Stripe — giusto,
 *    chiude la corsa del doppio rimborso. Ma se Stripe rifiutava, restava
 *    scritto «rimborsato» su un cliente che non aveva ricevuto niente, e il
 *    tetto dentro `accumula_rimborso` impediva di riprovare: quell'ordine
 *    diventava non rimborsabile da nessuna strada.
 *
 * Queste due prove diventano rosse se uno dei due torna.
 */

type Order = {
  id: string;
  user_id: string;
  total_price: number;
  gross_total_cents: number;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  payout_status: string;
  stripe_payment_intent: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  refunded_amount_cents: number;
  payment_method: string;
};

function baseOrder(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 20,
    gross_total_cents: 2000,
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 0,
    // Il bonifico NON è ancora partito: è il caso normale, non quello raro.
    payout_status: 'HELD',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'card',
  };
}

const state: {
  order: Order;
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  stripeRifiuta: boolean;
} = { order: baseOrder(), updates: [], rpcCalls: [], stripeRifiuta: false };

const refundsCreate = vi.fn(async () => {
  if (state.stripeRifiuta) throw new Error('carta scaduta');
  return { id: 're_x' };
});
const createReversal = vi.fn(async () => ({ id: 'trr_1' }));

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ refunds: { create: refundsCreate }, transfers: { createReversal } }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.order, error: null }) }) }),
          update: (u: Record<string, unknown>) => ({
            eq: () => {
              state.updates.push(u);
              Object.assign(state.order, u);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === 'accumula_rimborso') {
        const totale = state.order.gross_total_cents;
        const nuovo = (state.order.refunded_amount_cents ?? 0) + Number(args.p_delta ?? 0);
        if (nuovo > totale) return Promise.resolve({ data: [], error: null });
        state.order.refunded_amount_cents = nuovo;
        return Promise.resolve({ data: [{ totale_rimborsato: nuovo, totale_ordine: totale }], error: null });
      }
      if (name === 'storna_rimborso') {
        state.order.refunded_amount_cents = Math.max(
          0, (state.order.refunded_amount_cents ?? 0) - Number(args.p_delta ?? 0),
        );
        return Promise.resolve({ data: state.order.refunded_amount_cents, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';

beforeEach(() => {
  state.order = baseOrder();
  state.updates = [];
  state.rpcCalls = [];
  state.stripeRifiuta = false;
  refundsCreate.mockClear();
  createReversal.mockClear();
});

describe('rimborso con carta prima che il negozio sia pagato', () => {
  it('addebita al negozio la sua quota, invece di lasciarla a MyCity', async () => {
    // Ordine da 20 €, di cui 18 € spettano al negozio. Rimborso pieno.
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    const quota = state.updates.find((u) => u.seller_payout_reversed_cents !== undefined);
    expect(quota, 'la quota del negozio non è stata addebitata da nessuna parte').toBeDefined();
    expect(quota?.seller_payout_reversed_cents).toBe(1800);
  });

  it('su un rimborso parziale addebita solo la parte proporzionale', async () => {
    // Metà ordine rimborsato → metà della quota del negozio.
    await refundOrder({ orderId: 'o1', amountCents: 1000, idempotencyKey: 'return_r2' });

    const quota = state.updates.find((u) => u.seller_payout_reversed_cents !== undefined);
    expect(quota?.seller_payout_reversed_cents).toBe(900);
  });

  it('se il bonifico era già partito storna quello, senza addebitare due volte', async () => {
    state.order = { ...baseOrder(), payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1' };
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r3' });

    expect(createReversal).toHaveBeenCalledTimes(1);
    // Lo storno del bonifico scrive già lui la quota. Il punto è che non venga
    // scritta una seconda volta sopra: 18 € addebitati, non 36.
    const quote = state.updates
      .filter((u) => u.seller_payout_reversed_cents !== undefined)
      .map((u) => u.seller_payout_reversed_cents);
    expect(quote.length, 'la quota è stata scritta più di una volta').toBe(1);
    expect(state.order.seller_payout_reversed_cents, 'quota addebitata due volte').toBe(1800);
  });
});

describe('quando Stripe rifiuta il rimborso', () => {
  it('l\'ordine non resta segnato come rimborsato', async () => {
    state.stripeRifiuta = true;

    await expect(
      refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r4' }),
    ).rejects.toThrow('carta scaduta');

    expect(state.rpcCalls.some((c) => c.name === 'storna_rimborso'), 'nessuno storno chiamato').toBe(true);
    expect(
      state.order.refunded_amount_cents,
      'il database dice «rimborsato» su un cliente che non ha ricevuto niente',
    ).toBe(0);
  });

  it('dopo il rifiuto si può riprovare, e la seconda volta funziona', async () => {
    state.stripeRifiuta = true;
    await expect(refundOrder({ orderId: 'o1', amountCents: 2000 })).rejects.toThrow();

    state.stripeRifiuta = false;
    const res = await refundOrder({ orderId: 'o1', amountCents: 2000 });
    expect(res.refundId).toBe('re_x');
    expect(state.order.refunded_amount_cents).toBe(2000);
  });
});
