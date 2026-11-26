import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R19-004 — Un rimborso arrivato dopo il bonifico del lunedì lascia al negozio un debito da riprendere.
 *
 * Ordine in contanti di Pane Quotidiano da 23 € (al negozio 18 €), consegnato mercoledì 18/11.
 * Lunedì 23/11 Nicola fa il bonifico del lunedì e lo segna con «Bonifico fatto»: l'ordine è
 * PAID_MANUALLY. Mercoledì 25/11 il reclamo si chiude con un rimborso. Prima l'avviso «togli la quota
 * dal prossimo bonifico» partiva solo sugli ordini HELD: dopo il bonifico del lunedì non partiva niente
 * e il negozio teneva 18 € che non gli spettavano. Adesso il debito si dice una volta per rimborso,
 * anche se il rimborso si ripete, e senza «se»: quel bonifico è uscito di sicuro.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));
const stripe = vi.hoisted(() => ({ storni: [] as Array<{ transfer: string; amount: number }> }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: {
      createReversal: vi.fn(async (transfer: string, p: { amount: number }) => {
        stripe.storni.push({ transfer, amount: p.amount });
        return { id: `trr_${stripe.storni.length}` };
      }),
    },
  }),
}));
const posta = vi.hoisted(() => ({ a: [] as Array<{ to: string; subject: string }> }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: { to: string; subject: string }) => { posta.a.push(m); return { ok: true }; }) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));

import { refundOrder, VAR_CONTANTI_DA_STRIPE } from '@/lib/stripe/payout';

const ORDINE = 'c3d4e5f6-1904-4904-8904-190419041904';

function pagatoIlLunedi(extra: Riga = {}): Riga {
  return {
    id: ORDINE, user_id: 'anna', seller_id: 'pane',
    total_price: 23, gross_total_cents: 2300, wallet_applied_cents: 0,
    seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
    // Il bonifico del lunedì, segnato fatto da «Bonifico fatto».
    payout_status: 'PAID_MANUALLY', payout_at: '2026-11-23T09:00:00.000Z',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 3,
    delivery_status: 'DELIVERED', delivered_at: '2026-11-18T11:00:00.000Z',
    created_at: '2026-11-18T09:30:00.000Z',
    payment_status: 'PAID', cash_confirmed_at: '2026-11-18T19:00:00.000Z',
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

/** I debiti del negozio detti a chi fa i bonifici: gli avvisi «togli … dal prossimo bonifico». */
const debiti = () =>
  (finto.db.tabelle.notifications ?? []).filter((n) => String(n.title ?? '').includes('dal prossimo bonifico'));

const reclamo = (amountCents = 2300) =>
  refundOrder({ orderId: ORDINE, amountCents, reason: 'reclamo', idempotencyKey: 'dispute_d1', notifyBuyer: true });

beforeEach(() => {
  // Mercoledì 25/11, due giorni dopo il bonifico del lunedì.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-25T10:00:00.000Z') });
  posta.a = [];
  stripe.storni = [];
  delete process.env[VAR_CONTANTI_DA_STRIPE];
  preparaDatabase(pagatoIlLunedi());
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env[VAR_CONTANTI_DA_STRIPE];
});

describe('R19-004 — il rimborso arrivato dopo il bonifico del lunedì si riprende al negozio', () => {
  it('IL CASO DELLA SCHEDA — rimborso pieno dopo il bonifico del lunedì: 18,00 € da togliere al prossimo bonifico a Pane Quotidiano', async () => {
    const esito = await reclamo();
    expect(esito.bonificoCents).toBe(2300);
    const d = debiti();
    expect(d, 'nessun debito del negozio: tiene 18 € già versati il lunedì').toHaveLength(1);
    expect(d[0].user_id).toBe('admin-1');
    expect(String(d[0].title)).toMatch(/^💶 Togli 18,00\s€ dal prossimo bonifico a Pane Quotidiano$/);
    expect(String(d[0].body)).toContain(ORDINE.slice(0, 8));
    // Il bonifico del lunedì è uscito di sicuro: niente «se non è ancora partito».
    expect(String(d[0].body)).toContain('dopo il bonifico del lunedì');
    expect(String(d[0].body)).not.toContain('non è ancora partito');
  });

  it('il rimborso che si ripete non raddoppia il debito: una volta sola', async () => {
    await reclamo();
    await reclamo().catch(() => {});
    await reclamo().catch(() => {});
    expect(debiti()).toHaveLength(1);
  });

  it('rimborso parziale dopo il bonifico del lunedì: si riprende la parte del negozio (9,00 € su 11,50 €), una volta', async () => {
    await reclamo(1150);
    await reclamo(1150).catch(() => {});
    const d = debiti();
    expect(d).toHaveLength(1);
    expect(String(d[0].title)).toMatch(/^💶 Togli 9,00\s€ dal prossimo bonifico a Pane Quotidiano$/);
  });

  it('il bonifico del lunedì l ha fatto Nicola: il debito si dice anche se quelle consegne le pagherebbe Stripe', async () => {
    process.env[VAR_CONTANTI_DA_STRIPE] = '2026-11-01';
    await reclamo();
    expect(debiti(), 'il bonifico a mano non lo scala nessun giro automatico').toHaveLength(1);
  });

  it('non si rompe — bonifico partito da Stripe (TRANSFERRED): la quota rientra con lo storno, nessun debito da riprendere a mano', async () => {
    process.env[VAR_CONTANTI_DA_STRIPE] = '2026-11-01';
    preparaDatabase(pagatoIlLunedi({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_lunedi', payout_at: '2026-11-19T09:00:00.000Z' }));
    const esito = await reclamo();
    expect(stripe.storni).toEqual([{ transfer: 'tr_lunedi', amount: 1800 }]);
    expect(esito.reversedCents).toBe(1800);
    expect(debiti()).toHaveLength(0);
  });

  it('non si rompe — contanti ancora dal fattorino: nessun bonifico partito, nessun debito', async () => {
    preparaDatabase(pagatoIlLunedi({ payout_status: 'AWAITING_REMITTANCE', payout_at: null }));
    await reclamo();
    expect(debiti()).toHaveLength(0);
  });
});
