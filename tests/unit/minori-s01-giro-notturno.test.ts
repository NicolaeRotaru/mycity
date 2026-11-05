import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — 1908: nel giro notturno, se lo storno del credito MyCity cade, l'email
 * di annullo non scrive «il credito ti è stato restituito».
 * (banco preso da chi-paga-alla-consegna-sa-che-l-ordine-e-annullato)
 */

let invio: (m: Record<string, unknown>) => Promise<unknown>;
const spedite: Array<Record<string, unknown>> = [];

vi.mock('@/lib/email/client', () => ({
  sendEmail: (m: Record<string, unknown>) => invio(m),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/api/middleware', () => ({
  withCronAuth: (h: (req: unknown) => unknown) => (req: unknown) => h(req),
}));
const refundOrderMock = vi.fn(async (_a: unknown) => ({ refundId: 're_1', reversedCents: 0 }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (a: unknown) => refundOrderMock(a) }));

/** Una catena di query qualunque che finisce sempre con lo stesso risultato. */
function catena(risultato: unknown): unknown {
  const c: unknown = new Proxy({}, {
    get(_b, k) {
      if (k === 'then') {
        return (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(risultato).then(ok, ko);
      }
      if (typeof k === 'symbol') return undefined;
      return () => c;
    },
  });
  return c;
}

const auth = {
  admin: {
    getUserById: async (id: string) => ({ data: { user: { id, email: 'maria@example.it' } }, error: null }),
  },
};

const stato = { candidati: [] as Array<Record<string, unknown>>, creditoCade: false };
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'orders') {
        return {
          select: () => catena({ data: stato.candidati, error: null }),
          update: () => catena({ data: [{ id: 'o1' }], error: null }),
        };
      }
      if (t === 'notifications') return { insert: async () => ({ error: null }) };
      return { select: () => catena({ data: [], error: null }) };
    },
    rpc: async (nome: string) =>
      nome === 'wallet_credit' && stato.creditoCade ? { data: null, error: { message: 'timeout' } } : { data: null, error: null },
    auth,
  }),
}));

const ordineInContanti = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  user_id: 'u1',
  seller_id: 's1',
  total_price: 12,
  payment_method: 'cod',
  payment_status: 'PENDING',
  delivery_status: 'NEW',
  wallet_applied_cents: 0,
  cash_confirmed_at: null,
  coupon_code: null,
  stripe_payment_intent: null,
};

beforeEach(() => {
  spedite.length = 0;
  invio = async (m) => { spedite.push(m); return { ok: true, id: 'm1' }; };
  stato.candidati = [];
  stato.creditoCade = false;
  refundOrderMock.mockClear();
  process.env.NEXT_PUBLIC_APP_URL = 'https://mycity.example';
});


async function giro() {
  const { POST } = await import('@/app/api/cron/expire-stale-orders/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://x', { method: 'POST' }));
  return res.json();
}

describe('1908 — l email del giro notturno dice il credito solo se è tornato davvero', () => {
  it('storno del credito caduto: niente «ti è stato restituito»', async () => {
    stato.creditoCade = true;
    stato.candidati = [{ ...ordineInContanti, id: 'o1', total_price: 8, wallet_applied_cents: 400 }];
    await giro();
    expect(spedite).toHaveLength(1);
    expect(String(spedite[0].text)).not.toMatch(/ti è stato restituito/);
  });
  it('controprova: storno riuscito, la riga del credito c è', async () => {
    stato.candidati = [{ ...ordineInContanti, id: 'o1', total_price: 8, wallet_applied_cents: 400 }];
    await giro();
    expect(String(spedite[0].text)).toMatch(/ti è stato restituito/);
  });
});
