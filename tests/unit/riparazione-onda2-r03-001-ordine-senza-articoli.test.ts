import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R03-001 (onda 2) — LA FUNZIONE CHE MUORE FRA L'ORDINE E GLI ARTICOLI.
 *
 * Strada della carta: il webhook scrive l'ordine e poi i suoi articoli. Se la funzione moriva fra le
 * due scritture, Stripe riconsegnava l'avviso, l'ordine rispondeva 23505 e il webhook lo dava per fatto
 * senza guardare gli articoli: carrello COMPLETED, ordine pagato e vuoto, e la merce tolta dalla vendita
 * al checkout legata a un ordine che `restore_stock_for_order` (che legge solo `order_items`) non sa
 * rimettere. Qui gira il webhook vero (`handleCheckoutCompleted`) sulla riconsegna, con un database finto
 * in memoria: l'ordine c'è già, gli articoli no.
 *
 * (La strada dei contanti ha la sua riserva scritta, migrazione 961: riparazione-r27-riserva-scritta.)
 */

const mondo = vi.hoisted(() => ({
  /** Gli articoli già scritti, per ordine. */
  articoli: [] as Array<Record<string, unknown>>,
  /** La lettura degli articoli cade. */
  letturaArticoliRotta: false,
  carrelloAggiornato: [] as Array<Record<string, unknown>>,
  ordiniTolti: [] as unknown[],
}));

vi.mock('next/server', () => ({
  after: () => undefined,
  NextResponse: { json: (b: unknown, i?: ResponseInit) => new Response(JSON.stringify(b), i) },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: async () => ({ ok: true }) }));
vi.mock('@/lib/email/templates', () => ({
  orderConfirmedBuyerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
  newOrderSellerTemplate: () => ({ subject: 's', html: 'h', text: 't' }),
}));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => true, contaAcquisto: async () => undefined }));
vi.mock('@/lib/carrelli-abbandonati', () => ({ marcaCarrelloRecuperato: vi.fn(async () => undefined) }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1' }) } }),
  computeOrderSplit: () => ({ applicationFeeCents: 100, sellerPayoutCents: 900 }),
}));

const ORDINE = '0a0a0a0a-0000-4000-8000-000000000001';

vi.mock('@/lib/supabase/server', () => {
  const pending = () => ({
    id: 'pc_1',
    buyer_id: 'buyer-1',
    status: 'PENDING',
    total_cents: 1300,
    stripe_session_id: 'cs_1',
    coupon_code: null,
    pickup_in_store: false,
    delivery: { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null },
    groups: [{
      sellerId: 'seller-1', storeName: 'Pane Quotidiano', subtotalCents: 1300, totalCents: 1300, shippingCents: 0,
      deliveryFeeCents: 0, riderFeeCents: 100, couponPortionCents: 0, pickupPortionCents: 0,
      items: [
        { productId: 'p-pane', name: 'Pane', quantity: 2, unitAmountCents: 400 },
        { productId: 'p-torta', name: 'Torta', quantity: 1, unitAmountCents: 500, variantId: 'v-grande', variantLabel: 'Grande' },
      ],
    }],
  });

  function tabella(nome: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let righe: unknown = null;
    const filtri: Record<string, unknown> = {};
    const esegui = async (): Promise<{ data: unknown; error: unknown }> => {
      if (nome === 'pending_checkouts') {
        if (op === 'update') {
          mondo.carrelloAggiornato.push(righe as Record<string, unknown>);
          return { data: null, error: null };
        }
        return { data: pending(), error: null };
      }
      if (nome === 'orders') {
        // La riconsegna: l'ordine l'ha già scritto il tentativo morto.
        if (op === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        if (op === 'delete') {
          mondo.ordiniTolti.push(filtri.id);
          return { data: null, error: null };
        }
        return { data: { id: ORDINE }, error: null };
      }
      if (nome === 'order_items') {
        if (op === 'insert') {
          mondo.articoli.push(...(righe as Array<Record<string, unknown>>));
          return { data: null, error: null };
        }
        if (mondo.letturaArticoliRotta) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        return { data: mondo.articoli.filter((r) => r.order_id === filtri.order_id).map((r) => ({ id: `oi-${String(r.product_id)}` })), error: null };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filtri[c] = v; return b; },
      is: () => b,
      in: () => b,
      gte: () => b,
      order: () => b,
      limit: () => b,
      insert: (r: unknown) => { op = 'insert'; righe = r; return b; },
      update: (r: unknown) => { op = 'update'; righe = r; return b; },
      delete: () => { op = 'delete'; return b; },
      single: () => esegui(),
      maybeSingle: () => esegui(),
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => esegui().then(ok, ko),
    };
    return b;
  }

  return {
    getAdminSupabase: () => ({
      from: (nome: string) => tabella(nome),
      rpc: async () => ({ data: null, error: null }),
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } } }) } },
    }),
  };
});

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';

const sessione = {
  id: 'cs_1',
  payment_status: 'paid',
  client_reference_id: 'pc_1',
  amount_total: 1300,
  payment_intent: 'pi_1',
  customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' },
  metadata: {},
} as never;

const completato = () => mondo.carrelloAggiornato.some((u) => u.status === 'COMPLETED');

beforeEach(() => {
  mondo.articoli = [];
  mondo.letturaArticoliRotta = false;
  mondo.carrelloAggiornato = [];
  mondo.ordiniTolti = [];
});

describe('R03-001 · carta: l ordine nato senza articoli da un tentativo morto si completa alla riconsegna', () => {
  it('IL CASO CHE ROMPEVA — l ordine c è e gli articoli no: la riconsegna li scrive prima di chiudere il carrello', async () => {
    await handleCheckoutCompleted(sessione);

    const suoi = mondo.articoli.filter((r) => r.order_id === ORDINE);
    expect(
      suoi.map((r) => [r.product_id, r.quantity, r.unit_price, r.variant_id]),
      'il carrello si chiude con un ordine pagato e vuoto: la merce riservata non la rimette più nessuno',
    ).toEqual([
      ['p-pane', 2, 4, null],
      ['p-torta', 1, 5, 'v-grande'],
    ]);
    expect(completato(), 'il carrello deve chiudersi, una volta completato l ordine').toBe(true);
    expect(mondo.ordiniTolti, 'l ordine pagato non si toglie').toEqual([]);
  });

  it('controprova: l ordine ha già i suoi articoli, la riconsegna non li scrive una seconda volta', async () => {
    mondo.articoli = [
      { order_id: ORDINE, product_id: 'p-pane', quantity: 2 },
      { order_id: ORDINE, product_id: 'p-torta', quantity: 1 },
    ];
    await handleCheckoutCompleted(sessione);
    expect(mondo.articoli, 'articoli doppi: la merce si conterebbe due volte').toHaveLength(2);
    expect(completato()).toBe(true);
  });

  it('se gli articoli non si leggono non si chiude il carrello: Stripe riprova', async () => {
    mondo.letturaArticoliRotta = true;
    await expect(handleCheckoutCompleted(sessione)).rejects.toThrow(/articoli/);
    expect(completato(), 'carrello chiuso senza sapere se l ordine ha i suoi articoli').toBe(false);
    expect(mondo.articoli).toEqual([]);
  });
});
