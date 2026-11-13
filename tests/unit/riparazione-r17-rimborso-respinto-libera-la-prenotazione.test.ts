import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/libro-dei-rimborsi-finto';

/**
 * R17-014 — Il rimborso respinto dalla banca libera la sua prenotazione nel libro.
 *
 * Dalla 412 la prenotazione porta la chiave che va a Stripe, e la stessa chiave non si somma due
 * volte. Ordine con la carta da 40 €: il reso da 20 € esce, poi la banca del cliente lo respinge e
 * l'avviso di Stripe toglie i 20 € dall'ordine. Il negozio rimborsa di nuovo lo stesso reso, il giorno
 * dopo: il rimborso nuovo deve contarsi. Se la prenotazione della chiave restava nel libro, la ripresa
 * la trovava («ripresa», niente da sommare) e il libro diceva 0 € su 20 usciti: il tetto del lordo
 * avrebbe lasciato rimborsare oltre il pagato.
 */

const stato: { libro: Libro; stripe: StripeFinto } = { libro: creaLibro({}), stripe: creaStripe() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { refundOrder } from '@/lib/stripe/payout';
import { handleRefundUpdated } from '@/lib/stripe/webhook/rimborsi';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const reso = () =>
  refundOrder({ orderId: 'o1', amountCents: 2000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.libro = creaLibro({
    orders: [ordineConCarta()],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-014 · il rimborso respinto dalla banca e il libro dei rimborsi', () => {
  it('respinto il reso da 20 €, il rimborso rifatto il giorno dopo si conta: 20 € nel libro, 20 € usciti', async () => {
    await reso();
    expect(ordine().refunded_amount_cents).toBe(2000);

    vi.setSystemTime(new Date('2026-11-13T18:00:00.000Z'));
    const respinto = stato.stripe.suStripe.find((r) => r.id === 're_1')!;
    respinto.status = 'failed';
    await handleRefundUpdated({ id: 're_1', object: 'refund', status: 'failed', amount: 2000, payment_intent: 'pi_1', metadata: { ...respinto.metadata } } as never);
    expect(ordine().refunded_amount_cents).toBe(0);

    vi.setSystemTime(new Date('2026-11-14T11:00:00.000Z'));
    stato.stripe.chiaviScadute = true;
    const esito = await reso();

    expect(esito.refundId).toBe('re_2');
    expect(stato.stripe.creati).toEqual([2000, 2000]);
    expect(ordine().refunded_amount_cents).toBe(2000);
  });
});
