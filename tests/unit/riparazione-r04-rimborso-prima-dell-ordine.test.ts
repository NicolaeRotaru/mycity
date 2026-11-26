import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R04-005 — IL CLIENTE RIMBORSATO PRIMA CHE IL SUO ORDINE NASCA.
 *
 * Sabato il gestore degli ordini è in errore per due ore: Stripe ripete l'avviso «pagamento
 * completato». Una cliente paga 30 € da Pane Quotidiano, non vede l'ordine, chiama, e Nicola la
 * rimborsa dal cruscotto. L'avviso «rimborso fatto» arriva quando l'ordine non c'è ancora: il
 * gestore non trovava niente ed usciva bene. Poi l'avviso del pagamento passava, rileggeva la
 * carta guardando solo l'id e faceva nascere l'ordine PAID con il bonifico HELD da 27 €: il forno
 * preparava, il giro lo pagava, e la cliente aveva merce e soldi.
 *
 * La prova fa girare i due gestori VERI (pagamento completato e rimborso) contro un database
 * finto che legge e scrive, con Stripe finto.
 */

type Carica = { id: string; refunded: boolean; amount: number; amount_refunded: number; disputed: boolean };

const stato: { db: FintoDatabase; carica: Carica | string; rimborsiCreati: string[] } = {
  db: fintoDatabase(),
  carica: 'ch_1',
  rimborsiCreati: [],
};

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
    paymentIntents: { retrieve: async () => ({ id: 'pi_1', latest_charge: stato.carica }) },
    refunds: {
      list: async () => ({ data: [{ id: 're_cruscotto', reason: 'requested_by_customer' }] }),
      create: async (_p: unknown, o: { idempotencyKey: string }) => {
        stato.rimborsiCreati.push(o.idempotencyKey);
        return { id: `re_${o.idempotencyKey}` };
      },
    },
    checkout: { sessions: { list: async () => ({ data: [] }) } },
  }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ applicationFeeCents: 300, sellerPayoutCents: 2700 }),
}));

import { handleCheckoutCompleted } from '@/lib/stripe/webhook/ordini';
import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';

const sessione = {
  id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', payment_intent: 'pi_1', amount_total: 3000,
  created: 1_700_000_000, customer_details: { email: 'cliente@test.it', name: 'Maria' }, metadata: { pending_checkout_id: 'pc_1' },
} as unknown as Parameters<typeof handleCheckoutCompleted>[0];

function gruppo(sellerId: string, storeName: string, productId: string): Riga {
  return {
    sellerId, storeName, totalCents: 3000, subtotalCents: 3000, shippingCents: 0, deliveryFeeCents: 0,
    couponPortionCents: 0, pickupPortionCents: 0, items: [{ productId, name: 'Pane', quantity: 3, unitAmountCents: 1000 }],
  };
}

function carrello(extra: Riga = {}): Riga {
  return {
    id: 'pc_1', buyer_id: 'cliente', status: 'PENDING', coupon_code: null, pickup_in_store: false, total_cents: 3000,
    stripe_session_id: 'cs_1', expires_at: '2999-01-01T00:00:00Z',
    delivery: { full_name: 'Maria', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', phone: '333', notes: null, lat: null, lng: null, slot: null },
    groups: [gruppo('pane-quotidiano', 'Pane Quotidiano', 'p_pane')],
    ...extra,
  };
}

/** L'avviso «rimborso fatto» di Stripe: la carta del carrello rimborsata per intero. */
const rimborsoPieno = {
  id: 'ch_1', payment_intent: 'pi_1', amount: 3000, amount_refunded: 3000, refunded: true,
  metadata: { pending_checkout_id: 'pc_1', buyer_user_id: 'cliente', seller_count: '1' }, transfer_group: 'mc_pc_1',
  refunds: { data: [{ id: 're_cruscotto', reason: 'requested_by_customer' }] },
} as unknown as Parameters<typeof handleChargeRefunded>[0];

/** Come Stripe: un avviso che risponde male si ripete, uno che risponde bene no. */
async function consegna(gestore: () => Promise<unknown>): Promise<'lavorato' | 'da-ripetere'> {
  try {
    await gestore();
    return 'lavorato';
  } catch {
    return 'da-ripetere';
  }
}

const ordini = () => stato.db.tabelle.orders ?? [];
const titoliAgliAmministratori = () => (stato.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin1').map((n) => n.title);

beforeEach(() => {
  stato.carica = 'ch_1';
  stato.rimborsiCreati = [];
  stato.db = fintoDatabase({
    pending_checkouts: [carrello()],
    orders: [],
    order_items: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
  stato.db.unici = { orders: [['stripe_session_id', 'seller_id']] };
});

describe('R04-005 · il rimborso arrivato prima che l ordine nasca', () => {
  it('IL CASO DELLA SCHEDA — la carta è già rimborsata quando l avviso del pagamento passa: nessun ordine pagato', async () => {
    // Il rimborso dal cruscotto arriva mentre il gestore degli ordini è in errore.
    const rimborso = await consegna(() => handleChargeRefunded(rimborsoPieno));
    // Poi l'avviso del pagamento passa, e la carta riletta dice: rimborsata.
    stato.carica = { id: 'ch_1', refunded: true, amount: 3000, amount_refunded: 3000, disputed: false };
    await handleCheckoutCompleted(sessione);
    if (rimborso === 'da-ripetere') await handleChargeRefunded(rimborsoPieno);

    const pagati = ordini().filter((o) => o.payment_status === 'PAID');
    expect(pagati, 'nasce un ordine PAID su una carta già rimborsata: il forno prepara e il giro gli versa 27 €').toEqual([]);
    expect(ordini().filter((o) => o.payout_status === 'HELD'), 'un bonifico al negozio in attesa per soldi già tornati alla cliente').toEqual([]);
    expect(stato.db.tabelle.pending_checkouts![0].status, 'il carrello resta aperto: la merce resta tenuta da parte').not.toBe('PENDING');
    expect(stato.db.rpc.filter((r) => r.nome === 'restore_stock'), 'la merce del carrello senza ordine non torna in vendita').toHaveLength(1);
    expect(titoliAgliAmministratori(), 'nessuno sa del pagamento rimasto senza ordine').toContain('⚠️ Pagamento senza ordine');
    expect(stato.rimborsiCreati, 'una carta già rimborsata non si rimborsa una seconda volta').toEqual([]);
  });

  it('il rimborso che arriva col carrello ancora aperto si fa ripetere, e non tocca niente', async () => {
    const esito = await consegna(() => handleChargeRefunded(rimborsoPieno));

    expect(esito, 'il rimborso senza ordine risulta lavorato: Stripe non lo ripete più').toBe('da-ripetere');
    expect(stato.db.scritture, 'il gestore ha scritto qualcosa prima di farsi ripetere').toEqual([]);
  });

  it('LA FINESTRA — la carta riletta un attimo prima del rimborso: l ordine nasce, ma il rimborso ripetuto lo annulla', async () => {
    // Il gestore del pagamento ha già riletto la carta (non rimborsata) quando arriva il rimborso.
    const rimborso = await consegna(() => handleChargeRefunded(rimborsoPieno));
    await handleCheckoutCompleted(sessione);
    if (rimborso === 'da-ripetere') await handleChargeRefunded(rimborsoPieno);

    expect(ordini()).toHaveLength(1);
    expect(ordini()[0].payment_status, 'l ordine resta PAID dopo il rimborso dal cruscotto').toBe('REFUNDED');
    expect(ordini()[0].payout_status, 'il bonifico da 27 € al negozio resta in attesa e il giro lo paga').toBe('REFUNDED');
    expect(ordini()[0].delivery_status, 'il forno continua a preparare un ordine rimborsato').toBe('CANCELED');
  });

  it('una carta contestata in banca prima che l ordine nasca: nessun ordine pagato', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount: 3000, amount_refunded: 0, disputed: true };
    await handleCheckoutCompleted(sessione);

    expect(ordini(), 'nasce un ordine pagato su una carta contestata').toEqual([]);
    expect(titoliAgliAmministratori()).toContain('⚠️ Pagamento senza ordine');
  });

  it('una carta rimborsata solo in parte prima che l ordine nasca: nessun ordine col netto pieno', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount: 3000, amount_refunded: 1000, disputed: false };
    await handleCheckoutCompleted(sessione);

    expect(ordini(), 'nasce un ordine col bonifico pieno al negozio, ma 10 € sono già tornati alla cliente').toEqual([]);
  });

  it('un carrello già chiuso (CANCELED) non fa nascere un ordine pagato, e gli amministratori lo sanno', async () => {
    stato.db.tabelle.pending_checkouts![0].status = 'CANCELED';
    await handleCheckoutCompleted(sessione);

    expect(ordini(), 'un carrello chiuso, con la merce già tornata in vendita, fa nascere un ordine').toEqual([]);
    expect(titoliAgliAmministratori(), 'un pagamento su un carrello chiuso passa in silenzio').toContain('⚠️ Pagamento senza ordine');
  });

  it('con un ordine già nato da un tentativo di prima, il resto nasce e il rimborso ripetuto li annulla tutti', async () => {
    stato.db.tabelle.pending_checkouts![0].groups = [gruppo('pane-quotidiano', 'Pane Quotidiano', 'p_pane'), gruppo('ortolano', 'L ortolano', 'p_mele')];
    stato.db.tabelle.pending_checkouts![0].total_cents = 6000;
    stato.db.tabelle.orders = [{
      id: 'o_pane', stripe_session_id: 'cs_1', stripe_payment_intent: 'pi_1', seller_id: 'pane-quotidiano', user_id: 'cliente',
      total_price: 30, payment_status: 'PAID', payout_status: 'HELD', delivery_status: 'NEW', seller_payout_cents: 2700,
    }];
    const sessioneDoppia = { ...sessione, amount_total: 6000 } as typeof sessione;
    const rimborso = { ...rimborsoPieno, amount: 6000, amount_refunded: 6000 } as typeof rimborsoPieno;

    const primo = await consegna(() => handleChargeRefunded(rimborso));
    stato.carica = { id: 'ch_1', refunded: true, amount: 6000, amount_refunded: 6000, disputed: false };
    await handleCheckoutCompleted(sessioneDoppia);
    if (primo === 'da-ripetere') await handleChargeRefunded(rimborso);

    expect(ordini().map((o) => o.payout_status), 'un bonifico al negozio resta in attesa su un carrello rimborsato').toEqual(['REFUNDED', 'REFUNDED']);
    expect(ordini().map((o) => o.payment_status)).toEqual(['REFUNDED', 'REFUNDED']);
  });

  it('il caso normale non cambia: carta pagata, l ordine nasce PAID con il bonifico HELD e il carrello COMPLETED', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount: 3000, amount_refunded: 0, disputed: false };
    await handleCheckoutCompleted(sessione);

    expect(ordini()).toHaveLength(1);
    expect(ordini()[0]).toMatchObject({ payment_status: 'PAID', payout_status: 'HELD', seller_payout_cents: 2700, stripe_charge_id: 'ch_1' });
    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('COMPLETED');
    expect(titoliAgliAmministratori()).not.toContain('⚠️ Pagamento senza ordine');

    // E un rimborso dopo, a carrello chiuso, si lavora subito come prima.
    await handleChargeRefunded(rimborsoPieno);
    expect(ordini()[0]).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED' });
  });
});
