import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * IL CLIENTE RIMBORSATO PRIMA CHE IL SUO ORDINE NASCA.
 *
 * Sabato il gestore degli ordini è in errore per due ore: Stripe ripete l'avviso «pagamento
 * completato». Una cliente paga 30 € da Pane Quotidiano, non vede l'ordine, chiama, e Nicola la
 * rimborsa dal cruscotto. L'avviso «rimborso fatto» arrivava quando l'ordine non c'era ancora: il
 * gestore non trovava niente e usciva bene. Poi l'avviso del pagamento passava, rileggeva la carta
 * guardando solo l'id e faceva nascere l'ordine PAID con il bonifico HELD da 27 €: il forno
 * preparava, il giro lo pagava, e la cliente aveva merce e soldi.
 *
 * E il contrario, che non si deve rompere: un carrello di due negozi nato a metà, il pane annullato
 * da NOI (rifiuto del negozio, ordine scaduto: un rimborso parziale) — al tentativo dopo l'ordine
 * dell'ortolano nasce lo stesso, come prima. Altrimenti la cliente paga senza merce né rimborso.
 *
 * La prova fa girare i due gestori VERI (pagamento completato e rimborso) contro un database
 * finto che legge e scrive, con Stripe finto.
 */

type Carica = { id: string; refunded: boolean; amount: number; amount_refunded: number; disputed: boolean };
type RimborsoChiesto = { parametri: Record<string, unknown>; chiave: string };

const stato: { db: FintoDatabase; carica: Carica | string; rimborsiChiesti: RimborsoChiesto[] } = {
  db: fintoDatabase(),
  carica: 'ch_1',
  rimborsiChiesti: [],
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
      create: async (p: Record<string, unknown>, o: { idempotencyKey: string }) => {
        stato.rimborsiChiesti.push({ parametri: p, chiave: o.idempotencyKey });
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

/** Il carrello di due negozi (pane e ortolano, 30 € l'uno) con l'ordine del pane già nato da un tentativo di prima. */
function carrelloNatoAMeta(ordineDelPane: Riga = {}) {
  stato.db.tabelle.pending_checkouts![0].groups = [gruppo('pane-quotidiano', 'Pane Quotidiano', 'p_pane'), gruppo('ortolano', 'L ortolano', 'p_mele')];
  stato.db.tabelle.pending_checkouts![0].total_cents = 6000;
  stato.db.tabelle.orders = [{
    id: 'o_pane', stripe_session_id: 'cs_1', stripe_payment_intent: 'pi_1', seller_id: 'pane-quotidiano', user_id: 'cliente',
    total_price: 30, gross_total_cents: 3000, payment_status: 'PAID', payout_status: 'HELD', delivery_status: 'NEW',
    seller_payout_cents: 2700, refunded_amount_cents: 0, ...ordineDelPane,
  }];
  return { ...sessione, amount_total: 6000 } as typeof sessione;
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
const titoliAgliAmministratori = () => (stato.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'admin1').map((n) => String(n.title));
const avvisiAllaCliente = () => (stato.db.tabelle.notifications ?? []).filter((n) => n.user_id === 'cliente');
const merceRimessa = () => stato.db.rpc.filter((r) => r.nome === 'restore_stock').map((r) => r.argomenti.p_items);
const AVVISO_CARTA_TORNATA = '⚠️ Pagamento senza ordine: carta già tornata';

beforeEach(() => {
  stato.carica = 'ch_1';
  stato.rimborsiChiesti = [];
  stato.db = fintoDatabase({
    pending_checkouts: [carrello()],
    orders: [],
    order_items: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
  });
  stato.db.unici = { orders: [['stripe_session_id', 'seller_id']] };
});

describe('il cliente rimborsato prima che il suo ordine nasca', () => {
  it('IL CASO DELLA SCHEDA — la carta è già rimborsata quando l avviso del pagamento passa: nessun ordine pagato', async () => {
    // Il rimborso dal cruscotto arriva mentre il gestore degli ordini è in errore.
    const rimborso = await consegna(() => handleChargeRefunded(rimborsoPieno));
    // Poi l'avviso del pagamento passa, e la carta riletta dice: rimborsata.
    stato.carica = { id: 'ch_1', refunded: true, amount: 3000, amount_refunded: 3000, disputed: false };
    await handleCheckoutCompleted(sessione);
    if (rimborso === 'da-ripetere') await handleChargeRefunded(rimborsoPieno);

    expect(ordini().filter((o) => o.payment_status === 'PAID'), 'nasce un ordine PAID su una carta già rimborsata: il forno prepara e il giro gli versa 27 €').toEqual([]);
    expect(ordini().filter((o) => o.payout_status === 'HELD'), 'un bonifico al negozio in attesa per soldi già tornati alla cliente').toEqual([]);
    expect(stato.db.tabelle.pending_checkouts![0].status, 'il carrello resta aperto: la merce resta tenuta da parte').not.toBe('PENDING');
    expect(merceRimessa(), 'la merce del carrello senza ordine non torna in vendita').toEqual([[{ product_id: 'p_pane', variant_id: null, qty: 3 }]]);
    expect(titoliAgliAmministratori(), 'nessuno sa del pagamento rimasto senza ordine').toContain(AVVISO_CARTA_TORNATA);
    expect(stato.rimborsiChiesti, 'una carta già rimborsata non si rimborsa una seconda volta').toEqual([]);
  });

  it('il rimborso che arriva col carrello ancora aperto e nessun ordine si fa ripetere, e non tocca niente', async () => {
    const esito = await consegna(() => handleChargeRefunded(rimborsoPieno));

    expect(esito, 'il rimborso senza ordine risulta lavorato: Stripe non lo ripete più e l ordine nasce pagato').toBe('da-ripetere');
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

  it('una carta contestata in banca prima che l ordine nasca: nessun ordine pagato, nessun rimborso in più', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount: 3000, amount_refunded: 0, disputed: true };
    await handleCheckoutCompleted(sessione);

    expect(ordini(), 'nasce un ordine pagato su una carta contestata').toEqual([]);
    expect(stato.db.tabelle.pending_checkouts![0].status).not.toBe('PENDING');
    expect(stato.rimborsiChiesti, 'una carta contestata non si rimborsa: i soldi li ha già ripresi la banca').toEqual([]);
    expect(titoliAgliAmministratori()).toContain(AVVISO_CARTA_TORNATA);
  });

  it('UN RIMBORSO PARZIALE DA FUORI prima che l ordine nasca: nessun ordine, e il resto torna alla cliente, che lo sa', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount: 3000, amount_refunded: 1, disputed: false };
    await handleCheckoutCompleted(sessione);
    await handleCheckoutCompleted(sessione); // Stripe che riconsegna lo stesso avviso

    expect(ordini(), 'nasce un ordine col bonifico pieno al negozio, ma una parte è già tornata alla cliente').toEqual([]);
    expect(stato.rimborsiChiesti.map((r) => r.chiave), 'la cliente resta senza ordine e senza i 29,99 € restanti').toEqual([
      'refund_carta_tornata_pc_1', 'refund_carta_tornata_pc_1',
    ]);
    // Senza importo: Stripe rimborsa quello che manca, e la stessa chiave resta valida anche se nel frattempo è cambiato.
    expect(stato.rimborsiChiesti[0].parametri).toMatchObject({ payment_intent: 'pi_1' });
    expect(stato.rimborsiChiesti[0].parametri).not.toHaveProperty('amount');
    expect(stato.db.tabelle.pending_checkouts![0].status).not.toBe('PENDING');
    expect(merceRimessa(), 'la merce torna in vendita una volta sola').toHaveLength(1);
    expect(avvisiAllaCliente(), 'la cliente non sa che il resto le è tornato e che l ordine non c è').toHaveLength(1);
    expect(titoliAgliAmministratori().filter((t) => t === AVVISO_CARTA_TORNATA)).toHaveLength(1);
  });

  it('NON SI ROMPE — carrello nato a metà, il pane annullato da noi (rimborso parziale): al tentativo dopo l ortolano nasce PAID', async () => {
    const sessioneDoppia = carrelloNatoAMeta({
      payment_status: 'REFUNDED', payout_status: 'REFUNDED', delivery_status: 'CANCELED', refunded_amount_cents: 3000,
    });
    // L'eco del nostro rimborso parziale (refundOrder): 30 € su 60 tornati alla cliente, già scritti sull'ordine.
    const eco = { ...rimborsoPieno, amount: 6000, amount_refunded: 3000, refunded: false } as typeof rimborsoPieno;
    await handleChargeRefunded(eco);
    stato.carica = { id: 'ch_1', refunded: false, amount: 6000, amount_refunded: 3000, disputed: false };
    await handleCheckoutCompleted(sessioneDoppia);

    const ortolano = ordini().find((o) => o.seller_id === 'ortolano');
    expect(ortolano, 'l ordine dell ortolano non nasce: la cliente ha pagato 30 € senza merce né rimborso').toBeDefined();
    expect(ortolano).toMatchObject({ payment_status: 'PAID', payout_status: 'HELD', delivery_status: 'NEW' });
    expect(stato.db.tabelle.pending_checkouts![0].status, 'il carrello resta aperto per sempre').toBe('COMPLETED');
    expect(stato.rimborsiChiesti, 'nessun rimborso in più: l ortolano consegna').toEqual([]);
    expect(merceRimessa(), 'la merce dell ortolano torna in vendita mentre lui la consegna').toEqual([]);
    expect(titoliAgliAmministratori()).not.toContain(AVVISO_CARTA_TORNATA);
  });

  it('carrello nato a metà e carta rimborsata per intero: il resto non nasce, il nato si annulla, torna in vendita solo la merce del non nato', async () => {
    const sessioneDoppia = carrelloNatoAMeta();
    const rimborso = { ...rimborsoPieno, amount: 6000, amount_refunded: 6000 } as typeof rimborsoPieno;

    const primo = await consegna(() => handleChargeRefunded(rimborso));
    stato.carica = { id: 'ch_1', refunded: true, amount: 6000, amount_refunded: 6000, disputed: false };
    await handleCheckoutCompleted(sessioneDoppia);
    if (primo === 'da-ripetere') await handleChargeRefunded(rimborso);

    expect(primo, 'con un ordine già nato il rimborso si lavora subito').toBe('lavorato');
    expect(ordini().map((o) => o.seller_id), 'nasce un ordine nuovo su una carta già rimborsata').toEqual(['pane-quotidiano']);
    expect(ordini()[0]).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED', delivery_status: 'CANCELED' });
    expect(stato.db.tabelle.pending_checkouts![0].status, 'il carrello resta aperto per sempre con la merce dell ortolano tenuta da parte').not.toBe('PENDING');
    expect(merceRimessa(), 'torna in vendita anche la merce del pane (già rimessa dal rimborso), o niente').toEqual([[{ product_id: 'p_mele', variant_id: null, qty: 3 }]]);
    expect(stato.rimborsiChiesti).toEqual([]);
    expect(titoliAgliAmministratori()).toContain(AVVISO_CARTA_TORNATA);
  });

  it('IL CARRELLO PAGATO A METÀ RESTA APERTO — Stripe non ripete più il pagamento: il rimborso annulla subito l ordine nato', async () => {
    carrelloNatoAMeta();
    const rimborso = { ...rimborsoPieno, amount: 6000, amount_refunded: 6000 } as typeof rimborsoPieno;

    const esiti = [];
    for (let i = 0; i < 3; i++) esiti.push(await consegna(() => handleChargeRefunded(rimborso)));

    expect(esiti[0], 'il rimborso si fa ripetere per sempre e l ordine nato non si annulla mai').toBe('lavorato');
    expect(ordini()[0], 'il forno prepara e viene pagato, la cliente ha i soldi indietro').toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED', delivery_status: 'CANCELED' });
  });

  it('il caso normale non cambia: carta pagata, l ordine nasce PAID con il bonifico HELD e il carrello COMPLETED', async () => {
    stato.carica = { id: 'ch_1', refunded: false, amount: 3000, amount_refunded: 0, disputed: false };
    await handleCheckoutCompleted(sessione);

    expect(ordini()).toHaveLength(1);
    expect(ordini()[0]).toMatchObject({ payment_status: 'PAID', payout_status: 'HELD', seller_payout_cents: 2700, stripe_charge_id: 'ch_1' });
    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('COMPLETED');
    expect(titoliAgliAmministratori()).not.toContain(AVVISO_CARTA_TORNATA);

    // E un rimborso dopo, a carrello chiuso, si lavora subito come prima.
    await handleChargeRefunded(rimborsoPieno);
    expect(ordini()[0]).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED' });
  });
});
