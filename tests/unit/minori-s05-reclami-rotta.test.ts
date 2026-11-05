import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S05 · schede 1648 e 190/337 — la rotta che chiude un reclamo.
 * ① Le note oltre 500 caratteri non arrivano più a Stripe intere (metadata
 *   limitati a 500): il rimborso non fallisce, le note restano intere sul reclamo.
 * ② Anche il negozio riceve l'esito (prima solo il cliente).
 * ③ Chi non è admin riceve ancora il rifiuto.
 */

const avvisi: Array<Record<string, unknown>> = [];
const refundOrder = vi.fn(async (o: { amountCents: number; reason?: string }) => ({
  refundId: 'rf_1', reversedCents: 0, pieno: false, modo: 'carta', importoCents: o.amountCents, creditoCents: 0, bonificoCents: 0,
}));

vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      req.headers.get('x-ruolo') === 'admin'
        ? handler({ user: { id: 'admin-1' }, req, params: (await ctx?.params) ?? {} })
        : new Response('Solo admin', { status: 403 }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true }));
vi.mock('@/lib/stripe/payout', () => ({ refundOrder: (o: { amountCents: number; reason?: string }) => refundOrder(o) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const catena: Record<string, unknown> = {};
      Object.assign(catena, {
        eq: () => catena, in: () => catena, or: () => catena,
        select: async () => ({ data: [{ id: 'd1' }], error: null }),
        then: (r: (v: unknown) => unknown) => r({ error: null }),
      });
      if (tabella === 'disputes') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({
            data: { id: 'd1', status: 'open', order_id: 'ordine00-0000', opener_id: 'cliente-1', against_id: 'negozio-1' }, error: null,
          }) }) }),
          update: () => catena,
        };
      }
      if (tabella === 'orders') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({
            data: { stripe_payment_intent: 'pi_1', payment_method: 'card', total_price: 30, seller_id: (globalThis as Record<string, unknown>).__NEGOZIO_DELL_ORDINE__ ?? 'negozio-1' }, error: null,
          }) }) }),
          update: () => catena,
        };
      }
      return { insert: async (v: Record<string, unknown>) => { if (tabella === 'notifications') avvisi.push(v); return { error: null }; } };
    },
  }),
}));

import { POST } from '@/app/api/admin/disputes/[id]/resolve/route';

function risolvi(body: unknown, ruolo = 'admin') {
  const req = new Request('http://localhost/api/admin/disputes/d1/resolve', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-ruolo': ruolo }, body: JSON.stringify(body),
  });
  return POST(req as never, { params: Promise.resolve({ id: 'd1' }) });
}

beforeEach(() => { avvisi.length = 0; refundOrder.mockClear(); delete (globalThis as Record<string, unknown>).__NEGOZIO_DELL_ORDINE__; });

describe('chiudere un reclamo', () => {
  it('chi non è admin riceve ancora 403 e non parte nessun rimborso', async () => {
    const res = await risolvi({ status: 'resolved_buyer', notes: 'x'.repeat(20), refundCents: 500 }, 'seller');
    expect(res.status).toBe(403);
    expect(refundOrder).not.toHaveBeenCalled();
  });

  it('1648: note da 600 caratteri → a Stripe ne arrivano al massimo 500', async () => {
    const note = 'Spiegazione lunga. '.repeat(32).slice(0, 600);
    const res = await risolvi({ status: 'resolved_buyer', notes: note, refundCents: 1000 });
    expect(res.status).toBe(200);
    const motivo = refundOrder.mock.calls[0][0].reason ?? '';
    expect(motivo.length).toBeLessThanOrEqual(500);
    // Le note intere restano nell'avviso al cliente.
    expect(avvisi.find((a) => a.user_id === 'cliente-1')?.body).toBe(note);
  });

  it('190: anche il negozio riceve l’esito, con l’importo rimborsato', async () => {
    await risolvi({ status: 'resolved_buyer', notes: 'Prodotto arrivato rotto, rimborso parziale.', refundCents: 1000 });
    const alNegozio = avvisi.find((a) => a.user_id === 'negozio-1');
    expect(alNegozio, 'il negozio non è stato avvisato').toBeDefined();
    expect(String(alNegozio?.body)).toMatch(/Rimborso al cliente: 10,00/);
    expect(alNegozio?.link).toBe('/seller/orders/ordine00-0000');
  });

  it('190: a favore del negozio, il negozio lo sa', async () => {
    await risolvi({ status: 'resolved_seller', notes: 'Il prodotto era conforme alla descrizione.' });
    expect(String(avvisi.find((a) => a.user_id === 'negozio-1')?.title)).toMatch(/a tuo favore/);
  });
  // 5/11/2026 (unione, collaudo della 190) — `against_id` lo scrive il browser del cliente: l'esito va
  // al negozio dell'ordine letto dal database, non a chi il cliente ha scritto nel reclamo.
  it('190: l’esito va al negozio vero dell’ordine, anche se il reclamo nomina un altro', async () => {
    (globalThis as Record<string, unknown>).__NEGOZIO_DELL_ORDINE__ = 'forno-vero';
    await risolvi({ status: 'resolved_seller', notes: 'Il prodotto era conforme alla descrizione.' });
    expect(avvisi.find((a) => a.user_id === 'forno-vero'), 'il negozio dell’ordine non è stato avvisato').toBeDefined();
    expect(avvisi.find((a) => a.user_id === 'negozio-1'), 'l’estraneo scritto nel reclamo ha ricevuto le note').toBeUndefined();
  });
});
