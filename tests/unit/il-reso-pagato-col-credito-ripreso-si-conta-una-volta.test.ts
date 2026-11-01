import { describe, it, expect, vi } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi } from './aiuti/finto-database-dei-rimborsi';

/**
 * Collaudo finale (S1) — variante della scheda «dopo un guasto, chiudere il reso con i passi
 * normali registra due volte lo stesso rimborso»: ordine in contanti pagato TUTTO col
 * credito MyCity (nessun bonifico, quindi nessun segno «bonifico:»). Il negozio approva
 * 20 € di rimborso, il credito esce, la scrittura dell'esito sul reso cade (500). Poi il
 * negozio segue i passi normali: «merce ricevuta» e «rimborsato» con 20 €.
 * Atteso: l'ordine conta 20 € rimborsati e al negozio si tolgono 18 € una volta sola.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia', esitoDelResoCade: false, suStripe: [] as Array<{ id: string; amount: number; status: string; metadata: Record<string, string>; chiave: string }>, storni: [] as Array<{ amount: number; chiave: string }> }));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const vero = finto.db.client;
    return {
      ...vero,
      rpc: vero.rpc,
      from: (t: string) => {
        const q = vero.from(t) as unknown as { update: (v: Record<string, unknown>) => unknown };
        if (t === 'returns' && finto.esitoDelResoCade) {
          const update = q.update.bind(q);
          (q as { update: (v: Record<string, unknown>) => unknown }).update = (v: Record<string, unknown>) => {
            if ('refund_id' in v) {
              finto.esitoDelResoCade = false;
              const catena: Record<string, unknown> = {};
              catena.eq = () => catena;
              catena.select = () => catena;
              catena.then = (ok: (x: unknown) => unknown) => ok({ data: null, error: { code: '57014', message: 'timeout' } });
              return catena;
            }
            return update(v);
          };
        }
        return q;
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: vi.fn(async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = finto.suStripe.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { ...gia };
        const nuovo = { id: `re_${finto.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: p.metadata ?? {}, chiave: o.idempotencyKey };
        finto.suStripe.push(nuovo);
        return { ...nuovo };
      }),
      list: vi.fn(async () => ({ data: [...finto.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false })),
    },
    transfers: {
      createReversal: vi.fn(async (_t: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        if (!finto.storni.some((x) => x.chiave === o.idempotencyKey)) finto.storni.push({ amount: p.amount, chiave: o.idempotencyKey });
        return { id: `trr_${o.idempotencyKey}` };
      }),
      listReversals: vi.fn(async () => ({ data: [] })),
    },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = 'a1b2c3d4-1111-4111-8111-111111111111';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

function soloCredito(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 0, gross_total_cents: 4000, wallet_applied_cents: 4000,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(),
    internal_dispute_status: null,
  };
}

async function negozio(rotta: unknown, id: string, corpo: unknown) {
  finto.utente = 'negozio';
  const res = await (rotta as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });
  return { status: res.status, corpo: await res.json() };
}

describe('reso col credito ripreso dopo un guasto', () => {
  it('ordine pagato col credito: il rimborso parziale si conta una volta e al negozio la quota si toglie una volta', async () => {
    finto.db = creaFintoDatabase({
      orders: [soloCredito()],
      returns: [{
        id: 'r1', status: 'REQUESTED', order_id: ORDINE, buyer_id: 'giulia', seller_id: 'negozio',
        reason: 'DAMAGED', refund_amount_cents: null, refund_id: null, order_item_id: null,
        created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null,
      }],
      order_items: [],
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
      notifications: [],
    });
    finto.esitoDelResoCade = true;
    const d = await negozio(decidi, 'r1', { decision: 'APPROVED', refundAmountCents: 2000 });
    const o = finto.db.tabelle.orders[0];
    const dopoDecide = { http: d.status, reso: finto.db.tabelle.returns[0].status, rimborsato: o.refunded_amount_cents, ripreso: o.seller_payout_reversed_cents, credito: creditoDi(finto.db, 'giulia') };
    const r1 = await negozio(avanza, 'r1', { stato: 'RECEIVED' });
    const r2 = await negozio(avanza, 'r1', { stato: 'REFUNDED', refundAmountCents: 2000 });
    const dopoAvanza = { http: [r1.status, r2.status], reso: finto.db.tabelle.returns[0].status, rimborsato: o.refunded_amount_cents, ripreso: o.seller_payout_reversed_cents, credito: creditoDi(finto.db, 'giulia'), pagamento: o.payment_status };
    console.log(JSON.stringify({ dopoDecide, dopoAvanza }));
    expect(dopoDecide.http).toBe(500);
    expect(dopoAvanza.credito).toBe(2000);
    expect(dopoAvanza.rimborsato, 'rimborsato sull ordine diverso dal credito uscito').toBe(2000);
    expect(dopoAvanza.ripreso, 'quota del negozio tolta due volte').toBe(1800);
  });
  it('ordine misto 30 contanti + 20 credito: il rimborso parziale si conta una volta e al negozio la quota si toglie una volta', async () => {
    finto.db = creaFintoDatabase({
      orders: [{ ...soloCredito(), total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000, seller_payout_cents: 4500 }],
      returns: [{
        id: 'r1', status: 'REQUESTED', order_id: ORDINE, buyer_id: 'giulia', seller_id: 'negozio',
        reason: 'DAMAGED', refund_amount_cents: null, refund_id: null, order_item_id: null,
        created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null,
      }],
      order_items: [],
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
      notifications: [],
    });
    finto.esitoDelResoCade = true;
    const d = await negozio(decidi, 'r1', { decision: 'APPROVED', refundAmountCents: 2000 });
    const o = finto.db.tabelle.orders[0];
    const dopoDecide = { http: d.status, reso: finto.db.tabelle.returns[0].status, rimborsato: o.refunded_amount_cents, ripreso: o.seller_payout_reversed_cents, credito: creditoDi(finto.db, 'giulia') };
    const r1 = await negozio(avanza, 'r1', { stato: 'RECEIVED' });
    const r2 = await negozio(avanza, 'r1', { stato: 'REFUNDED', refundAmountCents: 2000 });
    const dopoAvanza = { http: [r1.status, r2.status], reso: finto.db.tabelle.returns[0].status, rimborsato: o.refunded_amount_cents, ripreso: o.seller_payout_reversed_cents, credito: creditoDi(finto.db, 'giulia'), pagamento: o.payment_status };
    console.log(JSON.stringify({ dopoDecide, dopoAvanza }));
    expect(dopoDecide.http).toBe(500);
    
    expect(dopoAvanza.rimborsato, 'rimborsato sull ordine diverso dal credito uscito').toBe(2000);
    expect(dopoAvanza.ripreso, 'quota del negozio tolta due volte').toBe(Math.round(2000 * 4500 / 5000));
  });
  it('carta 40 €, bonifico al negozio partito: decide 20 € con l esito che cade, poi ricevuto e rimborsato', async () => {
    finto.suStripe = []; finto.storni = [];
    finto.db = creaFintoDatabase({
      orders: [{ ...soloCredito(), payment_method: 'card', total_price: 40, wallet_applied_cents: 0, payout_status: 'TRANSFERRED', stripe_payment_intent: 'pi_1', stripe_transfer_id: 'tr_1', cash_confirmed_at: null }],
      returns: [{
        id: 'r1', status: 'REQUESTED', order_id: ORDINE, buyer_id: 'giulia', seller_id: 'negozio',
        reason: 'DAMAGED', refund_amount_cents: null, refund_id: null, order_item_id: null,
        created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null,
      }],
      order_items: [],
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
      notifications: [],
    });
    finto.esitoDelResoCade = true;
    const d = await negozio(decidi, 'r1', { decision: 'APPROVED', refundAmountCents: 2000 });
    const r1 = await negozio(avanza, 'r1', { stato: 'RECEIVED' });
    const r2 = await negozio(avanza, 'r1', { stato: 'REFUNDED', refundAmountCents: 2000 });
    const o = finto.db.tabelle.orders[0];
    console.log('CARTA', JSON.stringify({ http: [d.status, r1.status, r2.status], rimborsi: finto.suStripe.map((r) => r.amount), storni: finto.storni.map((x) => x.amount), rimborsato: o.refunded_amount_cents, reso: finto.db.tabelle.returns[0].status }));
    expect(d.status).toBe(500);
    expect(finto.suStripe.map((r) => r.amount)).toEqual([2000]);
    expect(finto.storni.reduce((t, x) => t + x.amount, 0)).toBe(1800);
    expect(o.refunded_amount_cents).toBe(2000);
  });
  // Importi sotto i 10 € e sopra i 30 €, credito che copre tutto l'ordine, e il doppio tocco su «rimborsato».
  for (const [lordo, reso] of [[1000, 800], [5000, 3500]] as const) {
    it(`solo credito, ${lordo / 100} € e reso da ${reso / 100} €: contato una volta anche col doppio tocco`, async () => {
      const netto = Math.round(lordo * 0.9);
      finto.db = creaFintoDatabase({
        orders: [{ ...soloCredito(), gross_total_cents: lordo, wallet_applied_cents: lordo, seller_payout_cents: netto }],
        returns: [{
          id: 'r1', status: 'REQUESTED', order_id: ORDINE, buyer_id: 'giulia', seller_id: 'negozio',
          reason: 'DAMAGED', refund_amount_cents: null, refund_id: null, order_item_id: null,
          created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null,
        }],
        order_items: [],
        profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
        notifications: [],
      });
      finto.esitoDelResoCade = true;
      const d = await negozio(decidi, 'r1', { decision: 'APPROVED', refundAmountCents: reso });
      expect(d.status).toBe(500);
      await negozio(avanza, 'r1', { stato: 'RECEIVED' });
      await Promise.allSettled([
        negozio(avanza, 'r1', { stato: 'REFUNDED', refundAmountCents: reso }),
        negozio(avanza, 'r1', { stato: 'REFUNDED', refundAmountCents: reso }),
      ]);
      const o = finto.db.tabelle.orders[0];
      expect(creditoDi(finto.db, 'giulia')).toBe(reso);
      expect(o.refunded_amount_cents).toBe(reso);
      expect(o.seller_payout_reversed_cents).toBe(Math.round((reso * netto) / lordo));
    });
  }

  it('due negozi, due resi col credito: ognuno si conta una volta sul suo ordine', async () => {
    const SECONDO = 'b2c3d4e5-2222-4222-8222-222222222222';
    const reso = (id: string, ordine: string) => ({
      id, status: 'REQUESTED', order_id: ordine, buyer_id: 'giulia', seller_id: 'negozio',
      reason: 'DAMAGED', refund_amount_cents: null, refund_id: null, order_item_id: null,
      created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null,
    });
    finto.db = creaFintoDatabase({
      orders: [soloCredito(), { ...soloCredito(), id: SECONDO, gross_total_cents: 2500, wallet_applied_cents: 2500, seller_payout_cents: 2250 }],
      returns: [reso('r1', ORDINE), reso('r2', SECONDO)],
      order_items: [],
      profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }],
      notifications: [],
    });
    finto.esitoDelResoCade = true;
    await negozio(decidi, 'r1', { decision: 'APPROVED', refundAmountCents: 2000 });
    await negozio(avanza, 'r1', { stato: 'RECEIVED' });
    await negozio(avanza, 'r1', { stato: 'REFUNDED', refundAmountCents: 2000 });
    const d2 = await negozio(decidi, 'r2', { decision: 'APPROVED', refundAmountCents: 2500 });
    expect(d2.status).toBe(200);
    const [o1, o2] = finto.db.tabelle.orders;
    expect(creditoDi(finto.db, 'giulia')).toBe(4500);
    expect(o1.refunded_amount_cents).toBe(2000);
    expect(o2.refunded_amount_cents).toBe(2500);
    expect(o1.seller_payout_reversed_cents).toBe(1800);
    expect(o2.seller_payout_reversed_cents).toBe(2250);
  });
});
