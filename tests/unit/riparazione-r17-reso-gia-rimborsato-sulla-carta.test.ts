import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase } from './aiuti/finto-database-dei-rimborsi';

/**
 * R17-004 — Un reso già rimborsato per intero sulla carta, con l'esito non scritto sul reso,
 * si chiude con «rimborsato».
 *
 * Ordine con carta da 40 €, bonifico al negozio già partito (36 € di sua parte). Il negozio
 * approva il reso con 40 € di rimborso: Stripe rimborsa 40 €, l'ordine conta 40 € e al negozio si
 * stornano 36 €. Poi cade la scrittura dell'esito sul reso: decide risponde 500 e il reso resta
 * APPROVED. Il negozio fa i passi normali, «merce ricevuta» e «rimborsato».
 *
 * Prima: il residuo dell'ordine era zero e avanza rispondeva «già rimborsato per intero» (o
 * «non può superare») prima che refundOrder potesse riconoscere il rimborso della chiave del reso.
 * Il reso non si chiudeva mai «rimborsato». Ora avanza lo registra, senza rimborsare di nuovo e
 * senza togliere al negozio la sua quota una seconda volta.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; chiave: string | null };
const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  utente: 'giulia',
  resoCade: false,
  suStripe: [] as RimborsoSuStripe[],
  creati: [] as number[],
  storni: [] as Array<{ amount: number; chiave: string }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => finto.db.client,
  getServerSupabase: async () => finto.db.client,
}));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = finto.suStripe.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { ...gia };
        finto.creati.push(p.amount);
        const nuovo = { id: `re_${finto.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: p.metadata ?? {}, chiave: o.idempotencyKey };
        finto.suStripe.push(nuovo);
        return { ...nuovo };
      },
      list: async () => ({ data: [...finto.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false }),
    },
    transfers: {
      createReversal: async (_t: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        if (!finto.storni.some((s) => s.chiave === o.idempotencyKey)) finto.storni.push({ amount: p.amount, chiave: o.idempotencyKey });
        return { id: `trr_${o.idempotencyKey}` };
      },
    },
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

import { POST as apriReso } from '@/app/api/returns/create/route';
import { POST as decidi } from '@/app/api/returns/[id]/decide/route';
import { POST as avanza } from '@/app/api/returns/[id]/avanza/route';

const ORDINE = 'a1b2c3d4-6666-4666-8666-666666666666';
type Rotta = (r: Request, c: unknown) => Promise<Response>;
const json = (corpo: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
const sommaStorni = () => finto.storni.reduce((s, x) => s + x.amount, 0);

/** 40 € con la carta, consegnato, bonifico al negozio già partito. */
function conLaCarta(id: string): Riga {
  return {
    id, user_id: 'giulia', seller_id: 'negozio',
    total_price: 40, gross_total_cents: 4000, wallet_applied_cents: 0,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'TRANSFERRED',
    stripe_payment_intent: 'pi_1', stripe_transfer_id: 'tr_1', stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'card',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', delivered_at: new Date(Date.now() - 86_400_000).toISOString(),
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    payment_status: 'PAID', cash_confirmed_at: null,
    internal_dispute_status: null,
    cash_photo_url: null, delivery_photo_url: null, cash_signature_url: null,
  };
}

/** La scrittura dell'esito del rimborso sul reso (quella con `refund_id`) va in timeout, una volta. */
function laScritturaDelResoCade(db: FintoDatabase) {
  const from = db.client.from.bind(db.client) as unknown as (t: string) => Record<string, unknown>;
  (db.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t);
    if (t !== 'returns') return q;
    return new Proxy(q, {
      get(obj, prop, recv) {
        if (prop !== 'update') return Reflect.get(obj, prop, recv);
        const update = (Reflect.get(obj, prop, recv) as (p: Record<string, unknown>) => unknown).bind(obj);
        return (p: Record<string, unknown>) => {
          if (finto.resoCade && 'refund_id' in p) {
            finto.resoCade = false;
            const catena: Record<string, unknown> = {};
            catena.eq = () => catena;
            catena.select = async () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
            catena.then = (r: (v: unknown) => unknown) => r({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
            return catena;
          }
          return update(p);
        };
      },
    });
  };
}

beforeEach(() => {
  finto.utente = 'giulia';
  finto.resoCade = false;
  finto.suStripe = [];
  finto.creati = [];
  finto.storni = [];
  finto.db = creaFintoDatabase({
    orders: [conLaCarta(ORDINE)],
    returns: [],
    order_items: [],
    disputes: [],
    profiles: [{ id: 'admin-1', role: 'admin' }, { id: 'negozio', role: 'seller' }, { id: 'giulia', role: 'buyer' }],
    notifications: [],
    cod_reconciliations: [],
  });
  finto.db.email.giulia = 'giulia.bianchi@example.it';
  laScritturaDelResoCade(finto.db);
});

async function resoApprovatoConLEsitoPerso(cifra: number): Promise<string> {
  const aperto = await (apriReso as unknown as Rotta)(
    new Request('http://localhost/api/returns/create', json({ orderId: ORDINE, reason: 'DAMAGED', description: 'Arrivato rotto, la scatola era schiacciata' })),
    undefined,
  );
  expect(aperto.status).toBe(201);
  const id = (await aperto.json()).id as string;

  finto.utente = 'negozio';
  finto.resoCade = true;
  const deciso = await (decidi as unknown as Rotta)(
    new Request('http://localhost/x', json({ decision: 'APPROVED', refundAmountCents: cifra })),
    { params: Promise.resolve({ id }) },
  );
  expect(deciso.status, 'la scrittura dell esito sul reso è caduta').toBe(500);
  return id;
}

const passo = (id: string, corpo: Record<string, unknown>) =>
  (avanza as unknown as Rotta)(new Request('http://localhost/x', json(corpo)), { params: Promise.resolve({ id }) });

describe('R17-004 — il reso già rimborsato per intero sulla carta si chiude con «rimborsato»', () => {
  it('rimborso pieno da 40 €, esito perso: «merce ricevuta» e «rimborsato» chiudono il reso senza rimborsare di nuovo', async () => {
    const id = await resoApprovatoConLEsitoPerso(4000);
    expect(finto.creati, 'Stripe ha rimborsato i 40 €').toEqual([4000]);
    expect(Number(finto.db.tabelle.orders[0].refunded_amount_cents)).toBe(4000);
    expect(sommaStorni()).toBe(3600);
    expect(finto.db.tabelle.returns[0].status).toBe('APPROVED');
    expect(finto.db.tabelle.returns[0].refund_id ?? null).toBeNull();

    expect((await passo(id, { stato: 'RECEIVED' })).status, 'merce ricevuta').toBe(200);
    const rimborsato = await passo(id, { stato: 'REFUNDED' });
    const corpo = await rimborsato.json();
    expect(rimborsato.status, `«rimborsato» respinto: ${JSON.stringify(corpo)}`).toBe(200);

    const reso = finto.db.tabelle.returns[0];
    expect(reso.status).toBe('REFUNDED');
    expect(reso.refund_id, 'il reso registra il rimborso che è uscito').toBe('re_1');
    expect(Number(reso.refund_amount_cents)).toBe(4000);
    expect(reso.refunded_at).toBeTruthy();
    expect(finto.creati, 'la carta non si rimborsa una seconda volta').toEqual([4000]);
    expect(Number(finto.db.tabelle.orders[0].refunded_amount_cents)).toBe(4000);
    expect(sommaStorni(), 'al negozio la quota si toglie una volta').toBe(3600);
  }, 60000);

  it('il negozio scrive una cifra più alta del residuo: si registra quello che è uscito davvero', async () => {
    const id = await resoApprovatoConLEsitoPerso(4000);
    expect((await passo(id, { stato: 'RECEIVED' })).status).toBe(200);
    const rimborsato = await passo(id, { stato: 'REFUNDED', refundAmountCents: 4500 });
    expect(rimborsato.status).toBe(200);
    expect(finto.db.tabelle.returns[0].refund_id).toBe('re_1');
    expect(Number(finto.db.tabelle.returns[0].refund_amount_cents)).toBe(4000);
    expect(finto.creati).toEqual([4000]);
  }, 60000);

  it('nessun rimborso di questo reso uscito: il residuo resta il tetto e niente parte', async () => {
    // Un altro rimborso (un reso diverso) ha già restituito 30 € sull'ordine.
    finto.db.tabelle.orders[0].refunded_amount_cents = 3000;
    finto.db.tabelle.orders[0].payment_status = 'PARTIALLY_REFUNDED';
    finto.suStripe.push({ id: 're_9', amount: 3000, status: 'succeeded', metadata: { order_id: ORDINE, return_id: 'altro', chiave_rimborso: 'return_altro' }, chiave: 'return_altro' });
    finto.db.tabelle.returns.push({
      id: 'r-nuovo', order_id: ORDINE, seller_id: 'negozio', buyer_id: 'giulia', status: 'RECEIVED', reason: 'DAMAGED',
      refund_amount_cents: null, refund_id: null, order_item_id: null, created_at: new Date(Date.now() - 3_600_000).toISOString(), decided_at: null,
    });
    finto.utente = 'negozio';
    const troppo = await passo('r-nuovo', { stato: 'REFUNDED', refundAmountCents: 2000 });
    expect(troppo.status).toBe(400);
    expect((await troppo.json()).error.message).toContain('10.00');
    expect(finto.creati, 'nessun rimborso nuovo').toEqual([]);
    expect(finto.db.tabelle.returns.find((r) => r.id === 'r-nuovo')!.status).toBe('RECEIVED');
  });
});
