import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';

/**
 * R17-013 — Dopo l'euro della veloce reso senza toccare il negozio, il rimborso pieno successivo.
 *
 * Maria paga con la carta 19 € (al forno 13,50 €), il bonifico al forno è già partito. Il freno della
 * veloce le rende 1 € senza toccare il forno: l'euro è di MyCity (quota 0). Poi un reso pieno dei 18 €
 * che restano. Prima al forno si toglievano 18 × 13,50 / 19 = 12,79 €: su un ordine rimborsato tutto
 * gli restavano 71 centesimi. Adesso il rimborso che chiude l'ordine prende quello che al forno resta.
 */

const stato: { libro: Libro; stripe: StripeFinto } = { libro: creaLibro({}), stripe: creaStripe() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { refundOrder } from '@/lib/stripe/payout';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const sommaStorni = () => stato.stripe.storni.reduce((s, x) => s + x.amount, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.libro = creaLibro({
    orders: [ordineConCarta({ total_price: 19, gross_total_cents: 1900, seller_payout_cents: 1350 })],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-013 · il rimborso pieno dopo l euro della veloce', () => {
  it('al forno si tolgono tutti i suoi 13,50 €, non 12,79: sull ordine rimborsato tutto non gli resta niente', async () => {
    await refundOrder({
      orderId: 'o1', amountCents: 100, quotaNegozioCents: 0,
      reason: 'consegna veloce non confermata dal negozio in 10 minuti', idempotencyKey: 'veloce_non_confermata_o1',
    });
    expect(sommaStorni()).toBe(0);

    const esito = await refundOrder({ orderId: 'o1', amountCents: 1800, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });

    expect(esito.pieno).toBe(true);
    expect(ordine().refunded_amount_cents).toBe(1900);
    expect(sommaStorni()).toBe(1350);
    expect(ordine().seller_payout_reversed_cents).toBe(1350);
    expect(ordine().payout_status).toBe('REVERSED');
  });

  it('senza l euro di prima il reso pieno toglie la quota intera, come sempre', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 1900, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
    expect(sommaStorni()).toBe(1350);
  });

  it('un rimborso parziale resta in proporzione al lordo: 9,50 € tolgono 6,75 € al forno', async () => {
    await refundOrder({ orderId: 'o1', amountCents: 950, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
    expect(sommaStorni()).toBe(675);
  });
});
