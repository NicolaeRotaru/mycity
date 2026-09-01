import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 27/8/2026 (R040) — IL TURNO DEL FATTORINO NON PORTAVA L'ORA, E NESSUNO
 * POTEVA PIÙ RIPRENDERLO.
 *
 * Prima di chiamare Stripe, il codice «prende il turno» sull'ordine: scrive
 * PROCESSING, così due giri in parallelo non pagano due volte. Se il processo
 * muore in mezzo — il giro ha un tetto di durata, e Stripe a volte fa aspettare
 * — quello stato resta scritto. Gli stati da cui un compenso si può ritentare
 * sono HELD, PENDING_RIDER_ONBOARDING e FAILED: PROCESSING non c'è. Quel
 * compenso non ripartiva mai più.
 *
 * Per il negozio il recupero esisteva già, e funziona perché il turno porta
 * l'ora in cui è stato preso (`payout_claimed_at`): il giro dopo vede che è
 * vecchio e lo rimette in coda. Per il fattorino la colonna c'era — la
 * migrazione 126 l'ha aggiunta — ma nessuno ci scriveva dentro.
 *
 * Il fattorino ha consegnato e non veniva pagato, e l'unico rimedio era una
 * modifica a mano sul database. Su chi è pagato a consegna, questo è abbandono
 * alla seconda volta.
 *
 * Questa prova guarda che il turno porti la sua ora. Il pezzo che li rimette in
 * coda sta nel giro, e ha la sua prova in
 * `il-giro-dei-bonifici-non-lascia-indietro-nessuno.test.ts`.
 */

type Riga = Record<string, unknown>;

const state: { ordine: Riga; profilo: Riga; scritture: Riga[] } = { ordine: {}, profilo: {}, scritture: [] };
const transfersCreate = vi.fn(async () => ({ id: 'tr_1' }));

vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({ transfers: { create: transfersCreate } }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/email/templates', () => ({ refundIssuedTemplate: () => ({ subject: 's', html: 'h', text: 't' }) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { ...state.ordine }, error: null }) }) }),
          update: (valori: Riga) => {
            state.scritture.push(valori);
            const b: Record<string, unknown> = {
              eq: () => b,
              in: () => b,
              or: () => b,
              select: () => b,
              then: (risolvi: (x: unknown) => unknown) => {
                Object.assign(state.ordine, valori);
                return risolvi({ data: [{ id: state.ordine.id }], error: null });
              },
            };
            return b;
          },
        };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: state.profilo, error: null }) }) }) };
      }
      return {};
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

import { releaseRiderPayout, releaseOrderPayout } from '@/lib/stripe/payout';

beforeEach(() => {
  transfersCreate.mockClear();
  state.scritture = [];
  state.profilo = { stripe_account_id: 'acct_r1', stripe_payouts_enabled: true };
});

describe('quando si prende il turno per pagare il fattorino', () => {
  it('l ora del turno viene scritta, altrimenti un compenso appeso non si recupera piu', async () => {
    state.ordine = {
      id: 'o1',
      rider_id: 'r1',
      payment_method: 'card',
      delivery_status: 'DELIVERED',
      rider_payout_status: 'HELD',
      rider_fee_cents: 400,
      rider_payout_tentativo: 0,
      stripe_charge_id: 'ch_1',
      stripe_transfer_group: 'order_o1',
    };

    await releaseRiderPayout('o1');

    const turno = state.scritture.find((s) => s.rider_payout_status === 'PROCESSING');
    expect(turno, 'il turno non e stato preso').toBeDefined();
    expect(
      turno?.rider_payout_claimed_at,
      'il turno non porta l ora: se il processo muore adesso, il fattorino non viene pagato mai piu',
    ).toBeTypeOf('string');
    // L'ora dev'essere quella di adesso, non un valore qualsiasi.
    const scarto = Math.abs(Date.now() - new Date(String(turno?.rider_payout_claimed_at)).getTime());
    expect(scarto, 'l ora del turno non e quella di adesso').toBeLessThan(10_000);
  });

  it('il turno del negozio continua a portare la sua, come prima', async () => {
    state.ordine = {
      id: 'o2',
      seller_id: 's1',
      payout_status: 'HELD',
      delivery_status: 'DELIVERED',
      seller_payout_cents: 5000,
      seller_payout_reversed_cents: 0,
      payout_tentativo: 0,
      stripe_charge_id: 'ch_2',
      stripe_transfer_group: 'order_o2',
    };

    await releaseOrderPayout('o2');

    const turno = state.scritture.find((s) => s.payout_status === 'PROCESSING');
    expect(turno?.payout_claimed_at).toBeTypeOf('string');
  });
});
