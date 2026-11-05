import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — 61: un rimborso pieno con la carta fatto dal sito non manda due email
 * «Rimborso emesso» (una da refundOrder, una dal webhook charge.refunded).
 * Un rimborso dal cruscotto Stripe la manda, con la parte non ancora scritta.
 */
const st = vi.hoisted(() => ({ ordini: [] as Array<Record<string, unknown>>, email: [] as Array<Record<string, unknown>>, rpc: [] as string[] }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async (m: Record<string, unknown>) => (st.email.push(m), { ok: true })) }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({ refunds: { list: async () => ({ data: [] }) } }) }));
vi.mock('@/lib/stripe/payout', async (o) => ({
  ...((await o()) as object),
  reverseOrderTransfer: async () => ({ reversalId: null, reversedCents: 0 }),
  reverseRiderTransfer: async () => ({ reversalId: null, reversedCents: 0 }),
}));
vi.mock('@/lib/stripe/webhook/comune', async (o) => ({ ...((await o()) as object), notifyAdmins: vi.fn(async () => 'scritto') }));

function catena(risultato: () => unknown): unknown {
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato()).then(ok, ko);
      if (typeof k === 'symbol') return undefined;
      return () => c;
    },
  });
  return c;
}
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => (t === 'orders' ? catena(() => ({ data: st.ordini.map((o) => ({ ...o })), error: null })) : catena(() => ({ data: [], error: null }))),
    rpc: async (nome: string) => (st.rpc.push(nome), { data: null, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'maria@esempio.it' } }, error: null }) } },
  }),
}));

import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';

const ordine = (extra: Record<string, unknown> = {}) => ({
  id: 'o1', user_id: 'maria', total_price: 18, refunded_amount_cents: 0, stripe_refund_id: null, internal_dispute_status: null,
  seller_id: 'forno', payout_status: 'HELD', payment_status: 'PAID', delivery_status: 'NEW', coupon_code: null,
  stripe_transfer_id: null, seller_payout_cents: 1500, seller_payout_reversed_cents: 0, stripe_reversal_id: null, reversal_error: null,
  rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: 300, shipping_cost: 0,
  ...extra,
});
const carica = { id: 'ch_1', payment_intent: 'pi_1', amount: 1800, amount_refunded: 1800, refunded: true, refunds: { data: [{ id: 're_1', reason: null }] } } as never;

beforeEach(() => {
  st.email = [];
  st.rpc = [];
});

describe('61 — una sola email «Rimborso emesso»', () => {
  it('eco di un rimborso del sito (ordine già REFUNDED e scritto): nessuna email dal webhook', async () => {
    st.ordini = [ordine({ payment_status: 'REFUNDED', refunded_amount_cents: 1800, delivery_status: 'CANCELED' })];
    await handleChargeRefunded(carica);
    expect(st.email).toHaveLength(0);
  });
  it('rimborso dal cruscotto: l email parte, con la parte non scritta', async () => {
    st.ordini = [ordine()];
    await handleChargeRefunded(carica);
    expect(st.email).toHaveLength(1);
    expect(String(st.email[0].text)).toMatch(/18[,.]00/);
  });
});

import { decidiRimessaAScaffale } from '@/lib/ordini/rimessa-a-scaffale';

describe('58 — la merce che il cliente ha già in casa non torna in vendita', () => {
  it('rimborso pieno dal cruscotto su un ordine consegnato: niente restore_stock_for_order', async () => {
    st.ordini = [ordine({ delivery_status: 'DELIVERED' })];
    await handleChargeRefunded(carica);
    expect(st.rpc).not.toContain('restore_stock_for_order');
  });
  it('controprova: ordine non ancora consegnato, la merce torna', async () => {
    st.ordini = [ordine()];
    await handleChargeRefunded(carica);
    expect(st.rpc).toContain('restore_stock_for_order');
  });
  it('la regola: consegnato e chiuso dal rimborso → non si rimette, salvo merce tornata col reso', () => {
    const ordineConsegnato = { delivery_status: 'DELIVERED' } as never;
    expect(decidiRimessaAScaffale({ ordineDaChiudere: true, ordine: ordineConsegnato, giaRimborsatoPrimaCents: 0 })).toMatchObject({ rimetti: false });
    expect(decidiRimessaAScaffale({ ordineDaChiudere: true, ordine: ordineConsegnato, giaRimborsatoPrimaCents: 0, merceTornata: true })).toEqual({ rimetti: true });
  });
});
