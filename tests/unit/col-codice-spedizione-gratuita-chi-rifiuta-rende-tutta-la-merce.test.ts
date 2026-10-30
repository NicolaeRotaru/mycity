import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 30/10/2026 — §4 dei Termini: se un negozio rifiuta in un carrello con più negozi «ti tornano la
 * merce del Venditore che ha rifiutato e la differenza della consegna». Col codice «Spedizione
 * gratuita» il forno da 30 € pagava 0 di consegna (la sua commissione copriva il fattorino) e la
 * frutta da 12 € pagava 1 €. Il forno rifiuta: la frutta da sola, col codice, pagherebbe 1,80 €.
 * Prima quegli 80 centesimi li cedeva il forno, che una consegna da cedere non l'aveva: tornavano
 * 29,20 € su 30 di merce. Adesso i rimasti salgono al massimo di quanto chi se ne va aveva di
 * consegna; il resto lo tiene la piattaforma, il fattorino prende comunque il compenso pieno.
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

const ingressi = (merci: number[], codice: boolean, veloce = false): IngressiPrezzo => ({
  gruppi: merci.map((s, i) => ({ sellerId: `s${i}`, subtotalCents: s })),
  coordinateNegozio: () => ({ lat: null, lng: null }),
  consegnaLat: null,
  consegnaLng: null,
  pickupInStore: false,
  couponSpedizioneGratis: codice,
  couponScontoCents: 0,
  consegnaVeloce: veloce,
});

/** Gli ordini del carrello come li scrive la cassa, per il conto puro. */
function delGiro(merci: number[], codice: boolean, veloce = false) {
  const e = prezziDelCarrello(ingressi(merci, codice, veloce));
  return {
    e,
    ordini: e.gruppi.map((g, i) => ({
      id: `o${i}`, spesaCents: g.subtotalCents, merceCents: g.subtotalCents - g.couponPortionCents - g.pickupPortionCents,
      shippingCents: g.shippingCents, deliveryFeeCents: g.deliveryFeeCents, riderFeeCents: g.riderFeeCents, giaAnnullato: false,
    })),
  };
}

const riga = (id: string) => db.tabelle.orders.find((r) => r.id === id)!;
beforeEach(() => refundOrder.mockClear());

describe('col codice Spedizione gratuita, il negozio che rifiuta rende tutta la sua merce', () => {
  it('il conto: forno 30 € (consegna 0) e frutta 12 € (1 €), il forno rifiuta → tornano 30 €, la frutta resta a 1 €', () => {
    const { e, ordini } = delGiro([3000, 1200], true);
    expect(ordini.map((o) => [o.deliveryFeeCents, o.riderFeeCents])).toEqual([[0, 300], [100, 100]]);
    const c = consegnaDopoLAnnullo({ ordini, annullaId: 'o0', consegnaVeloce: false, pickupInStore: false })!;
    expect(c.annullato.deltaCents).toBe(0);
    expect(e.gruppi[0].totalCents + c.annullato.deltaCents).toBe(3000);
    expect(c.rimasti).toEqual([{ id: 'o1', deliveryFeeCents: 100, riderFeeCents: 300, deltaCents: 0 }]);
    expect(c.differenzaCents).toBe(0);
  });

  it('su ogni carrello, col codice e senza, chi se ne va rende almeno merce e spedizione, e la consegna si conserva', () => {
    const M = [1, 500, 999, 1000, 1200, 1500, 3000, 6000];
    const carrelli: number[][] = [];
    for (const a of M) for (const b of M) { carrelli.push([a, b]); for (const c of M) carrelli.push([a, b, c]); }
    const fuori: string[] = [];
    let contati = 0;
    for (const veloce of [false, true]) for (const codice of [false, true]) for (const merci of carrelli) {
      const { e, ordini } = delGiro(merci, codice, veloce);
      merci.forEach((_, k) => {
        const c = consegnaDopoLAnnullo({ ordini, annullaId: `o${k}`, consegnaVeloce: veloce, pickupInStore: false });
        if (!c) return;
        contati++;
        const tag = `${merci.join('+')} v=${veloce} c=${codice} via=${k}`;
        const reso = e.gruppi[k].totalCents + c.annullato.deltaCents;
        if (reso < ordini[k].merceCents + ordini[k].shippingCents) fuori.push(`${tag}: rende ${reso} su ${ordini[k].merceCents}`);
        if (c.annullato.deliveryFeeCents < 0) fuori.push(`${tag}: consegna negativa`);
        const prima = ordini.reduce((s, o) => s + o.deliveryFeeCents, 0);
        const dopo = c.rimasti.reduce((s, r) => s + r.deliveryFeeCents, 0) + c.annullato.deliveryFeeCents;
        if (prima !== dopo) fuori.push(`${tag}: conservazione ${prima} != ${dopo}`);
        // Il fattorino prende sempre il compenso del carrello nuovo; la consegna è quella della
        // regola tutte le volte che la consegna di chi se ne va basta a coprirla.
        const nuovo = prezziDelCarrello(ingressi(merci.filter((_, j) => j !== k), codice, veloce)).gruppi;
        if (c.rimasti.some((r, i) => r.riderFeeCents !== nuovo[i].riderFeeCents)) fuori.push(`${tag}: fattorino`);
        const sale = nuovo.reduce((s, g) => s + g.deliveryFeeCents, 0) - (prima - ordini[k].deliveryFeeCents);
        if (sale <= ordini[k].deliveryFeeCents && c.rimasti.some((r, i) => r.deliveryFeeCents !== nuovo[i].deliveryFeeCents)) {
          fuori.push(`${tag}: consegna diversa dalla regola anche se ci stava`);
        }
      });
    }
    expect(contati).toBeGreaterThan(1000);
    expect(fuori.slice(0, 6)).toEqual([]);
  });

  it('carta, la strada vera: il forno rifiuta e il rimborso è di 30 €, la frutta resta a 13 € col fattorino a 3 €', async () => {
    const { e } = delGiro([3000, 1200], true);
    const ordini = e.gruppi.map((g, i) => ({
      id: ['forno', 'frutta'][i], user_id: 'u1', seller_id: g.sellerId, delivery_status: 'NEW', payment_method: 'card',
      payment_status: 'PAID', stripe_payment_intent: 'pi_1', stripe_session_id: 'cs_1', total_price: g.totalCents / 100,
      gross_total_cents: g.totalCents, wallet_applied_cents: 0, shipping_cost: g.shippingCents / 100,
      delivery_fee_cents: g.deliveryFeeCents, rider_fee_cents: g.riderFeeCents, discount_amount: 0,
      delivery_slot: 'Oggi 18:00-20:00', pickup_in_store: false, coupon_code: null, cash_confirmed_at: null,
      refunded_amount_cents: 0, internal_dispute_status: null, created_at: `2026-10-29T10:00:0${i}Z`,
    }));
    db = finto({ orders: ordini });
    const esito = await annullaERimborsa(db as never, { ...ordini[0] } as never, { reason: 'Rifiutato dal negozio' });
    expect(esito.ok).toBe(true);
    expect(refundOrder).toHaveBeenCalledTimes(1);
    expect(refundOrder.mock.calls[0][0]).toMatchObject({ orderId: 'forno', amountCents: 3000 });
    expect(riga('frutta')).toMatchObject({ delivery_fee_cents: 100, rider_fee_cents: 300, total_price: 13 });
  });
});
