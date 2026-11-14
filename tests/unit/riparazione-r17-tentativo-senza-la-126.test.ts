import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 14/11/2026 (R17-017 correzione) — SENZA LA 126 IL TENTATIVO DEL BONIFICO NON SI PERDE.
 *
 * Il controllo C02 sul ramo unito: per leggere l'ora del turno di prima
 * (`payout_claimed_at`, `rider_payout_claimed_at`, migrazione 126) il ripiego
 * toglieva dalla lettura, in un colpo solo, anche le colonne della 124 —
 * `payout_tentativo` compreso. Su un database con la 124 ma senza la 126 il
 * tentativo letto diventava 0, e il controllo dell'elenco dei bonifici
 * (`bonificoGiaFatto`) scambiava il vecchio bonifico, già stornato dopo una
 * contestazione (tentativo 0), per quello di adesso (tentativo 1): lo
 * registrava, e il negozio che aveva vinto la contestazione non veniva pagato.
 * Adesso il ripiego ha due gradini: prima si toglie solo la 126.
 */

type Bonifico = { id: string; amount: number; metadata: Record<string, string>; chiave: string };

const stato: { db: FintoDatabase; suStripe: Bonifico[] } = { db: fintoDatabase({}), suStripe: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    transfers: {
      create: async (p: { amount: number; metadata: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.suStripe.find((b) => b.chiave === o.idempotencyKey);
        if (gia) return { id: gia.id };
        const nuovo = { id: `tr_${stato.suStripe.length + 1}`, amount: p.amount, metadata: { ...p.metadata }, chiave: o.idempotencyKey };
        stato.suStripe.push(nuovo);
        return { id: nuovo.id };
      },
      list: async () => ({ data: stato.suStripe.map((b) => ({ id: b.id, amount: b.amount, metadata: { ...b.metadata } })) }),
    },
  }),
}));

import { releaseOrderPayout, releaseRiderPayout } from '@/lib/stripe/payout';

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;

/** Contestazione vinta: il bonifico vecchio (tentativo 0) è stato stornato, il tentativo è salito a 1. */
function ordineDopoLaContestazioneVinta(extra: Riga = {}): Riga {
  return {
    id: 'o1', seller_id: 'negozio1', rider_id: 'fattorino1',
    payout_status: 'HELD', seller_payout_cents: 2250, seller_payout_reversed_cents: 0, payout_tentativo: 1,
    stripe_charge_id: 'ch_1', stripe_transfer_group: 'order_o1', stripe_transfer_id: null,
    delivery_status: 'DELIVERED', payment_method: 'card', delivered_at: '2026-11-16T08:00:00.000Z',
    rider_payout_status: 'HELD', rider_fee_cents: 390, shipping_cost: 3.9, rider_payout_tentativo: 1,
    total_price: 30, pickup_in_store: false, cash_confirmed_at: null,
    ...extra,
  };
}

beforeEach(() => {
  stato.suStripe = [
    // I bonifici di prima della contestazione, già stornati: su Stripe restano nell'elenco per sempre.
    { id: 'tr_vecchio_negozio', amount: 2250, metadata: { order_id: 'o1', seller_id: 'negozio1', tentativo: '0' }, chiave: 'payout_seller_o1_t0_c2250' },
    { id: 'tr_vecchio_fattorino', amount: 390, metadata: { order_id: 'o1', rider_id: 'fattorino1', kind: 'rider_fee', tentativo: '0' }, chiave: 'payout_rider_o1_t0_c390' },
  ];
  stato.db = fintoDatabase({
    orders: [ordineDopoLaContestazioneVinta()],
    profiles: [
      { id: 'negozio1', stripe_account_id: 'acct_negozio', stripe_payouts_enabled: true },
      { id: 'fattorino1', stripe_account_id: 'acct_fattorino', stripe_payouts_enabled: true },
    ],
  });
  // Un database con la 124 ma senza la 126: le ore dei turni non ci sono.
  stato.db.colonneMancanti = { orders: ['payout_claimed_at', 'rider_payout_claimed_at'] };
});

describe('R17-017 — con la 124 e senza la 126 il tentativo letto resta quello vero', () => {
  it('al negozio: dopo la contestazione vinta parte un bonifico NUOVO (tentativo 1), il vecchio stornato non si registra', async () => {
    const esito = await releaseOrderPayout('o1');

    expect(esito).toEqual({ ok: true, transferId: 'tr_3' });
    const nuovo = stato.suStripe.find((b) => b.id === 'tr_3');
    expect(nuovo).toMatchObject({ amount: 2250, metadata: { tentativo: '1' } });
    expect(ordine().stripe_transfer_id).toBe('tr_3');
    expect(ordine().payout_status).toBe('TRANSFERRED');
  });

  it('al fattorino: lo stesso, il compenso nuovo parte col tentativo 1', async () => {
    const esito = await releaseRiderPayout('o1');

    expect(esito).toEqual({ ok: true, transferId: 'tr_3' });
    const nuovo = stato.suStripe.find((b) => b.id === 'tr_3');
    expect(nuovo).toMatchObject({ amount: 390, metadata: { kind: 'rider_fee', tentativo: '1' } });
    expect(ordine().rider_transfer_id).toBe('tr_3');
    expect(ordine().rider_payout_status).toBe('TRANSFERRED');
  });

  it('senza la 124 né la 126 il bonifico parte lo stesso (secondo gradino del ripiego)', async () => {
    stato.db.colonneMancanti = { orders: ['payout_claimed_at', 'rider_payout_claimed_at', 'payout_tentativo', 'rider_payout_tentativo', 'gross_total_cents'] };
    stato.suStripe = [];

    const esito = await releaseOrderPayout('o1');

    expect(esito).toEqual({ ok: true, transferId: 'tr_1' });
    expect(stato.suStripe[0]).toMatchObject({ amount: 2250, metadata: { tentativo: '0' } });
  });
});
