import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R04-012 — IL RESO GIÀ RIMBORSATO SULLA CARTA SI CHIUDE CON LA CIFRA USCITA, E IL NEGOZIO LO SA.
 *
 * Il negozio approva un reso con un rimborso di 30 € su un ordine con carta da 40 €: Stripe rimborsa,
 * ma l'esito sul reso non si scrive. Poi fa i passi normali e a «rimborsato» lascia la cifra che la
 * scheda propone (40 €). `avanza` riconosce il rimborso già uscito e chiude il reso con 30 €: giusto
 * per i conti, ma in silenzio. Il negozio leggeva «Reso aggiornato» e credeva di aver restituito 40 €.
 *
 * La prova fa girare la rotta VERA e `refundOrder` contro il finto database dei rimborsi, con Stripe
 * finto che conosce il rimborso del reso.
 */

const finto = vi.hoisted(() => ({ db: null as unknown as FintoDatabase, utente: 'negozio' }));

const ORDINE = 'a1b2c3d4-8888-4888-8888-888888888888';
const RESO = 'r-carta';

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: vi.fn(async () => ({ id: 're_nuovo', amount: 0 })),
      list: vi.fn(async () => ({
        data: [{
          id: 're_reso', amount: 3000, status: 'succeeded',
          metadata: { order_id: 'a1b2c3d4-8888-4888-8888-888888888888', return_id: 'r-carta', chiave_rimborso: 'return_r-carta' },
        }],
        has_more: false,
      })),
    },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/api/middleware', () => {
  type Gestore = (ctx: { user: { id: string }; req: Request; params: Record<string, string> }) => unknown;
  const conUtente = (chi: () => string) => (handler: Gestore) =>
    async (req: Request, ctx?: { params?: Promise<Record<string, string>> }) =>
      handler({ user: { id: chi() }, req, params: (await ctx?.params) ?? {} });
  return {
    withAuthRateLimit: (_o: unknown, handler: Gestore) => conUtente(() => finto.utente)(handler),
    withAdminAuth: conUtente(() => 'admin-1'),
  };
});

import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });

/** Carta da 40 €, 30 € già rimborsati da Stripe per questo reso; al negozio 36 €, 27 già tolti. */
function conLaCarta(): Riga {
  return {
    id: ORDINE, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 2700, payout_status: 'HELD',
    stripe_payment_intent: 'pi_reso', stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 3000, payment_method: 'card',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PARTIALLY_REFUNDED', cash_confirmed_at: null, internal_dispute_status: null, discount_amount: 0,
  };
}

function resoRicevuto(): Riga {
  return {
    id: RESO, status: 'RECEIVED', seller_id: 'negozio', buyer_id: 'giulia', order_id: ORDINE, reason: 'DAMAGED',
    refund_amount_cents: 3000, created_at: new Date(Date.now() - 86_400_000).toISOString(), refund_id: null,
    order_item_id: null, decided_at: new Date(Date.now() - 3_600_000).toISOString(), decision_notes: null,
  };
}

const rimborsato = (refundAmountCents?: number) =>
  (avanza as unknown as Rotta)(
    new Request('http://localhost/x', json({ stato: 'REFUNDED', ...(refundAmountCents ? { refundAmountCents } : {}) })),
    { params: Promise.resolve({ id: RESO }) },
  );

const alNegozio = () => (finto.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'negozio');

beforeEach(() => {
  finto.utente = 'negozio';
  finto.db = creaFintoDatabase({
    orders: [conLaCarta()],
    returns: [resoRicevuto()],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
  });
  finto.db.email.giulia = 'giulia.bianchi@example.it';
});

describe('R04-012 · il reso già rimborsato sulla carta si chiude con la cifra uscita', () => {
  it('IL CASO DELLA SCHEDA — il negozio chiede 40 €, ne erano usciti 30: il reso si chiude con 30 e il negozio lo legge', async () => {
    const r = await rimborsato(4000);

    expect(r.status).toBe(200);
    expect(finto.db.tabelle.returns[0]).toMatchObject({ status: 'REFUNDED', refund_amount_cents: 3000 });
    const avviso = alNegozio().find((n) => String(n.title).includes('30,00'));
    expect(avviso, 'il reso si chiude con 30 € al posto dei 40 chiesti e il negozio non lo sa').toBeDefined();
    expect(String(avviso?.body), 'l avviso non dice la cifra che il negozio aveva chiesto').toContain('40,00');
  });

  it('se il negozio chiede proprio la cifra già uscita, nessun avviso in più', async () => {
    const r = await rimborsato(3000);

    expect(r.status).toBe(200);
    expect(finto.db.tabelle.returns[0]).toMatchObject({ status: 'REFUNDED', refund_amount_cents: 3000 });
    expect(alNegozio()).toEqual([]);
  });
});
