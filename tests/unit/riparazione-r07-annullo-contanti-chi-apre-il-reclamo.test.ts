import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * ANNULLANDO UN ORDINE PAGATO IN CONTANTI, CHI AMMINISTRA LEGGE UNA FRASE INTERA E UN PASSO CHE PUÒ FARE.
 *
 * La rotta diceva all'amministratore «apri un reclamo»: il reclamo lo apre solo il cliente
 * dell'ordine (app/api/disputes/route.ts risponde 403 a chiunque altro). Il passo vero: il cliente
 * apre il reclamo dalla pagina dell'ordine, l'amministratore lo chiude in «Reclami» col rimborso.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => { throw new Error('niente Stripe qui'); } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: unknown) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: (await ctx?.params) ?? {} }),
}));

import { POST as annulla } from '@/app/api/admin/orders/[id]/cancel/route';
import { friendlyError } from '@/lib/errors';

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1', seller_id: 'forno', rider_id: 'rider1', payment_method: 'cod', payment_status: 'PENDING',
    delivery_status: 'ASSIGNED', stripe_payment_intent: null, stripe_session_id: null, wallet_applied_cents: 0,
    cash_confirmed_at: null, refunded_amount_cents: 0, coupon_code: null, internal_dispute_status: null, total_price: 12,
    ...extra,
  };
}

async function premi(id: string) {
  const res = await (annulla as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request(`http://x/api/admin/orders/${id}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ id }) },
  );
  const data = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: data.error?.message ?? '' };
}

beforeEach(() => {
  stato.db = fintoDatabase({
    orders: [
      ordine({ id: 'consegnato', delivery_status: 'DELIVERED' }),
      ordine({ id: 'incassato', delivery_status: 'OUT_FOR_DELIVERY', cash_confirmed_at: '2026-11-04T10:00:00Z' }),
    ],
    order_items: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
});

describe('annullo dell amministratore su un ordine in contanti', () => {
  it.each(['incassato', 'consegnato'])('%s: frase intera a video, e il reclamo lo fa aprire al cliente', async (id) => {
    const r = await premi(id);
    expect(r.status).toBe(409);
    const aVideo = friendlyError(new Error(r.messaggio));
    expect(aVideo, 'la pagina mostra un testo diverso da quello della rotta').toBe(r.messaggio);
    expect(aVideo).toMatch(/\.$/);
    expect(aVideo, 'chi amministra non può aprire un reclamo').not.toMatch(/\bapri un reclamo\b/i);
    expect(aVideo).toMatch(/cliente un reclamo|aprire un reclamo/);
    expect(aVideo).toMatch(/chiudilo in Reclami/);
    expect(stato.db.tabelle.orders!.find((o) => o.id === id)!.delivery_status).not.toBe('CANCELED');
  });

  it('«Reclami» è davvero la voce del pannello che porta ai reclami da chiudere', () => {
    const menu = readFileSync(join(process.cwd(), 'components', 'admin', 'AdminSidebar.tsx'), 'utf8');
    expect(menu).toMatch(/href: '\/admin\/disputes',[^}]*label: 'Reclami'/);
  });
});
