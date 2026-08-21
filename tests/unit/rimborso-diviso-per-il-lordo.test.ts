import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #55 — DUE BASI DIVERSE NELLO STESSO CONTO.
 *
 * Su un ordine in contanti `total_price` è la cassa che il fattorino deve
 * riportare: il totale DOPO lo scomputo del credito MyCity. La quota del
 * negozio (`seller_payout_cents`) nasce invece sul LORDO, prima del credito.
 *
 * Il rimborso li mescolava: `rimborso × netto_venditore / total_price`.
 * Su un ordine da 50 euro pagato con 20 euro di credito, un rimborso da 10
 * euro recuperava dal negozio 10×4500/3000 = 1500 centesimi invece di
 * 10×4500/5000 = 900. Il 67% in più del dovuto, tolto al negoziante senza
 * motivo.
 *
 * E un ordine coperto per intero dal credito aveva `total_price = 0`, quindi
 * il tetto del rimborso era zero: quell'ordine non era rimborsabile in nessun
 * modo, né dal reso né dal reclamo.
 *
 * Queste due prove diventano rosse senza `gross_total_cents`.
 */

type Order = {
  id: string;
  user_id: string;
  total_price: number;
  gross_total_cents: number | null;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  payout_status: string;
  stripe_payment_intent: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  refunded_amount_cents: number;
  payment_method: string;
  rider_payout_status: string | null;
  rider_transfer_id: string | null;
  delivery_status: string;
};

const state: {
  order: Order;
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
} = { order: ordineBase(), updates: [], rpcCalls: [] };

/** Ordine da 50 euro pagato con 20 euro di credito: cassa attesa 30. */
function ordineBase(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 30,
    gross_total_cents: 5000,
    seller_payout_cents: 4500,
    seller_payout_reversed_cents: 0,
    payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null,
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'cod',
    rider_payout_status: null,
    rider_transfer_id: null,
    delivery_status: 'DELIVERED',
  };
}

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_x' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.order, error: null }) }) }),
          update: (u: Record<string, unknown>) => ({
            eq: () => {
              state.updates.push(u);
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
        // Come la funzione vera dopo la migrazione 124: il tetto è il LORDO.
        const tetto = state.order.gross_total_cents ?? Math.round(state.order.total_price * 100);
        const nuovo = state.order.refunded_amount_cents + Number(args.p_delta ?? 0);
        if (nuovo > tetto) return Promise.resolve({ data: [], error: null });
        state.order.refunded_amount_cents = nuovo;
        return Promise.resolve({ data: [{ totale_rimborsato: nuovo, totale_ordine: tetto }], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const { refundOrder } = await import('@/lib/stripe/payout');

describe('il rimborso divide per il lordo, non per quello che resta dopo il credito', () => {
  beforeEach(() => {
    state.order = ordineBase();
    state.updates = [];
    state.rpcCalls = [];
  });

  it('recupera dal negozio la quota calcolata sul lordo di vendita', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 1000, idempotencyKey: 'reso_1' });

    const addebito = state.updates.find((u) => 'seller_payout_reversed_cents' in u);
    expect(addebito).toBeDefined();
    // 1000 × 4500 / 5000 = 900. Con il vecchio denominatore (3000) faceva 1500.
    expect(addebito!.seller_payout_reversed_cents).toBe(900);
  });

  it('un ordine coperto per intero dal credito resta rimborsabile', async () => {
    // Gift card da 50 euro su un ordine da 50: il fattorino non incassa nulla.
    state.order.total_price = 0;
    state.order.gross_total_cents = 5000;

    const esito = await refundOrder({ orderId: 'o1', amountCents: 5000, idempotencyKey: 'reso_2' });
    expect(esito.refundId).toContain('wallet:');

    const accredito = state.rpcCalls.find((c) => c.name === 'wallet_credit');
    expect(accredito?.args.p_cents).toBe(5000);
  });

  it('senza la colonna nuova ricade sul totale, per gli ordini vecchi', async () => {
    state.order.gross_total_cents = null;
    state.order.total_price = 30;

    await refundOrder({ orderId: 'o1', amountCents: 1000, idempotencyKey: 'reso_3' });
    const addebito = state.updates.find((u) => 'seller_payout_reversed_cents' in u);
    // 1000 × 4500 / 3000, limitato al netto: è il comportamento di prima, che
    // per gli ordini nati prima della migrazione 124 resta l'unico possibile.
    expect(addebito!.seller_payout_reversed_cents).toBe(1500);
  });
});
