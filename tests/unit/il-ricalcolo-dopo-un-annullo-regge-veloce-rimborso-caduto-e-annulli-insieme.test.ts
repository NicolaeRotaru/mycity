import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/10/2026 — IL RICALCOLO DOPO UN ANNULLO REGGE I CASI SCOMODI (consegna.negozio-che-rifiuta).
 *
 * Nato come appunto del collaudo dell'ondata 15 («o15ca», lente A); rinominato col comportamento.
 * Se diventa rosso, uno di questi soldi torna sbagliato dopo che un negozio del carrello se ne va:
 *  · i rimasti non hanno la consegna e il fattorino di un carrello nuovo coi soli rimasti (V1);
 *  · la consegna veloce sparisce dal conto, con la carta o coi contanti (V2, V3);
 *  · il rimborso cade e il carrello resta riscritto a metà (V4, V5);
 *  · due annulli quasi insieme rendono più o meno dei 31 € addebitati (V6, V7).
 * Il caso base (pane 15 + frutta 12, tornano 16 €) sta in
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
import { prezziDelCarrello, consegnaDopoLAnnullo, type IngressiPrezzo } from '@/lib/ordini/prezzi';
import { annullaERimborsa } from '@/lib/ordini/annulla';
import { ETICHETTA_ADESSO } from '@/lib/quando-arriva';

const ing = (merci: number[], veloce: boolean, codice: boolean): IngressiPrezzo => ({
  gruppi: merci.map((s, i) => ({ sellerId: `s${i}`, subtotalCents: s })),
  coordinateNegozio: () => ({ lat: null, lng: null }),
  consegnaLat: null, consegnaLng: null, pickupInStore: false,
  couponSpedizioneGratis: codice, couponScontoCents: 0, consegnaVeloce: veloce,
});
function righe(merci: number[], veloce: boolean, pagamento: 'cod' | 'card') {
  const e = prezziDelCarrello(ing(merci, veloce, false));
  return e.gruppi.map((g, i) => ({
    id: `o${i}`, user_id: 'u1', seller_id: g.sellerId, delivery_status: 'NEW', payment_method: pagamento,
    payment_status: pagamento === 'card' ? 'PAID' : 'PENDING', stripe_payment_intent: pagamento === 'card' ? 'pi_1' : null,
    stripe_session_id: pagamento === 'card' ? 'cs_1' : null, total_price: g.totalCents / 100, gross_total_cents: g.totalCents,
    wallet_applied_cents: 0, shipping_cost: g.shippingCents / 100, delivery_fee_cents: g.deliveryFeeCents,
    rider_fee_cents: g.riderFeeCents, discount_amount: 0, delivery_slot: veloce ? ETICHETTA_ADESSO : 'Oggi 18:00-20:00',
    pickup_in_store: false, coupon_code: null, cash_confirmed_at: null, refunded_amount_cents: 0,
    internal_dispute_status: null, created_at: `2026-10-29T10:00:0${i}Z`,
  }));
}
const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
beforeEach(() => refundOrder.mockClear());

describe('il ricalcolo dopo un annullo regge la veloce, il rimborso caduto e due annulli quasi insieme', () => {
  it('V1 proprieta: dopo l annullo i rimasti hanno la consegna e il fattorino di un carrello nuovo coi soli rimasti', () => {
    const out: string[] = [];
    const M = [1, 500, 999, 1000, 1500, 3000, 6000];
    const carrelli: number[][] = [];
    for (const a of M) for (const b of M) { carrelli.push([a, b]); for (const c of M) carrelli.push([a, b, c]); }
    for (const veloce of [false, true]) for (const codice of [false, true]) for (const merci of carrelli) {
      const full = prezziDelCarrello(ing(merci, veloce, codice));
      const ordini = full.gruppi.map((g, i) => ({ id: `o${i}`, spesaCents: g.subtotalCents,
        merceCents: g.subtotalCents - g.couponPortionCents - g.pickupPortionCents, shippingCents: g.shippingCents,
        deliveryFeeCents: g.deliveryFeeCents, riderFeeCents: g.riderFeeCents, giaAnnullato: false }));
      merci.forEach((_, k) => {
        const tag = `${merci.join('+')} v=${veloce} c=${codice} via=${k}`;
        const c = consegnaDopoLAnnullo({ ordini, annullaId: `o${k}`, consegnaVeloce: veloce, pickupInStore: false });
        if (!c) { out.push(`${tag}: null`); return; }
        const exp = prezziDelCarrello(ing(merci.filter((_, j) => j !== k), veloce, codice)).gruppi;
        const got = c.rimasti.map((r) => `${r.deliveryFeeCents}/${r.riderFeeCents}`).join(',');
        const att = exp.map((g) => `${g.deliveryFeeCents}/${g.riderFeeCents}`).join(',');
        // La consegna è quella della regola quando la consegna di chi se ne va basta a coprirne la
        // salita; sopra, il tetto del §4 (tests/unit/col-codice-spedizione-gratuita-chi-rifiuta-
        // rende-tutta-la-merce.test.ts). Il fattorino è sempre quello del carrello nuovo.
        const resto = full.gruppi.filter((_, i) => i !== k);
        const sale = exp.reduce((s, g, j) => s + g.deliveryFeeCents - resto[j].deliveryFeeCents, 0);
        const ciSta = sale <= full.gruppi[k].deliveryFeeCents;
        if (ciSta && got !== att) out.push(`${tag}: ${got} invece di ${att}`);
        if (c.rimasti.some((r, j) => r.riderFeeCents !== exp[j].riderFeeCents)) out.push(`${tag}: fattorino`);
        const prima = full.gruppi.reduce((s, g) => s + g.deliveryFeeCents, 0);
        const dopo = c.rimasti.reduce((s, r) => s + r.deliveryFeeCents, 0) + full.gruppi[k].deliveryFeeCents + c.annullato.deltaCents;
        if (prima !== dopo) out.push(`${tag}: conservazione ${prima} != ${dopo}`);
      });
    }
    expect(out.slice(0, 6)).toEqual([]);
  });

  it('V2 veloce, carta: pane 15 + frutta 5 con la veloce, la frutta rifiuta → pane a 4 € di consegna, rendi 6 €', async () => {
    const ordini = righe([1500, 500], true, 'card');
    expect(ordini.map((o) => o.delivery_fee_cents)).toEqual([300, 200]);
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[1] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'o1', amountCents: 600 });
    expect(riga('o0')).toMatchObject({ delivery_fee_cents: 400, rider_fee_cents: 300, total_price: 19 });
  });

  it('V3 veloce, contanti: tre negozi, il piu grande rifiuta → il nuovo primo prende base, veloce compresa resta', async () => {
    const ordini = righe([3000, 1500, 500], true, 'cod');
    db = finto({ orders: ordini, cod_checkout_attempts: [{ chiave: 'k', user_id: 'u1', order_ids: ordini.map((o) => ({ id: o.id })) }] });
    await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    const exp = prezziDelCarrello(ing([1500, 500], true, false)).gruppi;
    expect([riga('o1').delivery_fee_cents, riga('o2').delivery_fee_cents]).toEqual(exp.map((g) => g.deliveryFeeCents));
    expect([riga('o1').rider_fee_cents, riga('o2').rider_fee_cents]).toEqual(exp.map((g) => g.riderFeeCents));
  });

  it('V4 carta, il rimborso fallisce: l ordine resta vivo e il carrello non deve restare riscritto a meta', async () => {
    const ordini = righe([1500, 1200], false, 'card');
    db = finto({ orders: ordini });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe timeout'); });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(false);
    expect(riga('o0').delivery_status).toBe('NEW');
    expect([riga('o0').delivery_fee_cents, riga('o0').rider_fee_cents, riga('o1').delivery_fee_cents, riga('o1').rider_fee_cents]).toEqual([300, 300, 100, 100]);
  });
  it('V5 carta: il forno rifiuta ma Stripe non risponde, poi rifiuta la frutta → il pane resta solo e deve pagare 3 € di consegna e 3 € al fattorino', async () => {
    const ordini = righe([1500, 1200], false, 'card');
    db = finto({ orders: ordini });
    refundOrder.mockImplementationOnce(async () => { throw new Error('Stripe timeout'); });
    const primo = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(primo.ok).toBe(false);
    refundOrder.mockImplementationOnce(async (a: { orderId: string }) => {
      Object.assign(riga(a.orderId), { delivery_status: 'CANCELED' });
      return { refundId: 're_2' };
    });
    await annullaERimborsa(db as never, { ...riga('o1') } as never, { reason: 'Rifiutato dal negozio' });
    const resa = refundOrder.mock.calls.at(-1)![0].amountCents;
    // Il cliente ha pagato 31 €: il pane da solo vale 15 + 3 di consegna, quindi della frutta tornano 13 €.
    expect({ resa, pane: [riga('o0').delivery_status, riga('o0').delivery_fee_cents, riga('o0').rider_fee_cents, riga('o0').total_price] })
      .toEqual({ resa: 1300, pane: ['NEW', 300, 300, 18] });
  });

  it('V6 carta, due annulli quasi insieme: la frutta legge il carrello, il forno rifiuta tutto prima che la frutta scriva → i rimborsi fanno 31 €', async () => {
    const ordini = righe([1500, 1200], false, 'card');
    const addebito = ordini.reduce((s, o) => s + Math.round(Number(o.total_price) * 100), 0);
    db = finto({ orders: ordini });
    refundOrder.mockImplementation(async (a: { orderId: string }) => {
      Object.assign(riga(a.orderId), { delivery_status: 'CANCELED' });
      return { refundId: `re_${a.orderId}` };
    });
    // Il forno (o0) rifiuta per intero nel momento in cui la frutta (o1) ha appena letto il carrello.
    const vero = db.from;
    let letture = 0;
    let colpo: (() => Promise<unknown>) | null = () =>
      annullaERimborsa(db as never, { ...riga('o0') } as never, { reason: 'Rifiutato dal negozio' });
    db.from = (t: string) => {
      const q = vero(t) as Record<string, unknown> & { then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) => unknown };
      if (t === 'orders' && ++letture === 2 && colpo) {
        const c = colpo;
        colpo = null;
        const avanti = q.then;
        q.then = (ok, ko) => avanti((x) => c().then(() => ok(x)), ko);
      }
      return q;
    };
    let resi: Array<[string, number]> = [];
    try {
      await annullaERimborsa(db as never, { ...riga('o1') } as never, { reason: 'Annullato dal cliente' });
      resi = refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents] as [string, number]);
    } finally {
      refundOrder.mockReset();
      refundOrder.mockImplementation(async () => ({ refundId: 're_1' }));
    }
    expect(resi.sort()).toEqual([['o0', 1600], ['o1', 1500]]);
    expect(1600 + 1500).toBe(addebito);
  });

  it('V7 carta, l altro verso: il forno ha già scritto la sua consegna, la frutta annulla per intero prima che il forno passi a lei → 18 + 13 = 31 €', async () => {
    const ordini = righe([1500, 1200], false, 'card');
    db = finto({ orders: ordini });
    refundOrder.mockImplementation(async (a: { orderId: string }) => {
      Object.assign(riga(a.orderId), { delivery_status: 'CANCELED' });
      return { refundId: `re_${a.orderId}` };
    });
    const vero = db.from;
    let letture = 0;
    let colpo: (() => Promise<unknown>) | null = () =>
      annullaERimborsa(db as never, { ...riga('o1') } as never, { reason: 'Annullato dal cliente' });
    db.from = (t: string) => {
      const q = vero(t) as Record<string, unknown> & { then: (ok: (x: unknown) => unknown, ko: (e: unknown) => unknown) => unknown };
      if (t === 'orders' && ++letture === 5 && colpo) {
        const c = colpo;
        colpo = null;
        const avanti = q.then;
        q.then = (ok, ko) => avanti((x) => c().then(() => ok(x)), ko);
      }
      return q;
    };
    let resi: Array<[string, number]> = [];
    try {
      await annullaERimborsa(db as never, { ...riga('o0') } as never, { reason: 'Rifiutato dal negozio' });
      resi = refundOrder.mock.calls.map((c) => [c[0].orderId, c[0].amountCents] as [string, number]);
    } finally {
      refundOrder.mockReset();
      refundOrder.mockImplementation(async () => ({ refundId: 're_1' }));
    }
    expect(resi.reduce((s, [, c]) => s + c, 0)).toBe(3100);
    expect(resi.sort()).toEqual([['o0', 1800], ['o1', 1300]]);
  });
});
