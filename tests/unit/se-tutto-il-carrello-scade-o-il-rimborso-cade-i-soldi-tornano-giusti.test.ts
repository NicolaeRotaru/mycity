import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/10/2026 — SE TUTTO IL CARRELLO SCADE INSIEME, O IL RIMBORSO CADE, I SOLDI TORNANO GIUSTI.
 *
 * Nato come appunto del collaudo («zz-collaudo-cron-due-scaduti»); rinominato col comportamento.
 * Se diventa rosso: o il giro degli scaduti, con tutti gli ordini dello stesso carrello scaduti nello
 * stesso giro, non rende più tutti i 31 € addebitati (in qualunque ordine li prenda); o un rimborso
 * che cade dopo il ricalcolo lascia la consegna del carrello riscritta e l'ordine vivo con 1 € di
 * consegna e il fattorino a 0. Il caso a tre negozi sta in
 * se-un-negozio-rifiuta-la-consegna-si-rifa-sui-negozi-rimasti.test.ts.
 */

const refundOrder = vi.fn(async (_a: { orderId: string; amountCents: number }) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { annullaERimborsa } from '@/lib/ordini/annulla';
import { finto } from './carrello-finto';

// 5/11/2026 (S04, scheda 2226) — Qui c'era una copia del database finto: la stessa di
// tests/unit/carrello-finto.ts, senza la simulazione della 124 e del cliente. Se ne tiene una sola.

const ingressi = (merci: number[], veloce = false): IngressiPrezzo => ({
  gruppi: merci.map((s, i) => ({ sellerId: `s${i}`, subtotalCents: s })),
  coordinateNegozio: () => ({ lat: null, lng: null }),
  consegnaLat: null,
  consegnaLng: null,
  pickupInStore: false,
  couponSpedizioneGratis: false,
  couponScontoCents: 0,
  consegnaVeloce: veloce,
});

/** Gli ordini come li scrive la cassa: stessi centesimi di prezziDelCarrello. */
function carrello(nomi: string[], merci: number[], pagamento: 'cod' | 'card', creati: string[] = []) {
  const e = prezziDelCarrello(ingressi(merci));
  return e.gruppi.map((g, i) => ({
    id: nomi[i],
    user_id: 'u1',
    seller_id: g.sellerId,
    delivery_status: 'NEW',
    payment_method: pagamento,
    payment_status: pagamento === 'card' ? 'PAID' : 'PENDING',
    stripe_payment_intent: pagamento === 'card' ? 'pi_1' : null,
    stripe_session_id: pagamento === 'card' ? 'cs_1' : null,
    total_price: g.totalCents / 100,
    gross_total_cents: g.totalCents,
    wallet_applied_cents: 0,
    shipping_cost: g.shippingCents / 100,
    delivery_fee_cents: g.deliveryFeeCents,
    rider_fee_cents: g.riderFeeCents,
    discount_amount: 0,
    delivery_slot: 'Oggi 18:00-20:00',
    pickup_in_store: false,
    coupon_code: null,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    internal_dispute_status: null,
    created_at: creati[i] ?? `2026-10-29T10:00:0${i}Z`,
  }));
}
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;

beforeEach(() => refundOrder.mockClear());


describe('tutti gli ordini del carrello scadono nello stesso giro', () => {
  it('carta, pane 15 (primo) + frutta 12, nessuno conferma: i rimborsi rendono tutti i 31 € addebitati', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', [vecchio, '2026-10-20T08:00:01Z']);
    const addebito = ordini.reduce((s, o) => s + Math.round(Number(o.total_price) * 100), 0);
    db = finto({ orders: ordini });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    const resi = refundOrder.mock.calls.map((c) => c[0]);
    expect(resi.reduce((s, r) => s + r.amountCents, 0)).toBe(addebito);
  });
  it('stesso carrello, ordine inverso nel giro (frutta prima): i rimborsi rendono 31 €', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', [vecchio, '2026-10-20T08:00:01Z']).reverse();
    const addebito = ordini.reduce((s, o) => s + Math.round(Number(o.total_price) * 100), 0);
    db = finto({ orders: ordini });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    const resi = refundOrder.mock.calls.map((c) => c[0]);
    expect(resi.reduce((s, r) => s + r.amountCents, 0)).toBe(addebito);
  });
});

describe('il rimborso fallisce dopo che la consegna è stata riscritta', () => {
  it('giro degli scaduti, Stripe non risponde sul pane: il pane torna NEW con i suoi 3 € al fattorino', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', [vecchio, '2999-01-01T00:00:01Z']);
    db = finto({ orders: ordini });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    expect(riga('pane').delivery_status).toBe('NEW');
    expect(riga('pane')).toMatchObject({ rider_fee_cents: 300, delivery_fee_cents: 300, total_price: 18 });
  });
  it('rifiuto del negozio con la carta, Stripe non risponde: il pane resta vivo con la consegna e il fattorino di prima', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    db = finto({ orders: ordini });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });
    await annullaERimborsa(db as never, riga('pane') as never, { reason: 'rifiutato' } as never);
    expect(riga('pane').delivery_status).not.toBe('CANCELED');
    expect(riga('pane')).toMatchObject({ rider_fee_cents: 300, delivery_fee_cents: 300, total_price: 18 });
  });
});
