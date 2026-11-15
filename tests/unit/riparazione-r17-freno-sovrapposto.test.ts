import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { creaLibro, creaStripe, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';

/**
 * R17-011 — Due giri del freno sovrapposti sullo stesso ordine con la carta.
 *
 * Il freno della veloce parte ogni 5 minuti e un giro può durare fino a 5 minuti: uno lento si
 * accavalla col successivo. Maria ordina con la veloce alle 18:05 (19 €, consegna 4 €), il forno
 * non conferma. Il giro delle 18:16 chiede a Stripe di renderle l'euro e la risposta tarda; il giro
 * delle 18:21 trova l'ordine ancora «Adesso». Prima: tutti e due prenotavano l'euro, Stripe con la
 * stessa chiave lo rendeva una volta, e il libro dell'ordine diceva 2 €: all'annullo a Maria
 * tornava 1 € in meno. E il secondo giro, col rimborso «non partito», spostava lui il carrello e
 * scriveva a Maria e agli amministratori che l'euro andava reso a mano, mentre era già sulla carta.
 * Adesso il secondo giro trova la prenotazione del primo e non tocca niente.
 */

const stato: { libro: Libro; stripe: StripeFinto; avvisi: string[] } = { libro: creaLibro({}), stripe: creaStripe(), avvisi: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => stato.stripe.client() }));
vi.mock('@/lib/stripe/webhook/comune', async (originale) => ({
  ...(await originale<Record<string, unknown>>()),
  notifyAdmins: vi.fn(async (titolo: string, testo: string) => {
    stato.avvisi.push(`${titolo} — ${testo}`);
    return 'mandato';
  }),
}));

import { frenoDellaVeloce } from '@/lib/ordini/veloce-non-confermata';

function ordineVeloce() {
  return {
    id: 'o1', user_id: 'maria', seller_id: 'forno', delivery_status: 'NEW', delivery_slot: ETICHETTA_ADESSO,
    pickup_in_store: false, payment_method: 'card', payment_status: 'PAID', total_price: 19, gross_total_cents: 1900,
    wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
    stripe_session_id: 'cs_1', stripe_payment_intent: 'pi_1', stripe_refund_id: null, refunded_amount_cents: 0,
    seller_payout_cents: 1350, seller_payout_reversed_cents: 0, payout_status: 'PENDING', rider_id: null,
    stripe_transfer_id: null, internal_dispute_status: null, rider_transfer_id: null, rider_payout_status: null,
    rider_payout_reversed_cents: 0, created_at: '2026-10-30T17:05:00.000Z',
  };
}

const admin = () => stato.libro.client as unknown as Parameters<typeof frenoDellaVeloce>[0];
const o1 = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const campanella = () => (stato.libro.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'maria').map((n) => String(n.body));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  stato.stripe = creaStripe();
  stato.avvisi = [];
  stato.libro = creaLibro({
    orders: [ordineVeloce()],
    profiles: [{ id: 'forno', store_hours: null }],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-011 · due giri del freno sovrapposti sullo stesso ordine con la carta', () => {
  it('tutti e due leggono «niente reso» e chiedono l euro: 1 € nel libro, e a Maria «ti torna sulla carta», non «a mano»', async () => {
    // Il giro delle 18:16 guarda Stripe e la risposta tarda; intanto il giro delle 18:21 legge
    // l'ordine (niente reso), prenota l'euro e chiede il rimborso, che a sua volta tarda. Poi al
    // primo arriva la risposta di Stripe (niente ancora) e va avanti.
    let rispondeLElenco!: () => void;
    let rispondeIlRimborso!: () => void;
    stato.stripe.listLenta = new Promise<void>((r) => { rispondeLElenco = r; });
    vi.setSystemTime(new Date('2026-10-30T17:16:00.000Z'));
    const primo = frenoDellaVeloce(admin(), new Date('2026-10-30T17:16:00.000Z'));
    await vi.waitFor(() => expect(stato.stripe.listLenta).toBeNull());

    stato.stripe.createLenta = new Promise<void>((r) => { rispondeIlRimborso = r; });
    vi.setSystemTime(new Date('2026-10-30T17:21:00.000Z'));
    const secondo = frenoDellaVeloce(admin(), new Date('2026-10-30T17:21:00.000Z'));
    await vi.waitFor(() => expect(stato.stripe.createLenta).toBeNull());

    rispondeLElenco();
    await primo;
    rispondeIlRimborso();
    await secondo;

    expect(stato.stripe.creati).toEqual([100]);
    expect(o1().refunded_amount_cents).toBe(100);
    expect(o1().delivery_slot).toBe('Oggi · 18:00–19:30');
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain('ti torna sulla carta');
    expect(campanella()[0]).not.toContain('a mano');
    expect(stato.avvisi.filter((a) => a.includes('a mano'))).toEqual([]);
  });
});
