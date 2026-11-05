import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * S05 · schede 477, 1692, 1883, 1546 — l'amministratore che annulla un ordine.
 * Gira la rotta VERA con annullaERimborsa VERA su un database finto.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };
const audit = vi.fn(async (_e: unknown) => {});
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/audit', () => ({ writeAudit: (e: unknown) => audit(e) }));
vi.mock('@/lib/analytics/events', () => ({ trackErrorShown: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({ isStripeConfigured: () => true, getStripe: () => { throw new Error('niente Stripe qui'); } }));
vi.mock('@/lib/api/middleware', () => ({
  withAdminAuth:
    (h: (ctx: unknown) => unknown) =>
    async (req: Request, ctx?: { params: Promise<Record<string, string>> }) =>
      req.headers.get('x-ruolo') === 'admin'
        ? h({ req, user: { id: 'admin1' }, profile: { role: 'admin' }, params: (await ctx?.params) ?? {} })
        : new Response(JSON.stringify({ error: { message: 'Solo admin' } }), { status: 403 }),
}));

import { POST as annulla } from '@/app/api/admin/orders/[id]/cancel/route';
import { friendlyError } from '@/lib/errors';
import { rigaCsvOrdine } from '@/lib/ordini/esporta-ordini';

function ordine(extra: Riga): Riga {
  return {
    user_id: 'cliente1', seller_id: 'forno', rider_id: 'rider1', payment_method: 'cod', payment_status: 'PENDING',
    delivery_status: 'ASSIGNED', stripe_payment_intent: null, stripe_session_id: null, wallet_applied_cents: 0,
    cash_confirmed_at: null, refunded_amount_cents: 0, coupon_code: null, internal_dispute_status: null, total_price: 12,
    ...extra,
  };
}

async function premi(id: string, ruolo = 'admin', reason = 'cliente sospetto, non servire') {
  const res = await (annulla as unknown as (req: Request, ctx: unknown) => Promise<Response>)(
    new Request(`http://x/api/admin/orders/${id}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-ruolo': ruolo }, body: JSON.stringify({ reason }),
    }),
    { params: Promise.resolve({ id }) },
  );
  const data = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, messaggio: data.error?.message ?? '' };
}

beforeEach(() => {
  audit.mockClear();
  stato.db = fintoDatabase({
    orders: [
      ordine({ id: 'viaggio', delivery_status: 'ASSIGNED' }),
      ordine({ id: 'consegnato', delivery_status: 'DELIVERED' }),
      ordine({ id: 'incassato', delivery_status: 'OUT_FOR_DELIVERY', cash_confirmed_at: '2026-11-04T10:00:00Z' }),
    ],
    order_items: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
});

describe('annullo dell’amministratore', () => {
  it('chi non è admin riceve ancora il rifiuto e l’ordine non cambia', async () => {
    expect((await premi('viaggio', 'buyer')).status).toBe(403);
    expect(stato.db.tabelle.orders!.find((o) => o.id === 'viaggio')!.delivery_status).toBe('ASSIGNED');
  });

  it('477: un ordine in contanti consegnato non si annulla (la merce non torna a scaffale)', async () => {
    const r = await premi('consegnato');
    expect(r.status).toBe(409);
    expect(stato.db.tabelle.orders!.find((o) => o.id === 'consegnato')!.delivery_status).toBe('DELIVERED');
  });

  it('477: su un ordine in viaggio avvisa anche negozio e fattorino', async () => {
    const r = await premi('viaggio');
    expect(r.status).toBe(200);
    const a = (stato.db.tabelle.notifications ?? []).map((n) => n.user_id);
    expect(a).toEqual(expect.arrayContaining(['cliente1', 'forno', 'rider1']));
  });

  it('1883: la nota dell’amministratore non arriva al cliente, resta nel registro', async () => {
    await premi('viaggio');
    const alCliente = (stato.db.tabelle.notifications ?? []).find((n) => n.user_id === 'cliente1');
    expect(String(alCliente?.body)).not.toContain('sospetto');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ nota: 'cliente sospetto, non servire' }) }));
  });

  it('1692: contanti incassati → frase intera a video, senza un passo che non esiste', async () => {
    const r = await premi('incassato');
    expect(r.status).toBe(409);
    const aVideo = friendlyError(new Error(r.messaggio));
    expect(aVideo).toBe(r.messaggio);
    expect(aVideo).not.toMatch(/Registra la scelta|\s\./);
    expect(aVideo).toMatch(/reclamo/);
  });
});

describe('1546: il file degli ordini', () => {
  it('la data è nell’ora di Piacenza e in una forma che Excel legge', () => {
    const riga = rigaCsvOrdine({
      id: 'o1', created_at: '2026-09-06T23:32:11.123Z', delivery_full_name: 'M', delivery_city: 'PC',
      delivery_status: 'DELIVERED', total_price: 10, seller: null, rider: null,
    } as never);
    expect(riga[1]).toBe('07/09/2026 01:32');
  });
});
