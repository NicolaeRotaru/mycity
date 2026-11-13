import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/libro-dei-rimborsi-r17';

/**
 * R17-018 — Reso con la carta ripreso dopo 24 ore, su un ordine con un rimborso fatto fuori da Stripe.
 *
 * Ordine con la carta da 40 €, bonifico al negozio già partito (36 €). Sull'ordine ci sono già 5 €
 * resi fuori da Stripe (a mano), e al negozio ne sono già stati tolti 4,50. Il negozio approva un reso
 * da 20 €: Stripe rimborsa, ma la risposta si perde, e la prenotazione torna indietro. Il negozio
 * riprova dopo 24 ore, quando Stripe non ricorda più la chiave. Prima: il controllo «il rimborso è già
 * contato?» faceva un conto sui totali (5 € registrati contro 20 € su Stripe meno questi 20), e i 5 €
 * resi a mano lo facevano sembrare contato: l'ordine restava a 5 € invece di 25 e al negozio non si
 * toglievano i suoi 18 €, partiva solo un avviso. Adesso lo dice il libro (migrazione 412): la
 * prenotazione di quella chiave non c'è più, quindi il rimborso non è contato e si conta adesso.
 */

const stato: { libro: Libro; stripe: StripeFinto } = { libro: creaLibro({}), stripe: creaStripe() };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));

import { refundOrder } from '@/lib/stripe/payout';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const reso = () =>
  refundOrder({ orderId: 'o1', amountCents: 2000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
const sommaStorni = () => stato.stripe.storni.reduce((s, x) => s + x.amount, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.libro = creaLibro({
    orders: [ordineConCarta({
      refunded_amount_cents: 500, seller_payout_reversed_cents: 450,
      payment_status: 'PARTIALLY_REFUNDED', stripe_refund_id: 'reso-a-mano',
    })],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-018 · il reso ripreso dopo 24 ore, con 5 € già resi fuori da Stripe', () => {
  it('la risposta di Stripe persa e la chiave scaduta: alla ripresa l ordine segna 25 €, al negozio si tolgono 18 €, e nessun rimborso nuovo', async () => {
    stato.stripe.rispostaPersa = true;
    await expect(reso()).rejects.toThrow();
    expect(ordine().refunded_amount_cents).toBe(500);
    expect(stato.stripe.creati).toEqual([2000]);

    vi.setSystemTime(new Date('2026-11-14T11:00:00.000Z'));
    stato.stripe.chiaviScadute = true;
    const esito = await reso();

    expect(esito.refundId).toBe('re_1');
    expect(stato.stripe.creati).toEqual([2000]);
    expect(ordine().refunded_amount_cents).toBe(2500);
    expect(sommaStorni()).toBe(1800);
    expect(String(ordine().stripe_refund_id)).toContain('re_1');
  });

  it('ripreso quando era già contato: niente di nuovo, né nel libro né al negozio', async () => {
    await reso();
    vi.setSystemTime(new Date('2026-11-14T11:00:00.000Z'));
    stato.stripe.chiaviScadute = true;
    const esito = await reso();
    expect(esito.refundId).toBe('re_1');
    expect(stato.stripe.creati).toEqual([2000]);
    expect(ordine().refunded_amount_cents).toBe(2500);
    expect(sommaStorni()).toBe(1800);
  });
});
