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

import { prezziDelCarrello, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { annullaERimborsa } from '@/lib/ordini/annulla';

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


describe('collaudo: tutti gli ordini del carrello scadono nello stesso giro', () => {
  it('carta, pane 15 (primo) + frutta 12, nessuno conferma: i rimborsi rendono tutti i 31 € addebitati', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', [vecchio, '2026-10-20T08:00:01Z']);
    const addebito = ordini.reduce((s, o) => s + Math.round(Number(o.total_price) * 100), 0);
    db = finto({ orders: ordini });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    const resi = refundOrder.mock.calls.map((c) => c[0]);
    console.log('ADDEBITO', addebito, 'RIMBORSI', JSON.stringify(resi.map((r) => [r.orderId, r.amountCents])), 'FRUTTA', JSON.stringify(riga('frutta')));
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
    console.log('ADDEBITO', addebito, 'RIMBORSI', JSON.stringify(resi.map((r) => [r.orderId, r.amountCents])));
    expect(resi.reduce((s, r) => s + r.amountCents, 0)).toBe(addebito);
  });
});

describe('collaudo: il rimborso fallisce dopo che la consegna è stata riscritta', () => {
  it('giro degli scaduti, Stripe non risponde sul pane: il pane torna NEW con i suoi 3 € al fattorino', async () => {
    const vecchio = '2026-10-20T08:00:00Z';
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card', [vecchio, '2999-01-01T00:00:01Z']);
    db = finto({ orders: ordini });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });
    const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
    await (POST as unknown as () => Promise<unknown>)();
    console.log('PANE', JSON.stringify(riga('pane')), 'FRUTTA', JSON.stringify(riga('frutta')));
    expect(riga('pane').delivery_status).toBe('NEW');
    expect(riga('pane')).toMatchObject({ rider_fee_cents: 300, delivery_fee_cents: 300, total_price: 18 });
  });
  it('rifiuto del negozio con la carta, Stripe non risponde: il pane resta vivo con la consegna e il fattorino di prima', async () => {
    const ordini = carrello(['pane', 'frutta'], [1500, 1200], 'card');
    db = finto({ orders: ordini });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe 503'); });
    const esito = await annullaERimborsa(db as never, riga('pane') as never, { reason: 'rifiutato' } as never);
    console.log('ESITO', JSON.stringify(esito), 'PANE', JSON.stringify(riga('pane')), 'FRUTTA', JSON.stringify(riga('frutta')));
    expect(riga('pane').delivery_status).not.toBe('CANCELED');
    expect(riga('pane')).toMatchObject({ rider_fee_cents: 300, delivery_fee_cents: 300, total_price: 18 });
  });
});
