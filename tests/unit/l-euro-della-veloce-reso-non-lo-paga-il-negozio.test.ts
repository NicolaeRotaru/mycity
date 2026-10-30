import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scritturaSuUnaRiga } from './aiuti/scrittura-su-una-riga';
import { SUPPLEMENTO_CONSEGNA_CENTS } from '@/lib/constants';

/**
 * 30/10/2026 — L'EURO DELLA VELOCE RESO AL CLIENTE NON LO PAGA IL NEGOZIO.
 *
 * Il secondo freno della veloce (lib/ordini/veloce-non-confermata.ts) rende al cliente con la carta
 * l'euro della veloce con un rimborso parziale di 100 centesimi. Quell'euro sta dentro
 * `delivery_fee_cents` e resta a MyCity (lib/constants.ts): il negozio non l'ha mai incassato.
 *
 * `refundOrder` però divideva ogni rimborso parziale in proporzione alla quota del negozio:
 * round(100 × 1350 / 1900) = 71 centesimi tolti al forno, per un euro che era di MyCity.
 * Con `quotaNegozioCents: 0` chi chiede il rimborso dice di chi sono i soldi, e il negozio non perde niente.
 * La prova chiama il `refundOrder` vero: la prova del freno lo simula, e da lì il conto non si vedeva.
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
  wallet_applied_cents: number;
  payment_status: string;
  cash_confirmed_at: string | null;
};

const state: {
  order: Order;
  updates: Record<string, unknown>[];
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  ledger: Array<{ reason: string; ref: string; delta_cents: number }>;
} = { order: ordineBase(), updates: [], rpcCalls: [], ledger: [] };

/**
 * La veloce di Maria pagata con la carta: 19 € lordi, al forno 13,50 €, bonifico non ancora partito.
 * Dentro i 19 € ci sono 4 € di consegna: 3 € del giro e l'euro della veloce, che resta a MyCity.
 */
function ordineBase(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 19,
    gross_total_cents: 1900,
    seller_payout_cents: 1350,
    seller_payout_reversed_cents: 0,
    payout_status: 'PENDING',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    refunded_amount_cents: 0,
    payment_method: 'card',
    rider_payout_status: null,
    rider_transfer_id: null,
    delivery_status: 'NEW',
    wallet_applied_cents: 0,
    payment_status: 'PAID',
    cash_confirmed_at: null,
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
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.order, error: null }) }) }),
          update: (u: Record<string, unknown>) =>
            scritturaSuUnaRiga(() => state.order as unknown as Record<string, unknown>, () => {
              state.updates.push(u);
            }),
        };
      }
      if (table === 'wallet_ledger') {
        // Dopo l'accredito `refundOrder` rilegge la riga a diario della sua chiave (R82).
        const filtri: Record<string, unknown> = {};
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => ((filtri[c] = v), q),
          maybeSingle: () =>
            Promise.resolve({
              data: state.ledger.find((r) => r.reason === filtri.reason && r.ref === filtri.ref) ?? null,
              error: null,
            }),
        };
        return q;
      }
      // 17/10/2026 — sui contanti il bonifico da fare si annuncia agli amministratori dentro il
      // rimborso (refundOrder): il finto risponde con un amministratore e scrive l'avviso.
      if (table === 'profiles') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: 'admin-1' }], error: null }) }) };
      }
      if (table === 'notifications') {
        return { insert: () => Promise.resolve({ data: null, error: null }) };
      }
      return {};
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args });
      if (name === 'wallet_credit') {
        state.ledger.push({ reason: String(args.p_reason), ref: String(args.p_ref), delta_cents: Number(args.p_cents) });
      }
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
    // 17/10/2026 — l'email del cliente si legge prima dei soldi: dice all'avviso da chi prendere l'IBAN.
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'u1@esempio.it' } }, error: null }) } },
  }),
}));

const { refundOrder } = await import('@/lib/stripe/payout');

const addebitato = () =>
  state.updates.filter((u) => 'seller_payout_reversed_cents' in u).map((u) => u.seller_payout_reversed_cents).at(-1) ?? 0;

describe('l euro della veloce reso con la carta resta a carico di MyCity', () => {
  beforeEach(() => {
    state.order = ordineBase();
    state.updates = [];
    state.rpcCalls = [];
    state.ledger = [];
  });

  it('il rimborso di 1 € della veloce non toglie niente al negozio', async () => {
    await refundOrder({
      orderId: 'o1',
      amountCents: SUPPLEMENTO_CONSEGNA_CENTS,
      quotaNegozioCents: 0,
      idempotencyKey: 'veloce_non_confermata_o1',
      notifyBuyer: false,
    });
    // Oggi: 71 = round(100 × 1350 / 1900).
    expect(addebitato()).toBe(0);
    expect(state.order.seller_payout_reversed_cents).toBe(0);
  });

  it('un rimborso parziale qualsiasi resta in proporzione, come prima', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 100, idempotencyKey: 'reso_1', notifyBuyer: false });
    expect(addebitato()).toBe(71);
  });
});
