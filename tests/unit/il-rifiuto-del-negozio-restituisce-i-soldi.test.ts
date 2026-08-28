import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * IL NEGOZIO RIFIUTA, E I SOLDI TORNANO AL CLIENTE (radiografia 27/8/2026).
 *
 * Il pulsante «Rifiuta» del negoziante chiamava `seller_reject_order` del
 * database: ordine in CANCELED, merce a magazzino, credito e codice sconto
 * restituiti. Del denaro sulla carta non si occupava nessuno — dal database non
 * si può, le chiavi di Stripe stanno sul server. Al cliente arrivava intanto un
 * messaggio che diceva «Niente addebiti», mentre l'addebito restava dov'era.
 *
 * Nessun lavoro periodico ripescava il caso: `release-payouts` cerca DELIVERED,
 * `expire-stale-orders` cerca NEW, nessuno cerca CANCELED+PAID.
 *
 * Questa prova percorre la rotta vera del rifiuto e guarda una cosa sola: è
 * stato chiesto il rimborso, e per l'importo giusto?
 */

const FAKE_SELLER = { id: 'seller-1' };

type Ordine = Record<string, unknown>;

const stato: {
  ordine: Ordine | null;
  rpc: Array<{ name: string; args: Record<string, unknown> }>;
  notifiche: Array<Record<string, unknown>>;
} = { ordine: null, rpc: [], notifiche: [] };

const refundOrderMock = vi.fn(async (_o: { orderId: string; amountCents: number }) => ({ refundId: 're_1', reversedCents: 0 }));

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (_opts: unknown, handler: (ctx: { user: typeof FAKE_SELLER }) => unknown) =>
    (_req: Request) =>
      handler({ user: FAKE_SELLER }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (o: unknown) => refundOrderMock(o as { orderId: string; amountCents: number }) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.ordine, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return {
        insert: async (righe: Array<Record<string, unknown>>) => {
          stato.notifiche.push(...righe);
          return { error: null };
        },
      };
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      stato.rpc.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

import { POST } from '@/app/api/seller/orders/[id]/reject/route';

function ordineCarta(p: Ordine = {}): Ordine {
  return {
    id: 'o1',
    user_id: 'buyer-1',
    seller_id: 'seller-1',
    total_price: 24,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'NEW',
    stripe_payment_intent: 'pi_1',
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: null,
    rider_id: null,
    ...p,
  };
}

function chiama(body: unknown = {}) {
  const req = new Request('http://localhost/api/seller/orders/o1/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'o1' }) });
}

beforeEach(() => {
  stato.ordine = ordineCarta();
  stato.rpc = [];
  stato.notifiche = [];
  refundOrderMock.mockClear();
  refundOrderMock.mockResolvedValue({ refundId: 're_1', reversedCents: 0 });
});

describe('rifiuto del negozio su un ordine pagato con carta', () => {
  it('chiede il rimborso una volta sola, per il totale pagato', async () => {
    const res = await chiama({ reason: 'Focacce finite' });

    expect(res.status).toBe(200);
    expect(refundOrderMock, 'nessun rimborso chiesto: i 24 € restano a MyCity').toHaveBeenCalledTimes(1);
    expect(refundOrderMock.mock.calls[0][0]).toMatchObject({ orderId: 'o1', amountCents: 2400 });
  });

  it('al cliente non dice più «niente addebiti» quando invece era stato addebitato', async () => {
    await chiama();
    const alCliente = stato.notifiche.find((n) => n.user_id === 'buyer-1');
    expect(alCliente, 'il cliente non riceve nessun avviso').toBeDefined();
    expect(String(alCliente?.body)).toContain('rimborsato');
    expect(String(alCliente?.body)).not.toContain('Niente addebiti');
  });

  it('se il rimborso fallisce l ordine NON risulta rifiutato', async () => {
    refundOrderMock.mockRejectedValueOnce(new Error('carta scaduta'));
    const res = await chiama();
    expect(res.status).toBe(502);
    expect(stato.notifiche, 'al cliente è stato detto che è annullato mentre i soldi sono ancora nostri').toEqual([]);
  });

  it('restituisce anche il credito MyCity speso, che il rimborso sulla carta non copre', async () => {
    stato.ordine = ordineCarta({ wallet_applied_cents: 500 });
    await chiama();
    const credito = stato.rpc.find((c) => c.name === 'wallet_credit');
    expect(credito, 'il credito speso non è stato restituito').toBeDefined();
    expect(credito?.args).toMatchObject({ p_user: 'buyer-1', p_cents: 500 });
  });

  it('libera il codice sconto di chi non ha comprato niente', async () => {
    stato.ordine = ordineCarta({ coupon_code: 'BENVENUTO10' });
    await chiama();
    expect(stato.rpc.some((c) => c.name === 'release_coupon' && c.args.p_code === 'BENVENUTO10')).toBe(true);
  });
});

describe('le regole di chi può rifiutare restano quelle del database', () => {
  it('un negozio non può rifiutare l ordine di un altro negozio', async () => {
    stato.ordine = ordineCarta({ seller_id: 'seller-2' });
    const res = await chiama();
    expect(res.status).toBe(404);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('a consegna partita non si rifiuta più', async () => {
    stato.ordine = ordineCarta({ delivery_status: 'READY' });
    const res = await chiama();
    expect(res.status).toBe(409);
    expect(refundOrderMock).not.toHaveBeenCalled();
  });

  it('un ordine in contanti già incassato non si annulla in silenzio', async () => {
    stato.ordine = ordineCarta({
      payment_method: 'cod',
      payment_status: 'PENDING',
      stripe_payment_intent: null,
      cash_confirmed_at: '2026-08-28T10:00:00Z',
    });
    const res = await chiama();
    expect(res.status).toBe(409);
  });
});
