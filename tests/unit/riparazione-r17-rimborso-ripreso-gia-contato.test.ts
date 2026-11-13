import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';
import { TIMEOUT } from './aiuti/finto-database-dei-pagamenti';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/libro-dei-rimborsi-finto';

/**
 * R17-019 — Il rimborso è uscito, ma non è arrivato all'elenco dei rimborsi dell'ordine.
 *
 * ① Reso con la carta. Ordine da 40 €, bonifico al negozio già partito (36 €). Il negozio approva un
 *   reso da 20 €: Stripe rimborsa, al negozio si tolgono 18 €, l'ordine segna 20 €, ma la scrittura
 *   dell'id del rimborso nell'elenco dell'ordine cade (finiva solo nei log). Intanto dal cruscotto di
 *   Stripe escono altri 20 € sullo stesso pagamento, che il sito non ha ancora registrato. Il negozio
 *   riprova: prima il controllo della ripresa faceva un conto sui totali (20 registrati contro 40 su
 *   Stripe meno questi 20) e credeva il reso non contato; lo registrava di nuovo e al negozio si
 *   toglievano altri 18 €. Adesso lo dice il libro (412): la prenotazione di quella chiave c'è, il
 *   rimborso è contato; si scrive solo l'id nell'elenco, e una persona controlla i conti.
 * ② Il freno della veloce che muore dopo il rimborso e prima dell'elenco: il giro dopo non prende
 *   l'euro per «un altro rimborso» da rendere a mano (che l'amministrazione avrebbe registrato di
 *   nuovo), ma lo riconosce dal libro.
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

import { refundOrder } from '@/lib/stripe/payout';
import { frenoDellaVeloce } from '@/lib/ordini/veloce-non-confermata';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const reso = () =>
  refundOrder({ orderId: 'o1', amountCents: 2000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
const sommaStorni = () => stato.stripe.storni.reduce((s, x) => s + x.amount, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-13T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.avvisi = [];
});
afterEach(() => vi.useRealTimers());

describe('R17-019 · ① il reso con la carta uscito ma non scritto nell elenco', () => {
  beforeEach(() => {
    stato.libro = creaLibro({
      orders: [ordineConCarta()],
      profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
      notifications: [],
    });
  });

  it('con 20 € dal cruscotto non ancora registrati, la ripresa non registra il reso di nuovo: al negozio 18 €, non 36', async () => {
    let cadeLElenco = true;
    stato.libro.db.guasto = (s) => {
      const v = s.valori;
      if (!cadeLElenco || s.tabella !== 'orders' || s.operazione !== 'update' || !v || Array.isArray(v) || !('stripe_refund_id' in v)) return null;
      cadeLElenco = false;
      return TIMEOUT;
    };
    const prima = await reso();
    expect(prima.refundId).toBe('re_1');
    expect(ordine().stripe_refund_id ?? null).toBeNull();

    stato.stripe.suStripe.push({ id: 're_cruscotto', amount: 2000, status: 'succeeded', metadata: {}, chiave: null });
    vi.setSystemTime(new Date('2026-11-13T11:00:00.000Z'));
    const esito = await reso();

    expect(esito.refundId).toBe('re_1');
    expect(stato.stripe.creati).toEqual([2000]);
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(sommaStorni()).toBe(1800);
    expect(String(ordine().stripe_refund_id)).toContain('re_1');
    expect(stato.avvisi.some((a) => a.includes('Rimborso ripreso'))).toBe(true);
  });
});

describe('R17-019 · ② il freno muore dopo il rimborso e prima dell elenco', () => {
  beforeEach(() => {
    stato.libro = creaLibro({
      orders: [{
        id: 'o1', user_id: 'maria', seller_id: 'forno', delivery_status: 'NEW', delivery_slot: ETICHETTA_ADESSO,
        pickup_in_store: false, payment_method: 'card', payment_status: 'PAID', total_price: 19, gross_total_cents: 1900,
        wallet_applied_cents: 0, shipping_cost: 0, delivery_fee_cents: 400, rider_fee_cents: 300, discount_amount: 0,
        stripe_session_id: 'cs_1', stripe_payment_intent: 'pi_1', stripe_refund_id: null, refunded_amount_cents: 0,
        seller_payout_cents: 1350, seller_payout_reversed_cents: 0, payout_status: 'PENDING', rider_id: null,
        stripe_transfer_id: null, internal_dispute_status: null, rider_transfer_id: null, rider_payout_status: null,
        rider_payout_reversed_cents: 0, created_at: '2026-10-30T17:05:00.000Z',
      }],
      profiles: [{ id: 'forno', store_hours: null }],
      notifications: [],
    });
  });

  it('il giro dopo riconosce l euro già reso: niente «a mano», niente rimborso nuovo, il libro dice 1 €', async () => {
    // Il giro delle 18:16 rende l'euro e muore lì, prima di scriverlo nell'elenco dell'ordine.
    stato.stripe.createPoiMuore = true;
    vi.setSystemTime(new Date('2026-10-30T17:16:00.000Z'));
    const admin = stato.libro.client as unknown as Parameters<typeof frenoDellaVeloce>[0];
    void frenoDellaVeloce(admin, new Date('2026-10-30T17:16:00.000Z'));
    await vi.waitFor(() => expect(stato.stripe.creati).toEqual([100]));
    expect(ordine().refunded_amount_cents).toBe(100);
    expect(ordine().stripe_refund_id ?? null).toBeNull();

    vi.setSystemTime(new Date('2026-10-30T17:31:00.000Z'));
    await frenoDellaVeloce(admin, new Date('2026-10-30T17:31:00.000Z'));

    const campanella = (stato.libro.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'maria').map((n) => String(n.body));
    expect(stato.stripe.creati).toEqual([100]);
    expect(ordine().refunded_amount_cents).toBe(100);
    expect(String(ordine().stripe_refund_id)).toContain('re_1');
    expect(campanella).toHaveLength(1);
    expect(campanella[0]).toContain('ti torna sulla carta');
    expect(stato.avvisi.filter((a) => a.includes('a mano'))).toEqual([]);
  });
});
