import { describe, it, expect, vi } from 'vitest';

/**
 * 6/9/2026 — CHI SA PERCHE' IL RIMBORSO E' FALLITO LO DICE.
 *
 * Il giro che annulla gli ordini mai accettati ritenta il rimborso al giro
 * dopo. Per sapere quando smettere non legge il testo del messaggio — una
 * frase si riscrive senza accorgersene — ma il marchio `ritentabile: false`
 * che `refundOrder` mette sugli errori senza ritorno.
 *
 * Questa prova tiene in piedi il patto fra i due file: se qualcuno torna a
 * lanciare un `Error` liscio quando non c'e' piu' niente da rimborsare, qui
 * diventa rossa e il rimbalzo infinito ricomincia di la'.
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

/** Ordine da 50 euro con carta, gia' rimborsato per intero da un reso chiuso prima. */
function ordineGiaRimborsato(): Order {
  return {
    id: 'o1',
    user_id: 'u1',
    total_price: 50,
    gross_total_cents: 5000,
    seller_payout_cents: 4500,
    seller_payout_reversed_cents: 4500,
    payout_status: 'TRANSFERRED',
    stripe_payment_intent: 'pi_1',
    stripe_transfer_id: 'tr_1',
    stripe_reversal_id: 'trr_1',
    refunded_amount_cents: 5000,
    payment_method: 'card',
    rider_payout_status: null,
    rider_transfer_id: null,
    delivery_status: 'CANCELED',
  };
}

const state: { order: Order | null } = { order: ordineGiaRimborsato() };

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
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve(
                  state.order
                    ? { data: state.order, error: null }
                    : { data: null, error: { message: 'no rows' } },
                ),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

const { refundOrder, RimborsoNonRitentabile } = await import('@/lib/stripe/payout');

describe('il rimborso impossibile si marchia da se', () => {
  it('su un ordine gia\' rimborsato per intero lancia un errore che dice «non ritentare»', async () => {
    state.order = ordineGiaRimborsato();

    await expect(
      refundOrder({ orderId: 'o1', amountCents: 5000, reason: 'ordine mai accettato' }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof RimborsoNonRitentabile &&
        (e as { ritentabile?: unknown }).ritentabile === false &&
        (e as Error).message === 'refundOrder: importo rimborso non valido',
    );
  });

  it('anche l\'ordine sparito e\' un errore senza ritorno', async () => {
    state.order = null;

    await expect(refundOrder({ orderId: 'o1', amountCents: 100 })).rejects.toSatisfy(
      (e: unknown) => (e as { ritentabile?: unknown }).ritentabile === false,
    );
  });
});
