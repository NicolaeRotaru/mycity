import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/10/2026 00:35 — consegna.negozio-che-rifiuta. Pane 15 € e frutta 12 €, consegna 4 €; il forno
 * rifiuta: la frutta resta a 3 € di consegna, al cliente tornano 16 €, il fattorino prende 3 €.
 * Prima l'ordine della frutta restava con 1 € di consegna e la base spariva col rimborso del forno.
 * Le prove passano dalle strade vere: il rifiuto/annullo (`annullaERimborsa`) e il giro degli
 * ordini scaduti, su un database finto che applica davvero filtri e scritture.
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

import { prezziDelCarrello, consegnaDopoLAnnullo, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { annullaERimborsa, COLONNE_ANNULLO } from '@/lib/ordini/annulla';
import { computeOrderSplit } from '@/lib/stripe/client';

type Riga = Record<string, unknown>;
function finto(tabelle: Record<string, Riga[]>) {
  const from = (t: string) => {
    const righe = (tabelle[t] ??= []);
    const filtri: Array<(r: Riga) => boolean> = [];
    let valori: Riga | null = null;
    let lim = Infinity;
    let unico = false;
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      order: () => q,
      update: (v: Riga) => ((valori = v), q),
      insert: (v: Riga | Riga[]) => (righe.push(...(Array.isArray(v) ? v : [v])), q),
      eq: (c: string, v: unknown) => (filtri.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filtri.push((r) => r[c] !== v), q),
      lt: (c: string, v: unknown) => (filtri.push((r) => String(r[c]) < String(v)), q),
      in: (c: string, vs: unknown[]) => (filtri.push((r) => vs.includes(r[c])), q),
      contains: (c: string, v: string) => {
        const voluti = JSON.parse(v) as Riga[];
        filtri.push((r) =>
          voluti.every((w) => ((r[c] as Riga[]) ?? []).some((x) => Object.entries(w).every(([k, val]) => x[k] === val))),
        );
        return q;
      },
      limit: (n: number) => ((lim = n), q),
      maybeSingle: () => ((unico = true), q),
      single: () => ((unico = true), q),
      then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) => {
        const prese = righe.filter((r) => filtri.every((f) => f(r)));
        if (valori) for (const r of prese) Object.assign(r, valori);
        const data = prese.slice(0, lim).map((r) => ({ ...r }));
        return Promise.resolve({ data: unico ? (data[0] ?? null) : data, error: null }).then(ok, ko);
      },
    });
    return q;
  };
  return { from, rpc: async () => ({ data: null, error: null }), tabelle };
}

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

describe('se un negozio del carrello se ne va prima della consegna, la consegna si rifà sui rimasti', () => {
  it('il conto: pane 15 + frutta 12, il forno rifiuta → frutta 3 € di consegna e 3 € al fattorino, rendi 16 €', () => {
    const e = prezziDelCarrello(ingressi([1500, 1200]));
    expect(e.grandDeliveryFeeCents).toBe(400);
    const ordini = e.gruppi.map((g, i) => ({
      id: ['pane', 'frutta'][i], spesaCents: g.subtotalCents, merceCents: g.subtotalCents, shippingCents: g.shippingCents,
      deliveryFeeCents: g.deliveryFeeCents, riderFeeCents: g.riderFeeCents, giaAnnullato: false,
    }));
    const c = consegnaDopoLAnnullo({ ordini, annullaId: 'pane', consegnaVeloce: false, pickupInStore: false })!;
    expect(c.rimasti).toEqual([{ id: 'frutta', deliveryFeeCents: 300, riderFeeCents: 300, deltaCents: 200 }]);
    expect(e.gruppi[0].totalCents + c.annullato.deltaCents).toBe(1600);
    // Un conto che non è quello della regola (carrello vecchio, già ricalcolato) non si tocca.
    expect(consegnaDopoLAnnullo({ ordini: ordini.map((o) => ({ ...o, deliveryFeeCents: 300 })), annullaId: 'pane', consegnaVeloce: false, pickupInStore: false })).toBeNull();
  });

  it('contanti, il forno rifiuta: l ordine della frutta si paga 15 € alla porta, col fattorino a 3 €', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    db = finto({ orders: ordini, cod_checkout_attempts: [{ chiave: 'k', user_id: 'u1', order_ids: [{ id: 'pane' }, { id: 'frutta' }] }] });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15, gross_total_cents: 1500 });
    expect(COLONNE_ANNULLO).toContain('stripe_session_id');
  });

  it('carta, il forno rifiuta: tornano 16 € e i bonifici della frutta stanno nei 15 € rimasti sulla charge', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder).toHaveBeenCalledTimes(1);
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'pane', amountCents: 1600 });
    const f = riga('frutta');
    expect(f).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 15 });
    const { sellerPayoutCents } = computeOrderSplit({ totalCents: 1500, deliveryFeeCents: 300, shippingCents: 0 });
    expect(sellerPayoutCents + 300).toBeLessThanOrEqual(3100 - 1600);
    // Il secondo annullo dello stesso ordine non sposta altri soldi.
    await annullaERimborsa(db as never, { ...riga('pane') } as never, { reason: 'di nuovo' });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, total_price: 15 });
  });

  it('il reso dopo la consegna non cambia la consegna: con un ordine consegnato nel carrello non si tocca niente', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    ordini[1].delivery_status = 'DELIVERED';
    db = finto({ orders: ordini, cod_checkout_attempts: [{ chiave: 'k', user_id: 'u1', order_ids: [{ id: 'pane' }, { id: 'frutta' }] }] });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'annullo' });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
  });

  it('tre negozi, il primo non conferma in tempo: il giro degli scaduti rende 21 € e rifà la consegna', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const ordini = carrello(['carne', 'pane', 'frutta'], [2000, 1500, 1200], 'card', [vecchio, '2999-01-01T00:00:01Z', '2999-01-01T00:00:02Z']);
    db = finto({ orders: ordini });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    expect(riga('carne').delivery_status).toBe('CANCELED');
    expect(refundOrder.mock.calls.map((c) => c[0])).toEqual([expect.objectContaining({ orderId: 'carne', amountCents: 2100 })]);
    expect(riga('pane')).toMatchObject({ delivery_fee_cents: 300, rider_fee_cents: 300, total_price: 18 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
  });
});
