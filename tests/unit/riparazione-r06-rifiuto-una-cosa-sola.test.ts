import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R06 — Col doppio tocco su «Rifiuta ordine» partivano due richieste che leggevano tutte e due
 * l'ordine NEW. La prima annullava; la seconda riceveva GIA_ANNULLATO da `annullaERimborsa` e la
 * rotta rispondeva 500 «Rifiuto fallito», cioè un avviso rosso accanto a quello verde. Adesso è il
 * 409 «Ordine già annullato» del controllo iniziale. E l'aiuto dei negozi non dice più che il
 * motivo è obbligatorio.
 *
 * Finti di involucro, logger, Stripe e database sul modello di
 * tests/unit/il-rifiuto-del-negozio-restituisce-i-soldi.test.ts.
 */

const FAKE_SELLER = { id: 'seller-1' };

const stato: {
  ordine: Record<string, unknown> | null;
  righeAnnullate: Array<{ id: string }>;
  notifiche: Array<Record<string, unknown>>;
} = { ordine: null, righeAnnullate: [], notifiche: [] };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: typeof FAKE_SELLER; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: FAKE_SELLER, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 're_1', reversedCents: 0 })) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'orders') {
        // L'UPDATE di annullaERimborsa: .update().eq().neq().eq().select() → le righe prese davvero.
        const scrittura: Record<string, unknown> = {};
        scrittura.eq = () => scrittura;
        scrittura.neq = () => scrittura;
        scrittura.select = async () => ({ data: stato.righeAnnullate, error: null });
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stato.ordine, error: null }) }) }),
          update: () => scrittura,
        };
      }
      return {
        insert: async (righe: Array<Record<string, unknown>>) => {
          stato.notifiche.push(...righe);
          return { error: null };
        },
      };
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

import { POST } from '@/app/api/seller/orders/[id]/reject/route';
import { TOPICS } from '@/app/seller/help/domande';

function ordineInContanti(p: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'o1',
    user_id: 'buyer-1',
    seller_id: 'seller-1',
    total_price: 18,
    payment_method: 'cod',
    payment_status: 'PENDING',
    delivery_status: 'NEW',
    stripe_payment_intent: null,
    wallet_applied_cents: 0,
    cash_confirmed_at: null,
    refunded_amount_cents: 0,
    coupon_code: null,
    rider_id: null,
    ...p,
  };
}

function chiama() {
  const req = new Request('http://localhost/api/seller/orders/o1/reject', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: null }),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'o1' }) });
}

beforeEach(() => {
  stato.ordine = ordineInContanti();
  stato.righeAnnullate = [{ id: 'o1' }];
  stato.notifiche = [];
});

describe('la seconda richiesta del doppio tocco', () => {
  it('ha letto NEW ma l ordine l ha già annullato la prima: 409 «Ordine già annullato», non 500', async () => {
    stato.righeAnnullate = []; // la scrittura condizionata non prende nessuna riga
    const res = await chiama();
    expect(res.status).toBe(409);
    const corpo = (await res.json()) as { error?: { message?: string } };
    expect(corpo.error?.message).toBe('Ordine già annullato');
    expect(stato.notifiche, 'la seconda richiesta non avvisa di nuovo il cliente').toEqual([]);
  });

  it('la prima richiesta resta un rifiuto riuscito', async () => {
    const res = await chiama();
    expect(res.status).toBe(200);
    expect(stato.notifiche.filter((n) => n.user_id === 'buyer-1')).toHaveLength(1);
  });
});

describe('l aiuto dei negozi sul rifiuto', () => {
  const risposta = TOPICS.flatMap((t) => t.items).find((i) => i.q === 'Posso rifiutare un ordine?')?.a ?? '';

  it('il motivo è facoltativo, come nel riquadro del rifiuto', () => {
    expect(risposta).not.toMatch(/Fornisci sempre un motivo/);
    expect(risposta).toMatch(/motivo è facoltativo/);
  });

  it('il rimborso lo promette solo a chi ha pagato con carta', () => {
    expect(risposta).not.toMatch(/riceve rimborso automatico/);
    expect(risposta).toMatch(/pagato con carta gli torna/);
  });
});
