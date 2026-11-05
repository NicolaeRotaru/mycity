import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

/**
 * S01 — 143: con la posta spenta nessuno chiede l'IBAN al cliente. Se l'email
 * del rimborso non parte, chi amministra riceve un secondo avviso.
 */
const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, postaOk: true }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => ({}) }));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async () => (finto.postaOk ? { ok: true } : { ok: false, reason: 'posta spenta' })),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));

import { refundOrder } from '@/lib/stripe/payout';

function apri() {
  finto.db = creaFintoDatabase({
    orders: [{
      id: 'o1', user_id: 'cliente', seller_id: 'negozio', total_price: 24, gross_total_cents: 2400, wallet_applied_cents: 0,
      seller_payout_cents: 2160, seller_payout_reversed_cents: 0, payout_status: 'HELD', stripe_payment_intent: null,
      stripe_transfer_id: null, stripe_reversal_id: null, refunded_amount_cents: 0, payment_method: 'cod',
      rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: 0,
      shipping_cost: 0, delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-11-01T10:00:00Z',
    }],
    profiles: [{ id: 'nicola', role: 'admin' }],
    notifications: [],
  });
}
beforeEach(() => {
  finto.postaOk = true;
  apri();
});

describe('143 — l email per l IBAN che non parte non resta un segreto', () => {
  it('posta spenta: secondo avviso agli amministratori', async () => {
    finto.postaOk = false;
    await refundOrder({ orderId: 'o1', amountCents: 2400, idempotencyKey: 'return_r1', notifyBuyer: true });
    expect(notificheConTitolo(finto.db, 'IBAN non partita')).toHaveLength(1);
  });
  it('controprova: posta che parte, nessun secondo avviso', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 2400, idempotencyKey: 'return_r2', notifyBuyer: true });
    expect(notificheConTitolo(finto.db, 'IBAN non partita')).toHaveLength(0);
  });
});
