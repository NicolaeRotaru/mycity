import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R10-006 — LA SPESA PAGATA CON LA CARTA TORNAVA NEL CARRELLO.
 *
 * Maria riempie il carrello sul telefono (3 pagnotte e un litro di latte), paga solo il pane con la
 * carta e chiude la scheda di Stripe senza tornare sul sito. La copia del carrello sul server
 * (`user_carts`) restava piena: al giro dopo, sul telefono o sul computer, il pane pagato tornava
 * nel carrello. Qui il gestore VERO del pagamento completato, contro un database finto che legge e
 * scrive: dopo il pagamento la copia sul server tiene solo quello che non è stato pagato.
 */

const stato: { db: FintoDatabase } = { db: fintoDatabase() };

vi.mock('next/server', () => ({ after: () => {} }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/carrelli-abbandonati', () => ({ marcaCarrelloRecuperato: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => stato.db.client.from(t),
    rpc: (n: string, a?: Record<string, unknown>) => stato.db.client.rpc(n, a),
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'cliente@test.it' } } }) } },
  }),
}));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: async () => ({ id: 'pi_1', latest_charge: 'ch_1' }) },
    refunds: { list: async () => ({ data: [] }), create: async () => ({ id: 're_1' }) },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
  }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ applicationFeeCents: 300, sellerPayoutCents: 2700 }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';
import { carrelloSenzaIlPagato, togliIlPagatoDalCarrelloSalvato } from '@/lib/carrello-sul-server';

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', payment_intent: 'pi_1', amount_total: 3000,
  created: 1_700_000_000, customer_details: { email: 'cliente@test.it', name: 'Maria' }, metadata: { pending_checkout_id: 'pc_1' },
} as unknown as Parameters<typeof handleCheckoutCompleted>[0];

function carrelloInCassa(): Riga {
  return {
    id: 'pc_1', buyer_id: 'cliente', status: 'PENDING', coupon_code: null, pickup_in_store: false, total_cents: 3000,
    stripe_session_id: 'cs_1', expires_at: '2999-01-01T00:00:00Z',
    delivery: { full_name: 'Maria', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', phone: '333', notes: null, lat: null, lng: null, slot: null },
    groups: [{
      sellerId: 'pane-quotidiano', storeName: 'Pane Quotidiano', totalCents: 3000, subtotalCents: 3000, shippingCents: 0,
      deliveryFeeCents: 0, couponPortionCents: 0, pickupPortionCents: 0,
      items: [{ productId: 'p_pane', name: 'Pane', quantity: 3, unitAmountCents: 1000 }],
    }],
  };
}

const PANE = { id: 'p_pane', name: 'Pane', price: 10, quantity: 3, sellerId: 'pane-quotidiano' };
const LATTE = { id: 'p_latte', name: 'Latte', price: 1.5, quantity: 1, sellerId: 'latteria' };
const carrelloSalvato = () => stato.db.tabelle.user_carts?.find((r) => r.user_id === 'cliente');

beforeEach(() => {
  stato.db = fintoDatabase({
    pending_checkouts: [carrelloInCassa()],
    orders: [],
    order_items: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    user_carts: [{ user_id: 'cliente', items: [PANE, LATTE], updated_at: '2026-11-28T09:00:00.000Z' }],
  });
  stato.db.unici = { orders: [['stripe_session_id', 'seller_id']] };
});

describe('R10-006 · dopo il pagamento con la carta la merce pagata esce dal carrello salvato', () => {
  it('IL CASO DELLA VOCE — chi paga e non torna da Stripe non ritrova il pane pagato nel carrello', async () => {
    await handleCheckoutCompleted(sessione);

    expect(stato.db.tabelle.orders, 'l ordine nasce').toHaveLength(1);
    const salvato = carrelloSalvato();
    expect(salvato?.items, 'il pane pagato resta nel carrello sul server e torna su ogni dispositivo').toEqual([LATTE]);
    // La data cambia: CartCrossDeviceSync la usa come segno di versione e prende il cloud intero.
    expect(salvato?.updated_at).not.toBe('2026-11-28T09:00:00.000Z');
  });

  it('un pezzo in più messo dopo su un altro dispositivo resta: si toglie solo la quantità pagata', async () => {
    stato.db.tabelle.user_carts![0].items = [{ ...PANE, quantity: 4 }, LATTE];
    await handleCheckoutCompleted(sessione);
    expect(carrelloSalvato()?.items).toEqual([{ ...PANE, quantity: 1 }, LATTE]);
  });

  it('il carrello già svuotato dal browser al ritorno non si tocca', async () => {
    stato.db.tabelle.user_carts![0].items = [];
    await handleCheckoutCompleted(sessione);
    expect(carrelloSalvato()?.items).toEqual([]);
    expect(carrelloSalvato()?.updated_at).toBe('2026-11-28T09:00:00.000Z');
  });

  it('l avviso di Stripe ripetuto non toglie una seconda volta il pane rimesso apposta', async () => {
    await handleCheckoutCompleted(sessione);
    stato.db.tabelle.user_carts![0].items = [{ ...PANE, quantity: 1 }];
    await handleCheckoutCompleted(sessione);
    expect(carrelloSalvato()?.items).toEqual([{ ...PANE, quantity: 1 }]);
  });
});

describe('carrelloSenzaIlPagato', () => {
  it('distingue le varianti: la taglia M pagata non toglie la L', () => {
    const righe = [{ id: 'maglia', variantId: 'M', quantity: 1 }, { id: 'maglia', variantId: 'L', quantity: 1 }];
    expect(carrelloSenzaIlPagato(righe, [{ productId: 'maglia', variantId: 'M', quantity: 1 }])).toEqual([
      { id: 'maglia', variantId: 'L', quantity: 1 },
    ]);
  });

  it('niente da togliere: null, e nessuna scrittura', () => {
    expect(carrelloSenzaIlPagato([{ id: 'a', quantity: 1 }], [{ productId: 'b', quantity: 1 }])).toBeNull();
  });
});

describe('togliIlPagatoDalCarrelloSalvato · un browser che salva in mezzo non viene coperto', () => {
  it('se la riga è cambiata fra lettura e scrittura si rilegge e si rifà il conto sul carrello nuovo', async () => {
    // Prima lettura: pane e latte. In mezzo il computer aggiunge le uova: la scrittura condizionata
    // sulla data letta non tocca niente, si rilegge e si toglie il pane dal carrello CON le uova.
    const letture = [
      { items: [PANE, LATTE], updated_at: 't1' },
      { items: [PANE, LATTE, { id: 'p_uova', quantity: 6 }], updated_at: 't2' },
    ];
    const scritte: Array<{ items: unknown; sullaData: unknown }> = [];
    let giro = 0;
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: letture[Math.min(giro, 1)], error: null }) }) }),
        update: (riga: { items: unknown }) => ({
          eq: () => ({
            eq: (_c: string, sullaData: unknown) => ({
              select: async () => {
                scritte.push({ items: riga.items, sullaData });
                const passa = sullaData === letture[1].updated_at;
                giro += 1;
                return { data: passa ? [{ user_id: 'cliente' }] : [], error: null };
              },
            }),
          }),
        }),
      }),
    };
    await togliIlPagatoDalCarrelloSalvato(admin as never, 'cliente', [{ productId: 'p_pane', quantity: 3 }]);
    expect(scritte).toHaveLength(2);
    expect(scritte[1]).toEqual({ items: [LATTE, { id: 'p_uova', quantity: 6 }], sullaData: 't2' });
  });
});
