import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R03-005 — Dopo un guasto, chiudere il reso con i passi normali non registra due volte lo
 * stesso rimborso.
 *
 * Ordine in contanti da 40 € pagato col credito MyCity. Il negozio approva un rimborso
 * parziale di 20 €: il credito esce, ma la scrittura dell'esito sul reso cade, la rotta
 * risponde 500 e il reso resta APPROVED. Il negozio fa i passi normali, «merce ricevuta» e
 * «rimborsato», e avanza ripropone 20 € con la stessa chiave `return_<id>`.
 *
 * Prima: l'ordine diceva 40 € rimborsati e REFUNDED (la cliente ne aveva ricevuti 20) e al
 * negozio si toglievano 36 € invece di 18. Ora il secondo giro riconosce che il rimborso di
 * quella chiave è già uscito ED è già contato sull'ordine, e lo registra sul reso senza rifarlo.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'giulia', resoCade: false }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_1' })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
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

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = 'a1b2c3d4-5555-4555-8555-555555555555';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** 40 € tutti col credito MyCity, ordine in contanti consegnato. */
function coiCrediti(id: string): Riga {
  return {
    id, user_id: 'giulia', seller_id: 'negozio',
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
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
  };
}

/** La scrittura dell'esito del rimborso sul reso (quella con `refund_id`) va in timeout. */
function laScritturaDelResoCade(db: FintoDatabase) {
  const from = db.client.from.bind(db.client) as unknown as (t: string) => Record<string, unknown>;
  (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t);
    if (t !== 'returns') return q;
    return new Proxy(q, {
      get(obj, prop, recv) {
        if (prop !== 'update') return Reflect.get(obj, prop, recv);
        const update = (Reflect.get(obj, prop, recv) as (p: Record<string, unknown>) => unknown).bind(obj);
        return (p: Record<string, unknown>) => {
          if (finto.resoCade && 'refund_id' in p) {
            finto.resoCade = false;
            const catena: Record<string, unknown> = {};
            catena.eq = () => catena;
            catena.select = async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
            return catena;
          }
          return update(p);
        };
      },
    });
  };
}

beforeEach(() => {
  finto.utente = 'giulia';
  finto.resoCade = false;
  finto.db = creaFintoDatabase({
    orders: [coiCrediti(ORDINE)],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = 'giulia.bianchi@example.it';
  laScritturaDelResoCade(finto.db);
});

describe('R03-005 — il reso ripreso dopo un guasto non registra due volte lo stesso rimborso', () => {
  it('rimborso parziale di 20 €: dopo decide (500) e avanza, l ordine dice 20 € e al negozio si tolgono 18 €', async () => {
    const aperto = await (apriReso as unknown as Rotta)(
      new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED', description: 'Arrivato rotto, la scatola era schiacciata' })),
      undefined,
    );
    expect(aperto.status).toBe(201);
    const id = (await aperto.json()).id as string;

    finto.utente = 'negozio';
    finto.resoCade = true;
    const deciso = await (decidi as unknown as Rotta)(
      new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: 2000 })),
      { params: Promise.resolve({ id }) },
    );
    expect(deciso.status).toBe(500);
    const dopoDecide = finto.db.tabelle.orders[0];
    expect(Number(dopoDecide.refunded_amount_cents)).toBe(2000);
    expect(Number(dopoDecide.seller_payout_reversed_cents)).toBe(1800);

    for (const stato of ['RECEIVED', 'REFUNDED'] as const) {
      const r = await (avanza as unknown as Rotta)(new Request('http://localhost/x', json({ stato })), { params: Promise.resolve({ id }) });
      expect(r.status, `avanza ${stato}`).toBe(200);
    }

    const ordine = finto.db.tabelle.orders[0];
    expect(Number(ordine.refunded_amount_cents), 'rimborsato sull ordine diverso dal credito uscito').toBe(2000);
    expect(Number(ordine.seller_payout_reversed_cents), 'al negozio la quota è stata tolta due volte').toBe(1800);
    expect(ordine.payment_status).not.toBe('REFUNDED');
    const crediti = finto.db.diarioCredito.filter((r) => r.ref.includes(id));
    expect(crediti.reduce((s, r) => s + r.cents, 0), 'il credito esce una volta sola').toBe(2000);
    expect(finto.db.tabelle.returns[0].status).toBe('REFUNDED');
  }, 60000);
});
