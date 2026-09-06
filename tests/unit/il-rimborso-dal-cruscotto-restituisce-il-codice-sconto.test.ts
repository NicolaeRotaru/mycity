import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 6/9/2026 — IL RIMBORSO FATTO A MANO SU STRIPE BRUCIAVA IL CODICE SCONTO.
 *
 * Il codice si consuma prima di creare l'ordine (`claim_coupon`) e si
 * restituisce quando l'ordine se ne va (`release_coupon`). La restituzione la
 * chiamavano l'annullo del cliente, il rifiuto del negozio e il carrello
 * scaduto — ma non il rimborso che arriva da Stripe. Chi veniva rimborsato a
 * mano dall'amministrazione perdeva il buono di benvenuto senza aver comprato
 * niente, e lo scopriva premendo «Applica» mentre riprovava a ordinare.
 *
 * LA PARTE DELICATA È LA SECONDA. Quando il rimborso parte da noi
 * (`annullaERimborsa`), il codice è GIÀ stato restituito, e poi Stripe manda
 * comunque `charge.refunded`: restituirlo di nuovo toglierebbe un uso vero a
 * un buono con tetto 2 — quattro sconti su un tetto di due. Il segnale che
 * distingue le due strade è lo stesso già usato qui per la merce:
 * `payment_status` è 'REFUNDED' solo se il rimborso l'abbiamo fatto noi.
 */

type Ordine = {
  id: string;
  user_id: string;
  total_price: number;
  payout_status: string;
  payment_status: string;
  delivery_status: string;
  coupon_code?: string | null;
  rider_payout_status?: string | null;
};

const state: {
  ordini: Ordine[];
  rpc: Array<{ nome: string; argomenti: Record<string, unknown> }>;
} = { ordini: [], rpc: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({ refunds: { list: async () => ({ data: [] }) } }) }));
vi.mock('@/lib/stripe/payout', () => ({
  reverseOrderTransfer: async () => ({ reversalId: null }),
  reverseRiderTransfer: async () => ({ reversalId: null, reversedCents: 0 }),
}));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: async () => {} }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: () => ({ eq: () => Promise.resolve({ data: state.ordini.map((o) => ({ ...o })), error: null }) }),
          update: (valori: Record<string, unknown>) => ({
            eq: (_c: string, id: string) => {
              const riga = state.ordini.find((o) => o.id === id);
              if (riga) Object.assign(riga, valori);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      return {};
    },
    rpc: (nome: string, argomenti: Record<string, unknown>) => {
      state.rpc.push({ nome, argomenti });
      return Promise.resolve({ data: null, error: null });
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'b@x.com' } } }) } },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';

function chargeRimborsata() {
  return {
    id: 'ch_1',
    payment_intent: 'pi_1',
    refunded: true,
    amount: 3000,
    amount_refunded: 3000,
    refunds: { data: [{ id: 're_1', reason: 'requested_by_customer' }] },
  } as unknown as Parameters<typeof handleChargeRefunded>[0];
}

const ordine = (id: string, extra: Partial<Ordine> = {}): Ordine => ({
  id,
  user_id: 'u1',
  total_price: 15,
  payout_status: 'HELD',
  payment_status: 'PAID',
  delivery_status: 'NEW',
  coupon_code: 'BENVENUTO10',
  rider_payout_status: null,
  ...extra,
});

const restituzioni = () => state.rpc.filter((r) => r.nome === 'release_coupon');

beforeEach(() => {
  state.ordini = [];
  state.rpc = [];
});

describe('quando un rimborso pieno arriva dal cruscotto Stripe', () => {
  it('il codice sconto torna al cliente', async () => {
    state.ordini = [ordine('o1')];

    await handleChargeRefunded(chargeRimborsata());

    expect(
      restituzioni().length,
      'il cliente rimborsato a mano ha perso il buono senza aver comprato niente',
    ).toBe(1);
    expect(restituzioni()[0].argomenti.p_code).toBe('BENVENUTO10');
    // La chiave per ordine è quella che rende innocua una seconda chiamata.
    expect(restituzioni()[0].argomenti.p_order_id).toBe('o1');
  });

  it('un carrello da due negozi restituisce il codice una volta sola', async () => {
    // Stesso codice su due ordini dello stesso carrello: due restituzioni
    // toglierebbero due usi a un buono che ne aveva consumato uno.
    state.ordini = [ordine('o1'), ordine('o2')];

    await handleChargeRefunded(chargeRimborsata());

    expect(restituzioni().length, 'il codice è stato restituito due volte per lo stesso carrello').toBe(1);
  });

  it('un ordine senza codice non chiama nessuno', async () => {
    state.ordini = [ordine('o1', { coupon_code: null })];
    await handleChargeRefunded(chargeRimborsata());
    expect(restituzioni().length).toBe(0);
  });
});

describe('quando il rimborso l abbiamo già fatto noi', () => {
  it('il codice non viene restituito una seconda volta', async () => {
    // `payment_status` è già 'REFUNDED': ci è passato `annullaERimborsa`, che
    // il codice l'ha già restituito. Questo è solo l'eco di Stripe.
    state.ordini = [ordine('o1', { payment_status: 'REFUNDED' })];

    await handleChargeRefunded(chargeRimborsata());

    expect(
      restituzioni().length,
      'due restituzioni per lo stesso ordine: un buono con tetto 2 ne accetta altri due',
    ).toBe(0);
  });
});
