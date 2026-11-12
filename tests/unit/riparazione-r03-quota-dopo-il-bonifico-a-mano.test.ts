import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R03-007 — Un rimborso arrivato dopo il bonifico del lunedì: a Nicola arriva l'avviso di
 * togliere la quota al negozio.
 *
 * Ordine in contanti di Pane Quotidiano da 23 € (netto al negozio 18 €), rimessa confermata
 * (HELD): al lancio vuol dire che Nicola ha già i contanti e il lunedì paga il negozio a mano.
 * Il reclamo si chiude con un rimborso pieno. Prima la quota finiva solo in
 * `seller_payout_reversed_cents` dello stesso ordine, che nessun bonifico a mano legge, e
 * nessun avviso diceva di trattenerla: il negozio teneva 18 € che non gli spettavano.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));

import { refundOrder } from '@/lib/stripe/payout';

const ORDINE = 'b2c3d4e5-7777-4777-8777-777777777777';

function pagatoAMano(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'anna', seller_id: 'pane',
    total_price: 23, gross_total_cents: 2300, wallet_applied_cents: 0,
    seller_payout_cents: 1800, seller_payout_reversed_cents: 0, payout_status: 'HELD',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 3,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    internal_dispute_status: null,
    ...extra,
  };
}

function preparaDatabase(ordine: Riga) {
  finto.db = creaFintoDatabase({
    orders: [ordine],
    profiles: [
      { id: 'admin-1', role: 'admin' },
      { id: 'pane', role: 'seller', store_name: 'Pane Quotidiano' },
      { id: 'anna', role: 'buyer' },
    ],
    notifications: [],
  });
  finto.db.email.anna = 'anna@example.it';
}

const daTrattenere = () =>
  (finto.db.tabelle.notifications ?? []).filter((n) => String(n.title ?? '').includes('Togli'));

const reclamo = () =>
  refundOrder({ orderId: ORDINE, amountCents: 2300, reason: 'reclamo', idempotencyKey: 'dispute_d1', notifyBuyer: true });

beforeEach(() => preparaDatabase(pagatoAMano()));

describe('R03-007 — la quota del negozio già pagato a mano non si perde', () => {
  it('rimborso pieno su un ordine HELD: Nicola riceve «togli 18,00 € dal prossimo bonifico a Pane Quotidiano»', async () => {
    await reclamo();
    const avvisi = daTrattenere();
    expect(avvisi, 'nessun avviso dice di trattenere la quota al negozio').toHaveLength(1);
    expect(avvisi[0].user_id).toBe('admin-1');
    expect(String(avvisi[0].title)).toContain('18,00');
    expect(String(avvisi[0].title)).toContain('Pane Quotidiano');
    expect(String(avvisi[0].body)).toContain(ORDINE.slice(0, 8));
  });

  it('ripreso con la stessa chiave non manda un secondo avviso', async () => {
    await reclamo();
    await reclamo().catch(() => {});
    expect(daTrattenere()).toHaveLength(1);
  });

  it('un ordine ancora dal fattorino (rimessa non confermata) non manda l avviso: la quota resta sull ordine', async () => {
    preparaDatabase(pagatoAMano({ payout_status: 'AWAITING_REMITTANCE' }));
    await reclamo();
    expect(daTrattenere()).toHaveLength(0);
  });
});
