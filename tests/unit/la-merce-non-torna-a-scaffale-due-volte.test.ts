import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decidiRimessaAScaffale } from '@/lib/ordini/rimessa-a-scaffale';

/**
 * LA MERCE TORNA A SCAFFALE UNA VOLTA SOLA.
 *
 * `restore_stock_for_order` e' una somma secca: chiamarla due volte sullo
 * stesso ordine rimette in vendita il doppio della merce. Il negozio ha un
 * pezzo e il sito ne offre due: il secondo cliente paga una cosa che non
 * esiste, e a valle c'e' un rimborso piu' un negoziante che deve dire di no.
 *
 * Fin qui non succedeva per una COINCIDENZA: la merce tornava solo sul rimborso
 * pieno, e il rimborso pieno capita una volta sola. La bandiera
 * `annullaLOrdine` («cliente assente») ha tolto quella coincidenza senza
 * metterci una difesa al posto suo: 25,00 su 30,00 chiudono l'ordine e
 * rimettono la merce, e i 5,00 che restano possono uscire dopo — una consegna
 * resa per cortesia, una contestazione risolta piu' tardi. Quel secondo
 * rimborso e' pieno, e rimetteva la merce una seconda volta.
 *
 * Ordine di prova: 30,00 € in tutto, di cui 5,00 € di consegna.
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

describe('la merce torna a scaffale una volta sola', () => {
  it('cliente assente, poi i 5,00 che restano: un pezzo torna, non due', async () => {
    // 1) «Cliente assente»: 25,00 su 30,00. L'ordine si chiude, la merce torna.
    await refundOrder({ orderId: 'o1', amountCents: 2500, annullaLOrdine: true, idempotencyKey: 'assente_o1' });
    // 2) Restano 5,00 rimborsabili: la consegna reso per cortesia, o una
    //    contestazione risolta dopo. Questo rimborso arriva a «pieno».
    await refundOrder({ orderId: 'o1', amountCents: 500, idempotencyKey: 'cortesia_o1' });

    expect(
      volteCheLaMerceEStataRimessa(),
      'la merce e tornata due volte: il negozio ha un pezzo e il sito ne offre due',
    ).toBe(1);

    // E i soldi del cliente non si toccano: tutti e due i rimborsi sono usciti.
    expect(state.rimborsiStripe).toEqual([2500, 500]);
    expect(state.order.refunded_amount_cents).toBe(3000);
  });

  it('due volte «cliente assente» sullo stesso ordine: un pezzo torna, non due', async () => {
    // Il doppio clic, o il ritentativo di chi governa il caso.
    await refundOrder({ orderId: 'o1', amountCents: 2000, annullaLOrdine: true, idempotencyKey: 'assente_1' });
    await refundOrder({ orderId: 'o1', amountCents: 500, annullaLOrdine: true, idempotencyKey: 'assente_2' });

    expect(volteCheLaMerceEStataRimessa()).toBe(1);
  });

  it('un reso parziale e poi il rimborso pieno: la merce torna, e torna una volta', async () => {
    // Non e' il difetto: e' il comportamento buono di sempre, e deve restare.
    // Il primo rimborso non chiude niente, il secondo si', ed e' lui che
    // rimette la merce.
    await refundOrder({ orderId: 'o1', amountCents: 500, idempotencyKey: 'reso_o1' });
    expect(volteCheLaMerceEStataRimessa()).toBe(0);

    await refundOrder({ orderId: 'o1', amountCents: 2500, idempotencyKey: 'pieno_o1' });
    expect(volteCheLaMerceEStataRimessa()).toBe(1);
  });

  it('il giro degli ordini fermi annulla PRIMA di rimborsare: la merce torna lo stesso', async () => {
    // `expire-stale-orders` scrive `CANCELED` con la rivendicazione atomica e
    // solo dopo chiede il rimborso: `refundOrder` legge un ordine gia'
    // annullato, ma con zero rimborsato — e li' la merce non l'ha rimessa
    // ancora nessuno. Se la difesa guardasse solo lo stato della consegna,
    // ogni ordine scaduto pagato con carta resterebbe a magazzino zero.
    state.order.delivery_status = 'CANCELED';
    state.order.refunded_amount_cents = 0;

    await refundOrder({ orderId: 'o1', amountCents: 3000, idempotencyKey: 'scaduto_o1' });

    expect(volteCheLaMerceEStataRimessa(), 'ordine scaduto e rimborsato, ma la merce non e tornata').toBe(1);
  });
});

describe('la regola, chiamata da sola', () => {
  const ordineAnnullato = { delivery_status: 'CANCELED' };

  it('ordine che resta aperto: la merce non si muove', () => {
    expect(
      decidiRimessaAScaffale({ ordineDaChiudere: false, ordine: { delivery_status: 'DELIVERED' }, giaRimborsatoPrimaCents: 0 }),
    ).toEqual({ rimetti: false, perche: 'ordine-aperto' });
  });

  it('ordine chiuso da un rimborso precedente: non si somma una seconda volta', () => {
    expect(
      decidiRimessaAScaffale({ ordineDaChiudere: true, ordine: ordineAnnullato, giaRimborsatoPrimaCents: 2500 }),
    ).toEqual({ rimetti: false, perche: 'gia-chiuso-da-un-rimborso' });
  });

  it('ordine annullato da qualcun altro, nessun rimborso prima: la merce tocca a noi', () => {
    expect(
      decidiRimessaAScaffale({ ordineDaChiudere: true, ordine: ordineAnnullato, giaRimborsatoPrimaCents: 0 }),
    ).toEqual({ rimetti: true });
  });

  it('primo rimborso che chiude un ordine ancora in consegna: la merce torna', () => {
    expect(
      decidiRimessaAScaffale({
        ordineDaChiudere: true,
        ordine: { delivery_status: 'OUT_FOR_DELIVERY' },
        giaRimborsatoPrimaCents: 0,
      }),
    ).toEqual({ rimetti: true });
  });
});
