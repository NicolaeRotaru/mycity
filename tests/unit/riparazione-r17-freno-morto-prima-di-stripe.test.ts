import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { creaLibro, creaStripe, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';

/**
 * R17-016 — Il giro del freno che muore fra la prenotazione dell'euro e Stripe.
 *
 * Maria ordina con la veloce alle 18:05 (19 €, consegna 4 €) e paga con la carta; il forno non
 * conferma. Il giro delle 18:16 prenota l'euro da rendere e muore prima che la richiesta arrivi a
 * Stripe (la funzione che scade): 1 € segnato come reso, nessun soldo uscito, nessun rimborso
 * nell'elenco dell'ordine. Prima il giro dopo lo prendeva per «un altro rimborso»: a Maria scriveva
 * «te lo rendiamo a mano», agli amministratori «rendilo a mano», e il rimborso a mano portava il
 * libro a 2 €. Adesso il giro dopo riconosce la prenotazione del freno (migrazione 412): finché il
 * giro di prima potrebbe essere vivo aspetta, poi rende l'euro una volta sola e lo conta una volta.
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

describe('R17-016 · il giro del freno muore fra la prenotazione e Stripe', () => {
  it('il giro dopo non dice «a mano»: passati 10 minuti l euro esce una volta, il libro dice 1 €, e Maria legge «ti torna sulla carta»', async () => {
    stato.stripe.createMuore = true;
    vi.setSystemTime(new Date('2026-10-30T17:16:00.000Z'));
    void frenoDellaVeloce(admin(), new Date('2026-10-30T17:16:00.000Z'));
    await vi.waitFor(() => expect(o1().refunded_amount_cents).toBe(100));

    // Alle 18:21 il giro di prima potrebbe essere ancora dentro Stripe: si aspetta, senza scrivere niente.
    vi.setSystemTime(new Date('2026-10-30T17:21:00.000Z'));
    await frenoDellaVeloce(admin(), new Date('2026-10-30T17:21:00.000Z'));
    expect(o1().delivery_slot).toBe(ETICHETTA_ADESSO);
    expect(campanella()).toEqual([]);

    // Alle 18:31 quel giro è morto da un pezzo: questo rende l'euro e sposta il carrello.
    vi.setSystemTime(new Date('2026-10-30T17:31:00.000Z'));
    await frenoDellaVeloce(admin(), new Date('2026-10-30T17:31:00.000Z'));

    expect(stato.stripe.creati).toEqual([100]);
    expect(o1().refunded_amount_cents).toBe(100);
    expect(String(o1().stripe_refund_id)).toContain('re_1');
    expect(String(o1().delivery_slot)).toMatch(/^Oggi · /);
    expect(campanella()).toHaveLength(1);
    expect(campanella()[0]).toContain('ti torna sulla carta');
    expect(campanella()[0]).not.toContain('a mano');
    expect(stato.avvisi.filter((a) => a.includes('a mano'))).toEqual([]);
  });

  it('un rimborso già sull ordine che non è del freno resta a una persona, come prima', async () => {
    Object.assign(o1(), { refunded_amount_cents: 100, stripe_refund_id: null, payment_status: 'PARTIALLY_REFUNDED' });
    vi.setSystemTime(new Date('2026-10-30T17:16:00.000Z'));
    await frenoDellaVeloce(admin(), new Date('2026-10-30T17:16:00.000Z'));
    expect(stato.stripe.creati).toEqual([]);
    expect(o1().refunded_amount_cents).toBe(100);
    expect(campanella()[0]).toContain('a mano');
  });
});
