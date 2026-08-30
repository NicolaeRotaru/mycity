import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R043) — DOPO CHE I SOLDI SONO USCITI, NON SI PUÒ PIÙ TORNARE INDIETRO.
 *
 * `refundOrder` fa le cose in quest'ordine: registra il rimborso, chiama
 * Stripe, e SOLO DOPO recupera dal negozio la sua quota (`reverseOrderTransfer`,
 * che è un'altra chiamata di rete). Quel recupero non era protetto da niente.
 *
 * Se Stripe rispondeva male su quella seconda chiamata — rete che cade, conto
 * Connect in un momento storto — la funzione moriva lì. Ma il rimborso al
 * cliente era GIÀ uscito. Restava un ordine con: il pagamento ancora scritto
 * come «pagato», la merce non rimessa a scaffale, il reso ancora aperto, e
 * l'importo già segnato come rimborsato per intero — che al secondo tentativo
 * faceva scattare «importo rimborso non valido». Cioè: quel reso non si poteva
 * più chiudere in nessun modo, e nessuno lo veniva a sapere.
 *
 * Adesso il recupero mancato è un lavoro da fare a mano — l'ordine lo dice, e
 * gli amministratori ricevono l'avviso — mentre tutto il resto del rimborso va
 * comunque a termine. È lo stesso trattamento che ha da sempre il recupero del
 * compenso del fattorino, poche righe più sotto.
 */

type Order = {
  id: string;
  user_id: string;
  total_price: number;
  gross_total_cents: number;
  seller_payout_cents: number;
  seller_payout_reversed_cents: number;
  payout_status: string;
  payment_status?: string;
  delivery_status: string;
  stripe_payment_intent: string | null;
  stripe_transfer_id: string | null;
  stripe_reversal_id: string | null;
  refunded_amount_cents: number;
  payment_method: string;
};

/** Un ordine consegnato e già pagato al negozio: è il caso normale dei resi. */
function ordineGiaPagatoAlNegozio(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 20,
    gross_total_cents: 2000,
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 0,
    payout_status: 'TRANSFERRED',
    payment_status: 'PAID',
    delivery_status: 'DELIVERED',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: 'tr_1',
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'card',
  };
}

const state: {
  order: Order;
  updates: Record<string, unknown>[];
  rpcCalls: string[];
  notifiche: Array<{ title: string; body: string }>;
  stornoRompe: boolean;
} = { order: ordineGiaPagatoAlNegozio(), updates: [], rpcCalls: [], notifiche: [], stornoRompe: false };

const refundsCreate = vi.fn(async () => ({ id: 're_x' }));
const createReversal = vi.fn(async () => {
  if (state.stornoRompe) throw new Error('Stripe non risponde');
  return { id: 'trr_1' };
});

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
          // Una copia, non il riferimento: chi legge l'ordine si porta dietro
          // una fotografia, come fa il database vero. Con il riferimento le
          // scritture fatte dopo cambiavano anche quello che il codice aveva
          // letto prima, e la prova misurava il finto invece del vero.
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
      if (table === 'profiles') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'admin-1' }], error: null }) }) };
      }
      if (table === 'notifications') {
        return {
          insert: (righe: Array<{ title: string; body: string }>) => {
            state.notifiche.push(...righe);
            return Promise.resolve({ error: null });
          },
        };
      }
      return {};
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(name);
      if (name === 'accumula_rimborso') {
        const nuovo = (state.order.refunded_amount_cents ?? 0) + Number(args.p_delta ?? 0);
        if (nuovo > state.order.gross_total_cents) return Promise.resolve({ data: [], error: null });
        state.order.refunded_amount_cents = nuovo;
        return Promise.resolve({ data: [{ totale_rimborsato: nuovo }], error: null });
      }
      if (name === 'storna_rimborso') {
        state.order.refunded_amount_cents = Math.max(
          0, (state.order.refunded_amount_cents ?? 0) - Number(args.p_delta ?? 0),
        );
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';

beforeEach(() => {
  state.order = ordineGiaPagatoAlNegozio();
  state.updates = [];
  state.rpcCalls = [];
  state.notifiche = [];
  state.stornoRompe = false;
  refundsCreate.mockClear();
  createReversal.mockClear();
});

describe('quando il recupero dal negozio fallisce a rimborso gia uscito', () => {
  it('il rimborso arriva comunque in fondo, invece di morire a meta', async () => {
    state.stornoRompe = true;

    const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r1' });

    expect(
      esito.refundId,
      'il rimborso e uscito da Stripe ma la funzione e morta: il reso non si potra piu chiudere',
    ).toBe('re_x');
    expect(state.order.payment_status, 'per il database il cliente risulta ancora da rimborsare').toBe('REFUNDED');
  });

  it('la merce torna a scaffale lo stesso', async () => {
    state.stornoRompe = true;
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r2' });

    expect(
      state.rpcCalls.includes('restore_stock_for_order'),
      'ordine rimborsato per intero e giacenza mai ripristinata: quel pezzo resta invendibile',
    ).toBe(true);
  });

  it('i soldi rimasti al negozio diventano un lavoro da fare a mano, non una riga di log', async () => {
    state.stornoRompe = true;
    await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r3' });

    expect(state.order.payout_status, 'l ordine non dice che il recupero e da rifare').toBe('REVERSAL_FAILED');
    expect(
      state.notifiche.length,
      'nessuno ha avvisato gli amministratori: quei soldi non li ricerca piu nessuno',
    ).toBeGreaterThan(0);
  });

  it('quando lo storno riesce, non cambia niente rispetto a prima', async () => {
    const esito = await refundOrder({ orderId: 'o1', amountCents: 2000, idempotencyKey: 'return_r4' });

    expect(esito.reversedCents).toBe(1800);
    expect(state.order.payout_status).toBe('REVERSED');
    expect(state.notifiche.length, 'un rimborso andato bene non deve svegliare nessuno').toBe(0);
  });
});
