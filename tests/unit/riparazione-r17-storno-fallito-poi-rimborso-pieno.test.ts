import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';
import { formatPriceFromCents } from '@/lib/format';

/**
 * R17-024 — Uno storno al negozio già fallito, poi l'ordine rimborsato tutto.
 *
 * Ordine da 27,90 € pagato al negozio con 18,00 €; un reso da 3 €; lo storno di 1,94 € fallisce per un
 * timeout di Stripe: l'ordine è REVERSAL_FAILED, il segno «da recuperare a mano». Poi il resto si
 * rimborsa: dal cruscotto (handleChargeRefunded) o dal sito (refundOrder). Prima tutti e due scrivevano
 * REFUNDED sopra il segno, senza un avviso, e `refundOrder` toglieva la quota «dal bonifico da fare» che
 * era già partito: il negozio teneva i soldi e nessuno li riprendeva. Adesso il segno resta e agli
 * amministratori si dice la cifra intera ancora da riprendere: il netto meno quanto è già rientrato.
 */

const stato: { libro: Libro; stripe: StripeFinto } = { libro: creaLibro({}), stripe: creaStripe() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { refundOrder } from '@/lib/stripe/payout';
import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const avvisiAManoCon = (cifra: number) =>
  (stato.libro.db.tabelle.notifications ?? []).filter(
    (n) => String(n.title).includes('da recuperare a mano') && String(n.body).includes(formatPriceFromCents(cifra)),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.libro = creaLibro({
    orders: [
      ordineConCarta({
        total_price: 27.9, gross_total_cents: 2790, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
        refunded_amount_cents: 300, payment_status: 'PARTIALLY_REFUNDED', stripe_refund_id: 're_reso',
        payout_status: 'REVERSAL_FAILED', reversal_error: 'timeout', stripe_transfer_id: 'tr_1', coupon_code: null,
      }),
    ],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-024 · il segno «da recuperare a mano» non sparisce col rimborso pieno', () => {
  it('rimborso pieno dal cruscotto: lo stato resta REVERSAL_FAILED e l avviso dice 18,00 € da riprendere', async () => {
    await handleChargeRefunded({
      id: 'ch_1', object: 'charge', payment_intent: 'pi_1', refunded: true, amount: 2790, amount_refunded: 2790,
      refunds: { object: 'list', data: [{ id: 're_cruscotto', reason: null }], has_more: false },
    } as never);

    expect(ordine().payment_status).toBe('REFUNDED');
    expect(ordine().payout_status).toBe('REVERSAL_FAILED');
    expect(avvisiAManoCon(1800)).toHaveLength(1);
  });

  it('rimborso pieno dal sito: lo stato resta, la quota non si toglie da un bonifico già partito, l avviso dice 18,00 €', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 2490, reason: 'reso', metadata: { return_id: 'r2' }, idempotencyKey: 'return_r2' });

    expect(ordine().payment_status).toBe('REFUNDED');
    expect(ordine().payout_status).toBe('REVERSAL_FAILED');
    expect(ordine().seller_payout_reversed_cents).toBe(0);
    expect(avvisiAManoCon(1800)).toHaveLength(1);
  });

  it('rimborso parziale dal sito: niente quota sulla carta, l avviso dice i 3,23 € che si aggiungono', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 500, reason: 'reso', metadata: { return_id: 'r2' }, idempotencyKey: 'return_r2' });

    expect(ordine().payout_status).toBe('REVERSAL_FAILED');
    expect(ordine().seller_payout_reversed_cents).toBe(0);
    expect(avvisiAManoCon(323)).toHaveLength(1);
  });
});
