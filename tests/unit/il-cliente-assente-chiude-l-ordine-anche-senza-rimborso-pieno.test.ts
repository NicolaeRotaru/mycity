import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ANNULLARE L'ORDINE E RESTITUIRE TUTTI I SOLDI SONO DUE COSE DIVERSE.
 *
 * Il caso vero è «cliente assente»: il fattorino è andato, ha suonato, non ha
 * trovato nessuno. La merce torna al negozio, quindi va rimessa a scaffale e
 * l'ordine è finito. Ma al cliente si restituisce l'importo AL NETTO della
 * consegna: quel viaggio è stato fatto davvero e il fattorino va pagato.
 *
 * Fin qui non si poteva chiedere. `refundOrder` annullava l'ordine e rimetteva
 * la merce a magazzino SOLO quando il rimborso era pieno: chiedendo l'annullo
 * con meno soldi, la merce restava «venduta» — un pezzo di magazzino che il
 * negozio non ha più e che il sito continua a offrire — e l'ordine restava
 * aperto per sempre.
 *
 * Adesso chi decide dichiara la cosa che sa («l'ordine è chiuso, la merce è
 * tornata») e l'importo resta l'importo.
 *
 * Ordine di prova: 30,00 € in tutto, di cui 5,00 € di consegna. Si restituiscono
 * 25,00 €.
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
    // Il fattorino è per strada: la consegna non è mai avvenuta.
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
} = { order: ordineInConsegna(), updates: [], rpcCalls: [] };

vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_x' })) },
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
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';

/** Ha chiesto al database di rimettere la merce a scaffale? */
function merceTornata(): boolean {
  return state.rpcCalls.some((c) => c.name === 'restore_stock_for_order');
}

/** Tutti i valori scritti sull'ordine, appiattiti. */
function scrittoSullOrdine(): Record<string, unknown> {
  return Object.assign({}, ...state.updates);
}

beforeEach(() => {
  state.order = ordineInConsegna();
  state.updates = [];
  state.rpcCalls = [];
});

describe('cliente assente: la merce torna, la consegna no', () => {
  it('con l annullo dichiarato la merce torna a scaffale e l ordine risulta annullato', async () => {
    // 25,00 € su 30,00: i 5,00 della consegna restano al fattorino.
    await refundOrder({ orderId: 'o1', amountCents: 2500, annullaLOrdine: true, idempotencyKey: 'assente_o1' });

    expect(merceTornata(), 'la merce è rimasta «venduta»: il negozio non ce l ha e il sito la offre').toBe(true);
    const scritto = scrittoSullOrdine();
    expect(scritto.delivery_status).toBe('CANCELED');
    expect(scritto.canceled_at).toBeDefined();
  });

  it('ma il pagamento dice la verità: rimborsato in parte, non del tutto', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 2500, annullaLOrdine: true, idempotencyKey: 'assente_o1' });
    const scritto = scrittoSullOrdine();
    expect(scritto.payment_status).toBe('PARTIALLY_REFUNDED');
    // E lo stato del bonifico al negozio non si tocca: dal negozio è già
    // rientrata la quota proporzionale, il resto è una decisione a parte.
    expect(scritto.payout_status).toBeUndefined();
  });

  it('senza dichiararlo, un rimborso parziale resta un rimborso parziale', async () => {
    // È il comportamento di sempre e deve restare: un reso da 5 € su un ordine
    // consegnato non annulla niente e non rimette niente a scaffale.
    await refundOrder({ orderId: 'o1', amountCents: 500, idempotencyKey: 'reso_o1' });

    expect(merceTornata()).toBe(false);
    const scritto = scrittoSullOrdine();
    expect(scritto.delivery_status).toBeUndefined();
    expect(scritto.payment_status).toBe('PARTIALLY_REFUNDED');
  });

  it('il rimborso pieno continua a chiudere tutto da solo, senza dichiarare niente', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 3000, idempotencyKey: 'pieno_o1' });

    expect(merceTornata()).toBe(true);
    const scritto = scrittoSullOrdine();
    expect(scritto.delivery_status).toBe('CANCELED');
    expect(scritto.payment_status).toBe('REFUNDED');
    expect(scritto.payout_status).toBe('REFUNDED');
  });

  it('un ordine gia consegnato non torna «annullato» nemmeno se lo si dichiara', async () => {
    // 054 — la consegna è avvenuta davvero: riscrivere quello stato cancella
    // consegne vere dai numeri e fa sparire l ordine dalle liste operative.
    state.order.delivery_status = 'DELIVERED';
    await refundOrder({ orderId: 'o1', amountCents: 2500, annullaLOrdine: true, idempotencyKey: 'assente_o1' });

    const scritto = scrittoSullOrdine();
    expect(scritto.delivery_status).toBeUndefined();
    // La merce però torna: è quella la cosa che l annullo dichiara.
    expect(merceTornata()).toBe(true);
  });
});
