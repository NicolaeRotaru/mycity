import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R76 — CHIUDERE UN RECLAMO RIMBORSANDO SOLO I CONTANTI BLOCCAVA PER SEMPRE IL
 * RESTO DEL BONIFICO AL NEGOZIO.
 *
 * Due pezzi di codice decidevano se un rimborso copre tutto l'ordine, su basi
 * diverse: `refundOrder` sul lordo, la rotta dei reclami su `total_price` (la
 * cassa DOPO il credito MyCity). Il caso della scheda:
 *  1. ordine in contanti da 50 € lordi: 20 pagati col credito, 30 in contanti;
 *     al negozio spettano 45 €;
 *  2. la merce arriva rovinata, il reclamo si chiude a favore della cliente con
 *     30 €, i contanti che ha dato;
 *  3. `refundOrder` lo tratta da parziale: riprende al negozio 27 € e l'ordine
 *     resta PARTIALLY_REFUNDED, al negozio restano dovuti 18 €;
 *  4. la rotta confrontava 30 € con `total_price` (30 €): «integrale», 'LOST';
 *  5. il giro dei bonifici non paga piu' quell'ordine: i 18 € non partono mai.
 *
 * Gira la rotta VERA dei reclami e la `refundOrder` VERA; finti solo il
 * database, l'autenticazione dell'amministratore, Stripe e la posta.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase }));

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto.db.client }));
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
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (handler: (ctx: { user: { id: string }; params: Record<string, string>; req: Request }) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      handler({ user: { id: 'nicola' }, req, params: (await ctx?.params) ?? {} }),
}));

import { POST as risolvi } from '@/app/api/admin/disputes/[id]/resolve/route';

/** 50 € lordi: 20 di credito MyCity e 30 in contanti incassati. Al negozio 45 €, non ancora versati. */
function ordineMisto(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'cliente', seller_id: 'negozio',
    total_price: 30, gross_total_cents: 5000, wallet_applied_cents: 2000,
    seller_payout_cents: 4500, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    internal_dispute_status: 'OPEN',
    ...extra,
  };
}

beforeEach(() => {
  finto.db = creaFintoDatabase({
    orders: [ordineMisto()],
    disputes: [{ id: 'd1', status: 'open', order_id: 'o1', opener_id: 'cliente', against_id: 'negozio' }],
    profiles: [{ id: 'nicola', role: 'admin' }],
    notifications: [],
  });
});

function chiudi(refundCents: number) {
  const req = new Request('http://localhost/api/admin/disputes/d1/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status: 'resolved_buyer',
      notes: 'Merce arrivata rovinata: rimborsiamo i contanti alla cliente.',
      refundCents,
    }),
  });
  return risolvi(req as never, { params: Promise.resolve({ id: 'd1' }) });
}

const ordine = () => finto.db.tabelle.orders[0];

describe('reclamo chiuso rimborsando i contanti di un ordine pagato in parte col credito', () => {
  it('IL CASO CHE ROMPEVA — 30 € su 50: il negozio resta da pagare del resto', async () => {
    const res = await chiudi(3000);

    expect(res.status).toBe(200);
    expect(ordine().payment_status, 'per i soldi il rimborso e parziale').toBe('PARTIALLY_REFUNDED');
    expect(
      ordine().internal_dispute_status,
      'LOST esclude l ordine dal giro dei bonifici per sempre: i 18 € del negozio non partono mai',
    ).toBe('RESOLVED');
  });

  it('al negozio si riprende solo la quota proporzionale, e il resto gli resta dovuto', async () => {
    await chiudi(3000);

    // 3000 × 4500 / 5000 = 2700: restano 1800 da versare.
    expect(ordine().seller_payout_reversed_cents).toBe(2700);
    expect(Number(ordine().seller_payout_cents) - Number(ordine().seller_payout_reversed_cents)).toBe(1800);
  });

  it('rimborso dell intero lordo: allora si, LOST — al negozio non spetta piu niente', async () => {
    const res = await chiudi(5000);

    expect(res.status).toBe(200);
    expect(ordine().payment_status).toBe('REFUNDED');
    expect(ordine().internal_dispute_status).toBe('LOST');
  });
});
