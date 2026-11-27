import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * R03-002 (giro 2) — Il rimborso fatto dal cruscotto di Stripe: se Resend rifiuta l'email «Rimborso
 * emesso», il messaggio entra in coda per l'account del cliente e il giro send-emails lo rimanda.
 *
 * La prova passa dal webhook vero (handleChargeRefunded) e dal `sendEmail` vero: Resend è finto e
 * rifiuta (quota superata). L'indirizzo a cui va l'email è quello dell'account (getUserById).
 */

const st = vi.hoisted(() => ({
  ordini: [] as Array<Record<string, unknown>>,
  coda: [] as Array<Record<string, unknown>>,
  tentati: [] as string[],
}));

vi.mock('resend', () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string }) => {
        st.tentati.push(String(payload.to));
        return { data: null, error: { name: 'daily_quota_exceeded', message: 'You have reached your daily email quota' } };
      },
    };
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
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
    from: (t: string) => {
      if (t === 'email_queue') return { insert: async (riga: Record<string, unknown>) => (st.coda.push(riga), { error: null }) };
      return t === 'orders' ? catena(() => ({ data: st.ordini.map((o) => ({ ...o })), error: null })) : catena(() => ({ data: [], error: null }));
    },
    rpc: async () => ({ data: null, error: null }),
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: id === 'maria' ? 'maria@esempio.it' : null } }, error: null }) } },
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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-27T10:00:00Z'));
  st.coda.length = 0;
  st.tentati.length = 0;
  vi.stubEnv('RESEND_API_KEY', 're_prova');
  vi.stubEnv('RESEND_FROM', 'MyCity <ordini@mycity.example>');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mycity.example');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('R03-002 (giro 2) — rimborso dal cruscotto: l email rifiutata entra in coda per il cliente', () => {
  it('Resend rifiuta «Rimborso emesso»: una riga in email_queue con user_id del cliente', async () => {
    st.ordini = [ordine()];
    await handleChargeRefunded(carica);
    expect(st.tentati, 'il webhook non ha provato a spedire al cliente').toContain('maria@esempio.it');
    expect(st.coda, 'l email di rimborso rifiutata non e entrata in coda: nessuno la rimanda').toHaveLength(1);
    expect(st.coda[0].user_id).toBe('maria');
    expect(st.coda[0].template).toBe('posta_rimandata');
    expect(typeof (st.coda[0].metadata as Record<string, unknown>).html).toBe('string');
  });
});
