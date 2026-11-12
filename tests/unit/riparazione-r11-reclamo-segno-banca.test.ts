import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R11-002 — UN RECLAMO CHIUSO A FAVORE DEL NEGOZIO NON GLI BLOCCA PIÙ IL BONIFICO.
 *
 * In produzione il trigger della 063 scrive ancora `orders.dispute_status='OPEN'`
 * a ogni reclamo interno aperto (la 184 non è applicata). Il giro dei bonifici
 * paga solo `dispute_status` vuoto o 'WON': chiudere il reclamo scriveva solo
 * `internal_dispute_status`, e l'ordine restava fuori per sempre.
 * Ora la chiusura toglie quel segno, ma solo se in banca non c'è una
 * contestazione vera (contanti: mai; carta: lo dice Stripe).
 */

const ADMIN = { id: 'admin-1' };

const stato: {
  ordine: Record<string, unknown>;
  scrittureOrdine: { patch: Record<string, unknown>; filtri: [string, unknown][] }[];
  contestazioniStripe: Array<{ status: string }> | 'errore';
  avvisi: string[];
} = { ordine: {}, scrittureOrdine: [], contestazioniStripe: [], avvisi: [] };

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: typeof ADMIN; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: ADMIN, req, params: (await ctx?.params) ?? {} }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    disputes: {
      list: async () => {
        if (stato.contestazioniStripe === 'errore') throw new Error('stripe giù');
        return { data: stato.contestazioniStripe };
      },
    },
  }),
}));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: vi.fn() }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  notifyAdmins: vi.fn(async (titolo: string) => {
    stato.avvisi.push(titolo);
  }),
}));
vi.mock('@/lib/ordini/campanella', () => ({ scriviCampanella: vi.fn(async () => {}) }));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'disputes') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { id: 'd1', status: 'open', order_id: 'o1', opener_id: 'b1', against_id: 's1' },
                error: null,
              }),
            }),
          }),
          update: () => {
            const catena: Record<string, unknown> = {
              eq: () => catena,
              in: () => catena,
              select: async () => ({ data: [{ id: 'd1' }], error: null }),
              then: (r: (v: unknown) => unknown) => r({ error: null }),
            };
            return catena;
          },
        };
      }
      if (tabella === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: stato.ordine, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            const scrittura = { patch, filtri: [] as [string, unknown][] };
            stato.scrittureOrdine.push(scrittura);
            const catena: Record<string, unknown> = {
              eq: (c: string, v: unknown) => {
                scrittura.filtri.push([c, v]);
                return catena;
              },
              or: () => catena,
              then: (r: (v: unknown) => unknown) => r({ error: null }),
            };
            return catena;
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { POST } from '@/app/api/admin/disputes/[id]/resolve/route';

function risolvi(body: unknown) {
  const req = new Request('http://localhost/api/admin/disputes/d1/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'd1' }) });
}

const NOTE = 'Il prodotto era conforme, il negozio ha ragione.';
const segnoTolto = () =>
  stato.scrittureOrdine.some(
    (s) => 'dispute_status' in s.patch && s.patch.dispute_status === null && s.filtri.some(([c, v]) => c === 'dispute_status' && v === 'OPEN'),
  );

beforeEach(() => {
  stato.scrittureOrdine = [];
  stato.contestazioniStripe = [];
  stato.avvisi = [];
});

describe('R11-002 — reclamo chiuso a favore del negozio col segno del trigger vecchio', () => {
  it('contanti: il segno OPEN si toglie e il bonifico può ripartire', async () => {
    stato.ordine = { payment_method: 'cod', stripe_payment_intent: null, total_price: 30, dispute_status: 'OPEN' };
    const res = await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(res.status).toBe(200);
    expect(segnoTolto(), 'il reclamo è chiuso ma l’ordine resta escluso dal giro dei bonifici per sempre').toBe(true);
  });

  it('carta senza nessuna contestazione in banca: il segno si toglie', async () => {
    stato.ordine = { payment_method: 'card', stripe_payment_intent: 'pi_1', total_price: 30, dispute_status: 'OPEN' };
    stato.contestazioniStripe = [{ status: 'won' }];
    const res = await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(res.status).toBe(200);
    expect(segnoTolto()).toBe(true);
  });

  it('carta con una contestazione vera ancora aperta: il segno resta', async () => {
    stato.ordine = { payment_method: 'card', stripe_payment_intent: 'pi_1', total_price: 30, dispute_status: 'OPEN' };
    stato.contestazioniStripe = [{ status: 'needs_response' }];
    await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(segnoTolto()).toBe(false);
  });

  it('una contestazione già persa in banca (avviso non ancora arrivato) o uno stato nuovo: il segno resta', async () => {
    stato.ordine = { payment_method: 'card', stripe_payment_intent: 'pi_1', total_price: 30, dispute_status: 'OPEN' };
    for (const status of ['lost', 'uno_stato_nuovo']) {
      stato.scrittureOrdine = [];
      stato.contestazioniStripe = [{ status }];
      await risolvi({ status: 'resolved_seller', notes: NOTE });
      expect(segnoTolto(), `con una contestazione «${status}» il giro pagherebbe soldi già ripresi dalla banca`).toBe(false);
    }
  });

  it('carta senza payment intent: non si sa, il segno resta e gli amministratori lo sanno', async () => {
    stato.ordine = { payment_method: 'card', stripe_payment_intent: null, total_price: 30, dispute_status: 'OPEN' };
    await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(segnoTolto()).toBe(false);
    expect(stato.avvisi).toContain('Reclamo chiuso, bonifico ancora fermo');
  });

  it('Stripe non risponde: il segno resta e gli amministratori lo sanno', async () => {
    stato.ordine = { payment_method: 'card', stripe_payment_intent: 'pi_1', total_price: 30, dispute_status: 'OPEN' };
    stato.contestazioniStripe = 'errore';
    await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(segnoTolto()).toBe(false);
    expect(stato.avvisi).toContain('Reclamo chiuso, bonifico ancora fermo');
  });

  it('senza segno non si scrive niente sulla colonna della banca', async () => {
    stato.ordine = { payment_method: 'cod', stripe_payment_intent: null, total_price: 30, dispute_status: null };
    await risolvi({ status: 'resolved_seller', notes: NOTE });
    expect(stato.scrittureOrdine.some((s) => 'dispute_status' in s.patch)).toBe(false);
  });
});
