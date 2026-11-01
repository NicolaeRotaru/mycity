import { describe, it, expect, vi } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi } from './aiuti/finto-database-dei-rimborsi';

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, diarioMutoDopoAccredito: false }));
vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const vero = finto.db.client;
    return {
      ...vero,
      from: vero.from,
      rpc: async (nome: string, args?: Record<string, unknown>) => {
        const r = await vero.rpc(nome, args);
        if (nome === 'wallet_credit' && finto.diarioMutoDopoAccredito) { finto.diarioMutoDopoAccredito = false; finto.db.guasti.diarioIlleggibile = 1; }
        return r;
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_x' })), list: vi.fn(async () => ({ data: [], has_more: false })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })), listReversals: vi.fn(async () => ({ data: [] })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type G = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const con = (handler: G) => async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
    handler({ user: { id: 'negozio' }, req, params: (await ctx?.params) ?? {} });
  return { withAuthRateLimit: (_o: unknown, h: G) => con(h), withAdminAuth: con };
});
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';

const O = 'a1b2c3d4-1111-4111-8111-111111111111';
const reso = (id: string): Riga => ({ id, status: 'REQUESTED', order_id: O, buyer_id: 'giulia', seller_id: 'negozio', reason: 'DAMAGED', refund_amount_cents: null, refund_id: null, order_item_id: null, created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null });
async function decide(id: string, cents: number) {
  const res = await (decidi as unknown as (r: Request, c: unknown) => Promise<Response>)(
    new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'APPROVED', refundAmountCents: cents }) }),
    { params: Promise.resolve({ id }) });
  return res.status;
}
describe('rotta vera: due resi sullo stesso ordine pagato col credito', () => {
  it('il secondo reso, guasto doppio e poi ri-deciso, si conta sull ordine', async () => {
    finto.db = creaFintoDatabase({
      orders: [{ id: O, user_id: 'giulia', seller_id: 'negozio', total_price: 0, gross_total_cents: 4000, wallet_applied_cents: 4000, seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE', stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null, refunded_amount_cents: 0, payment_method: 'cod', rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: 0, shipping_cost: 0, delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(), created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), payment_status: 'PAID', cash_confirmed_at: new Date(Date.now() - 86_400_000).toISOString(), internal_dispute_status: null }],
      returns: [reso('r0'), reso('r1')], order_items: [], profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }], notifications: [],
    });
    const a = await decide('r0', 2000);
    finto.db.guasti.walletCreditaPoiCade = true; finto.diarioMutoDopoAccredito = true;
    const b = await decide('r1', 2000);
    const statoR1 = finto.db.tabelle.returns[1].status;
    const c = await decide('r1', 2000);
    const o = finto.db.tabelle.orders[0];
    console.log('ROTTA', JSON.stringify({ http: [a, b, c], statoR1DopoGuasto: statoR1, resi: finto.db.tabelle.returns.map((r) => r.status), credito: creditoDi(finto.db, 'giulia'), rimborsato: o.refunded_amount_cents, ripreso: o.seller_payout_reversed_cents, pagamento: o.payment_status, avvisi: (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin-1').map((n) => n.title) }));
    expect(creditoDi(finto.db, 'giulia')).toBe(4000);
    expect(o.refunded_amount_cents).toBe(4000);
    expect(o.seller_payout_reversed_cents).toBe(3600);
    expect(o.payment_status).toBe('REFUNDED');
  });
});
