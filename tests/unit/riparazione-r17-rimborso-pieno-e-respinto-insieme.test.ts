import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';

/**
 * R17-020 — La banca respinge un rimborso vecchio mentre ne parte uno che porta l'ordine al totale.
 *
 * Ordine da 40 € col bonifico al negozio trattenuto, già rimborsati 15 € (re_1 da 10 € e re_2 da 5 €),
 * quota tolta al negozio 12,15 €. Il negozio rimborsa gli ultimi 25 €: il rimborsato va a 40 €, «pieno».
 * Mentre Stripe esegue il rimborso arriva l'avviso «re_2 respinto dalla banca»: il rimborsato scende a
 * 35 €, «rimborsato in parte», bonifico in attesa. Prima `refundOrder` riscriveva subito dopo REFUNDED e
 * REFUNDED: 35 € su 40 con l'ordine «rimborsato del tutto» e il bonifico chiuso, e il negozio perdeva i
 * 4,05 € che gli restavano. Adesso gli stati si ricavano dal rimborsato di adesso.
 */

const stato: { libro: Libro; stripe: StripeFinto } = { libro: creaLibro({}), stripe: creaStripe() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { refundOrder, residuoRecuperabile, type ReversibleOrder } from '@/lib/stripe/payout';
import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const ultimi25 = () =>
  refundOrder({ orderId: 'o1', amountCents: 2500, reason: 'reso', metadata: { return_id: 'r3' }, idempotencyKey: 'return_r3' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.libro = creaLibro({
    orders: [
      ordineConCarta({
        payout_status: 'HELD', stripe_transfer_id: null, payment_status: 'PARTIALLY_REFUNDED',
        refunded_amount_cents: 1500, seller_payout_cents: 3240, seller_payout_reversed_cents: 1215,
        stripe_refund_id: 're_1,re_2',
      }),
    ],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-020 · il rimborso respinto mentre ne parte uno che porta l ordine al totale', () => {
  it('35 € su 40: l ordine resta «rimborsato in parte» e il bonifico al negozio in attesa col resto di 4,05 €', async () => {
    let sblocca!: () => void;
    stato.stripe.createLenta = new Promise<void>((r) => { sblocca = r; });
    const rimborso = ultimi25();
    await vi.waitFor(() => expect(ordine().refunded_amount_cents).toBe(4000));

    await handleRefundUpdated({ id: 're_2', object: 'refund', status: 'failed', amount: 500, payment_intent: 'pi_1', metadata: { order_id: 'o1' } } as never);
    expect(ordine().refunded_amount_cents).toBe(3500);
    sblocca();
    await rimborso;

    expect(stato.stripe.creati).toEqual([2500]);
    expect(ordine().refunded_amount_cents).toBe(3500);
    expect(ordine().payment_status).toBe('PARTIALLY_REFUNDED');
    expect(ordine().payout_status).toBe('HELD');
    expect(residuoRecuperabile(ordine() as unknown as ReversibleOrder)).toBe(405);
  });

  it('senza il respinto in mezzo, i 25 € chiudono l ordine come sempre: REFUNDED e bonifico chiuso', async () => {
    await ultimi25();
    expect(ordine().payment_status).toBe('REFUNDED');
    expect(ordine().payout_status).toBe('REFUNDED');
  });
});
