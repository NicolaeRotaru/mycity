import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scritturaSuUnaRiga } from './aiuti/scrittura-su-una-riga';

/**
 * R31-022 — Il rimborso dell'annullo dell'amministratore su un ordine in viaggio non rimette a scaffale
 * la merce che il fattorino ha già ritirato.
 *
 * `refundOrder` VERO su un database finto e Stripe finto. Chi annulla un ordine con la merce già uscita
 * dal negozio lo dice (`merceNonTorna`): il rimborso esce lo stesso, la merce non si rimette in vendita.
 * Senza quel segno il comportamento resta quello di sempre (la merce torna).
 *
 * Ordine di prova: 30,00 € pagati con la carta, il fattorino per strada.
 */

type Order = {
  id: string;
  user_id: string;
  total_price: number;
  gross_total_cents: number;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  payout_status: string;
  delivery_status: string;
  stripe_payment_intent: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  refunded_amount_cents: number;
  payment_method: string;
  rider_payout_status: string | null;
  rider_transfer_id: string | null;
};

function ordineInConsegna(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 30,
    gross_total_cents: 3000,
    seller_payout_cents: 2250,
    seller_payout_reversed_cents: 0,
    payout_status: 'HELD',
    // Il fattorino e' per strada: la consegna non e' mai avvenuta.
    delivery_status: 'OUT_FOR_DELIVERY',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'card',
    rider_payout_status: null,
    rider_transfer_id: null,
  };
}

const state: {
  order: Order;
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  rimborsiStripe: number[];
} = { order: ordineInConsegna(), updates: [], rpcCalls: [], rimborsiStripe: [] };

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    refunds: {
      create: vi.fn(async (params: { amount: number }) => {
        state.rimborsiStripe.push(params.amount);
        return { id: `re_${state.rimborsiStripe.length}` };
      }),
    },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          // La lettura restituisce una COPIA: in produzione la riga letta e' una
          // fotografia, e le scritture di questa chiamata non la cambiano sotto
          // i piedi. Con l'oggetto vivo la prova sarebbe piu' facile del vero.
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { ...state.order }, error: null }) }) }),
          update: (u: Record<string, unknown>) =>
            scritturaSuUnaRiga(() => state.order as unknown as Record<string, unknown>, () => {
              state.updates.push(u);
              Object.assign(state.order, u);
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
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));


/** Quante volte si e' chiesto al database di rimettere la merce a scaffale. */
function volteCheLaMerceEStataRimessa(): number {
  return state.rpcCalls.filter((c) => c.name === 'restore_stock_for_order').length;
}

beforeEach(() => {
  state.order = ordineInConsegna();
  state.updates = [];
  state.rpcCalls = [];
  state.rimborsiStripe = [];
});

import { refundOrder } from '@/lib/stripe/payout';

describe('R31-022 — il rimborso dell’annullo e la merce già uscita dal negozio', () => {
  it('IL CASO DELLA VOCE — fattorino per strada, annullo dichiarato «la merce non torna»: rimborso pieno, niente a scaffale', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 3000, notifyBuyer: true, merceNonTorna: true });
    expect(state.rimborsiStripe, 'il cliente deve riavere i suoi soldi').toEqual([3000]);
    expect(volteCheLaMerceEStataRimessa(), 'merce rimessa in vendita mentre ce l’ha il fattorino').toBe(0);
  });

  it('merce appena ritirata dal fattorino (PICKED_UP): niente a scaffale nemmeno lì', async () => {
    state.order.delivery_status = 'PICKED_UP';
    await refundOrder({ orderId: 'o1', amountCents: 3000, notifyBuyer: true, merceNonTorna: true });
    expect(volteCheLaMerceEStataRimessa()).toBe(0);
  });

  it('controprova: senza il segno il rimborso pieno rimette la merce, come prima', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 3000, notifyBuyer: true });
    expect(volteCheLaMerceEStataRimessa()).toBe(1);
  });
});
