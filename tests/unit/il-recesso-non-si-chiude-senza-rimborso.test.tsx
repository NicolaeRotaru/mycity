import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * IL RECESSO NON SI CHIUDE «SENZA RIMBORSO».
 *
 * 31/10/2026 — Il ripensamento entro 14 giorni (CHANGED_MIND) e' il recesso del consumatore
 * (Cod. Cons. artt. 52, 56 e 57): il negozio non puo' dire di no e, tornata la merce, deve
 * rimborsare. La rotta `decide` bloccava il «Rifiuta», ma la rotta `avanza` accettava
 * «chiudi senza rimborso» da ogni stato aperto, anche con la merce gia' in negozio: lo stesso
 * rifiuto per un'altra porta, e il giro dei bonifici pagava il negozio subito dopo.
 *
 * Qui si chiama la rotta vera e si disegna la card vera del negozio.
 */

const VENDITORE = { id: 'seller-1' };
const GIORNO = 24 * 60 * 60 * 1000;
const fa = (giorni: number) => new Date(Date.now() - giorni * GIORNO).toISOString();

const stato: {
  reso: Record<string, unknown>;
  ordine: Record<string, unknown>;
  scritture: Array<{ patch: Record<string, unknown>; daStato: string | null }>;
} = { reso: {}, ordine: {}, scritture: [] };

vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit:
    (
      _opts: unknown,
      handler: (ctx: { user: typeof VENDITORE; params: Record<string, string>; req: Request }) => unknown,
    ) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: VENDITORE, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn(async () => ({ refundId: 'rf_1', reversedCents: 0 })) }));
vi.mock('@/lib/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ mutate: vi.fn(), isPending: false }) }));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: stato.reso, error: null }) }) }) }),
  }),
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'returns') {
        return {
          update: (patch: Record<string, unknown>) => {
            let daStato: string | null = null;
            const catena: Record<string, unknown> = {
              eq: (colonna: string, valore: string) => {
                if (colonna === 'status') daStato = valore;
                return catena;
              },
              select: async () => {
                stato.scritture.push({ patch, daStato });
                return { data: [{ id: 'r1' }], error: null };
              },
              then: (r: (v: unknown) => unknown) => {
                stato.scritture.push({ patch, daStato });
                return r({ error: null });
              },
            };
            return catena;
          },
        };
      }
      if (tabella === 'orders') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }) };
      }
      if (tabella === 'profiles') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: 'seller' }, error: null }) }) }) };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/returns/[id]/avanza/route';
import ReturnRequestCard, { type ReturnRow } from '@/components/seller/ReturnRequestCard';

function chiudiSenzaRimborso() {
  const req = new Request('http://localhost/api/returns/r1/avanza', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stato: 'CANCELED' }),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'r1' }) });
}

const reso = (status: string, reason: string, creato: string) => ({
  id: 'r1', status, reason, seller_id: 'seller-1', buyer_id: 'b1', order_id: 'o1',
  refund_amount_cents: null, refund_id: null, created_at: creato,
});
const chiusoSenzaRimborso = () => stato.scritture.some((s) => s.patch.status === 'CANCELED');

beforeEach(() => {
  stato.ordine = {
    seller_id: 'seller-1', stripe_payment_intent: 'pi_1', payment_method: 'card',
    gross_total_cents: 3000, total_price: 30, refunded_amount_cents: 0, stripe_refund_id: null,
  };
  stato.scritture = [];
});

describe('la rotta: il recesso non si chiude senza rimborso', () => {
  for (const [status, quando] of [
    ['RECEIVED', 'con la merce gia\' tornata in negozio'],
    ['SHIPPED_BACK', 'con la merce in rientro'],
    ['REQUESTED', 'prima ancora di decidere (sarebbe il rifiuto che `decide` blocca)'],
  ] as const) {
    it(`ripensamento in ${status}: no, ${quando}`, async () => {
      stato.reso = reso(status, 'CHANGED_MIND', fa(3));
      const res = await chiudiSenzaRimborso();
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).toMatch(/recesso/i);
      expect(chiusoSenzaRimborso(), 'il reso non deve diventare CANCELED: il bonifico partirebbe').toBe(false);
    });
  }

  it('ripensamento approvato da 3 giorni: no, il cliente ha ancora tempo per rispedire', async () => {
    stato.reso = reso('APPROVED', 'CHANGED_MIND', fa(3));
    const res = await chiudiSenzaRimborso();
    expect(res.status).toBe(409);
    expect(chiusoSenzaRimborso()).toBe(false);
  });

  it('ripensamento approvato da 20 giorni e mai rispedito: si chiude', async () => {
    stato.reso = reso('APPROVED', 'CHANGED_MIND', fa(20));
    const res = await chiudiSenzaRimborso();
    expect(res.status).toBe(200);
    expect(chiusoSenzaRimborso()).toBe(true);
  });

  it('un reso per prodotto danneggiato, gia\' ricevuto, si puo\' ancora chiudere senza rimborso', async () => {
    stato.reso = reso('RECEIVED', 'DAMAGED', fa(3));
    const res = await chiudiSenzaRimborso();
    expect(res.status).toBe(200);
    expect(chiusoSenzaRimborso()).toBe(true);
  });
});

describe('la card del negozio non offre «Chiudi senza rimborso» sul recesso', () => {
  const card = (status: string, reason: string) => {
    const ret: ReturnRow = {
      id: 'r1', status, reason, notes: null, photo_urls: null,
      refund_amount_cents: null, decision_notes: null, created_at: fa(3),
    };
    return renderToStaticMarkup(createElement(ReturnRequestCard, { ret, orderTotal: 30, onDecided: () => {} }));
  };

  for (const status of ['SHIPPED_BACK', 'RECEIVED']) {
    it(`ripensamento in ${status}: niente pulsante di chiusura senza rimborso`, () => {
      expect(card(status, 'CHANGED_MIND')).not.toContain('Chiudi senza rimborso');
    });
  }

  it('ripensamento ricevuto: resta «Rimborsa e chiudi»', () => {
    expect(card('RECEIVED', 'CHANGED_MIND')).toContain('Rimborsa e chiudi');
  });

  it('prodotto danneggiato ricevuto: il pulsante resta', () => {
    expect(card('RECEIVED', 'DAMAGED')).toContain('Chiudi senza rimborso');
  });
});
