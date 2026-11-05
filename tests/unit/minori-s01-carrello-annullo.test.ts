import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — il carrello dopo un annullo (banco preso da se-un-negozio-rifiuta-la-consegna-si-rifa-sui-negozi-rimasti).
 *  · 25: se un altro ordine del carrello ha gia' i contanti incassati, la consegna non si rifa'
 *    (la cassa del fattorino non va in ammanco).
 *  · 2224: con la carta e un rimborso parziale gia' fatto, l'email del carrello dice il rimborso vero.
 */

const refundOrder = vi.fn(async (_a: { orderId: string; amountCents: number }) => ({ refundId: 're_1' }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: { orderId: string; amountCents: number }) => refundOrder(a) }));
vi.mock('@/lib/stripe/client', async (orig) => ({ ...(await orig<object>()), isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/rimborsi-da-dividere', () => ({ ilCarrelloAspettaLaDivisione: async () => false }));
vi.mock('@/lib/stripe/webhook/comune', () => ({ notifyAdmins: vi.fn(async () => undefined) }));
const posta = vi.hoisted(() => ({ spedite: [] as Array<Record<string, unknown>> }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: Record<string, unknown>) => (posta.spedite.push(m), { ok: true })) }));
vi.mock('@/lib/api/middleware', () => ({ withCronAuth: (h: unknown) => h }));
let db: ReturnType<typeof finto>;
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => db }));

import { prezziDelCarrello, consegnaDopoLAnnullo, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { annullaERimborsa, COLONNE_ANNULLO } from '@/lib/ordini/annulla';
import { computeOrderSplit } from '@/lib/stripe/client';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

type Riga = Record<string, unknown>;
function finto(tabelle: Record<string, Riga[]>) {
  const auth = { admin: { getUserById: async () => ({ data: { user: { email: 'maria@example.it' } }, error: null }) } };
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
  return { from, rpc: async () => ({ data: null, error: null }), tabelle, auth };
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

beforeEach(() => {
  refundOrder.mockClear();
  posta.spedite.length = 0;
});

describe('25 — contanti già incassati su un altro ordine del carrello', () => {
  it('la frutta è già incassata: il pane salta e la frutta non cambia totale', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    ordini[1].delivery_status = 'OUT_FOR_DELIVERY';
    (ordini[1] as Riga).cash_confirmed_at = '2026-10-29T17:40:00Z';
    db = finto({ orders: ordini, cod_checkout_attempts: [{ chiave: 'k', user_id: 'u1', order_ids: [{ id: 'pane' }, { id: 'frutta' }] }] });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(riga('pane').delivery_status).toBe('CANCELED');
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 100, total_price: 13 });
  });
  it('controprova: frutta non ancora incassata, la consegna si rifà come prima', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'cod');
    db = finto({ orders: ordini, cod_checkout_attempts: [{ chiave: 'k', user_id: 'u1', order_ids: [{ id: 'pane' }, { id: 'frutta' }] }] });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 300, total_price: 15 });
  });
});

describe('2224 — carta con rimborso parziale già fatto: l email dice il rimborso vero', () => {
  it('pane con 5 € già resi, il forno rifiuta: rimborso 11 €, l email non dice 16 €', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    (ordini[0] as Riga).refunded_amount_cents = 500;
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'pane', amountCents: 1100 });
    const testi = posta.spedite.map((m) => String(m.text)).join('\n');
    // 5/11/2026 (unione) — S03 scrive le cifre dell'email con i centesimi («11,00 €»).
    expect(testi).toMatch(/ti tornano 11(,00)?\s€/);
    expect(testi).not.toMatch(/ti tornano 16(,00)?\s€/);
  });
});

describe('2229 — la sonda P3: giro notturno, carta, scade il pane', () => {
  it('l email del carrello dice «ti tornano 16 € sulla carta» e il rimborso è di 16 €', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const adesso = new Date().toISOString();
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', [vecchio, adesso]);
    db = finto({ orders: ordini });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    expect(refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents])).toEqual([['pane', 1600]]);
    const testi = posta.spedite.map((m) => String(m.text)).join('\n');
    expect(testi).toMatch(/ti tornano 16(,00)?\s€ sulla carta/);
  });
});
