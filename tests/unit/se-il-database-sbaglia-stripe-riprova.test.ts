import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 15/10/2026 (R81) — SE IL DATABASE SBAGLIA UNA SCRITTURA DURANTE UN PAGAMENTO,
 * IL SITO RISPONDEVA A STRIPE «TUTTO A POSTO» E STRIPE NON RIPROVAVA PIÙ.
 *
 * La libreria di Supabase non lancia quando una scrittura fallisce: mette
 * l'errore dentro `{ error }`. Nei gestori degli avvisi di Stripe quell'errore
 * non lo leggeva nessuno, quindi il gestore finiva «bene», la rotta segnava
 * l'evento come lavorato e rispondeva 200. Il caso della scheda: un ordine da
 * 40 € consegnato, compenso del negozio trattenuto, arriva una contestazione
 * carta, la scrittura `dispute_status = 'OPEN'` va in timeout. Stripe non
 * riprova, e al giro dopo il negozio viene pagato su soldi che la banca si è già
 * ripresa.
 *
 * Questa prova fa girare la rotta VERA e i gestori VERI, con un database finto
 * che fa fallire la scrittura scelta come farebbe quello vero, e pretende:
 *   ① una risposta 5xx, così Stripe riprova;
 *   ② l'evento NON segnato come lavorato, e il turno restituito;
 *   ③ che il secondo passaggio di Stripe porti al risultato giusto senza fare
 *      due volte quello che era già stato fatto (stesso storno, stessa merce).
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
  /** Storni chiesti a Stripe: la chiave anti-doppione decide se è lo stesso. */
  storni: Array<{ transferId: string; amount: number; chiave: string }>;
} = {
  db: fintoDatabase(),
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } },
  storni: [],
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    subscriptions: { retrieve: async () => ({ current_period_end: 1_900_000_000 }) },
    paymentIntents: { retrieve: async () => ({ id: 'pi_1', latest_charge: 'ch_1' }) },
    transfers: {
      // Stripe vero: la stessa chiave anti-doppione restituisce lo STESSO storno.
      createReversal: async (transferId: string, params: { amount: number }, opzioni: { idempotencyKey: string }) => {
        const gia = stato.storni.find((s) => s.chiave === opzioni.idempotencyKey);
        if (!gia) stato.storni.push({ transferId, amount: params.amount, chiave: opzioni.idempotencyKey });
        return { id: `trr_${opzioni.idempotencyKey}` };
      },
    },
  }),
  isStripeConfigured: () => true,
  computeOrderSplit: () => ({ subtotalCents: 0, applicationFeeCents: 0, sellerPayoutCents: 0 }),
}));

import { POST } from '@/app/api/stripe/webhook/route';

function consegna(): Promise<Response> {
  return POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      body: '{}',
    }) as never,
  );
}

function ordine(extra: Riga): Riga {
  return {
    id: 'o1',
    seller_id: 's1',
    total_price: 40,
    gross_total_cents: 4000,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'DELIVERED',
    payout_status: 'HELD',
    dispute_status: null,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    seller_payout_cents: 3240,
    seller_payout_reversed_cents: 0,
    payout_tentativo: 0,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_fee_cents: null,
    ...extra,
  };
}

const riga = (tabella: string, id = 'o1') => stato.db.tabelle[tabella]?.find((r) => r.id === id);
const registro = () => stato.db.tabelle.stripe_event_log?.find((r) => r.event_id === stato.evento.id);

beforeEach(() => {
  stato.storni = [];
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
});

describe('contestazione carta aperta mentre il database va in timeout', () => {
  beforeEach(() => {
    stato.evento = {
      id: 'evt_dispute_open',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', amount: 4000, payment_intent: 'pi_1', charge: 'ch_1' } },
    };
  });

  it('IL CASO DELLA SCHEDA — la scrittura OPEN fallisce: 5xx, evento non lavorato, turno libero', async () => {
    stato.db.tabelle.orders = [ordine({})];
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && (s.valori as Riga | null)?.dispute_status === 'OPEN' ? TIMEOUT : null;

    const risposta = await consegna();

    expect(
      risposta.status,
      'con 200 Stripe considera l avviso consegnato e non riprova: il negozio verrebbe pagato su un ordine contestato',
    ).toBeGreaterThanOrEqual(500);
    expect(registro()?.processed, 'evento segnato come lavorato anche se la contestazione non è stata scritta').toBe(false);
    expect(registro()?.claimed_at, 'il turno resta preso: la riconsegna di Stripe riceverebbe «già visto»').toBeNull();
    expect(riga('orders')?.dispute_status).toBeNull();
  });

  it('e quando Stripe riprova, la contestazione si scrive e il giro dei bonifici la vede', async () => {
    stato.db.tabelle.orders = [ordine({})];
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && (s.valori as Riga | null)?.dispute_status === 'OPEN' ? TIMEOUT : null;
    await consegna();

    stato.db.guasto = () => null;
    const risposta = await consegna();

    expect(risposta.status).toBe(200);
    // Il giro dei bonifici paga solo `dispute_status` vuoto o 'WON'.
    expect(riga('orders')?.dispute_status).toBe('OPEN');
    expect(registro()?.processed).toBe(true);
  });

  it('bonifico già uscito e database giù: il secondo passaggio chiede a Stripe LO STESSO storno, non un altro', async () => {
    // La variante scomoda: lo storno su Stripe riesce, ma il database non
    // registra niente (né lo storno né la contestazione). Il secondo passaggio
    // rifà lo storno: deve essere lo stesso, altrimenti al negozio si toglie due volte.
    stato.db.tabelle.orders = [ordine({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1' })];
    stato.db.guasto = (s) => (s.tabella === 'orders' && s.operazione === 'update' ? TIMEOUT : null);

    expect((await consegna()).status).toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);

    expect(stato.storni, 'due storni diversi: al negozio la stessa quota è stata ripresa due volte').toHaveLength(1);
    expect(stato.storni[0].amount).toBe(3240);
    expect(riga('orders')?.seller_payout_reversed_cents).toBe(3240);
    expect(riga('orders')?.payout_status).toBe('REVERSED');
    expect(riga('orders')?.dispute_status).toBe('OPEN');
  });

  it('storno già registrato e solo la contestazione caduta: il secondo passaggio non storna di nuovo', async () => {
    stato.db.tabelle.orders = [ordine({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_1' })];
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && (s.valori as Riga | null)?.dispute_status === 'OPEN' ? TIMEOUT : null;
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);
    const chiamatePrima = stato.storni.length;

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);

    expect(stato.storni.length, 'storno rifatto su un bonifico già stornato').toBe(chiamatePrima);
    expect(riga('orders')?.seller_payout_reversed_cents).toBe(3240);
  });

  it('anche una LETTURA caduta degli ordini fa riprovare Stripe, invece di valere «nessun ordine»', async () => {
    stato.db.tabelle.orders = [ordine({})];
    stato.db.guastoLettura = (t) => (t === 'orders' ? TIMEOUT : null);

    const risposta = await consegna();

    expect(risposta.status).toBeGreaterThanOrEqual(500);
    expect(registro()?.processed).toBe(false);
  });
});

describe('contestazione chiusa', () => {
  it('vinta, ma la scrittura WON fallisce: Stripe riprova, e il bonifico torna in coda una volta sola', async () => {
    stato.evento = {
      id: 'evt_dispute_won',
      type: 'charge.dispute.closed',
      data: { object: { id: 'dp_1', status: 'won', payment_intent: 'pi_1', charge: 'ch_1' } },
    };
    stato.db.tabelle.orders = [ordine({ payout_status: 'REVERSED', dispute_status: 'OPEN', seller_payout_reversed_cents: 3240 })];
    stato.db.guasto = (s) => ((s.valori as Riga | null)?.dispute_status === 'WON' ? TIMEOUT : null);

    expect((await consegna()).status, 'contestazione vinta mai registrata: bonifico bloccato per sempre').toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);
    expect(riga('orders')).toMatchObject({ dispute_status: 'WON', payout_status: 'HELD', payout_tentativo: 1 });
  });

  it('vinta, rimessa in coda del negozio caduta a metà: il secondo passaggio non alza il tentativo due volte', async () => {
    stato.evento = {
      id: 'evt_dispute_won_2',
      type: 'charge.dispute.closed',
      data: { object: { id: 'dp_1', status: 'won', payment_intent: 'pi_1', charge: 'ch_1' } },
    };
    stato.db.tabelle.orders = [
      ordine({ id: 'o1', payout_status: 'REVERSED', dispute_status: 'OPEN', seller_payout_reversed_cents: 3240 }),
      ordine({ id: 'o2', seller_id: 's2', payout_status: 'REVERSED', dispute_status: 'OPEN', seller_payout_reversed_cents: 1000 }),
    ];
    // Il primo ordine torna in coda, il secondo no.
    stato.db.guasto = (s) =>
      (s.valori as Riga | null)?.payout_status === 'HELD' && riga('orders', 'o1')?.payout_status === 'HELD' ? TIMEOUT : null;
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);
    expect(riga('orders', 'o1')?.payout_tentativo, 'tentativo alzato due volte sullo stesso ordine').toBe(1);
    expect(riga('orders', 'o2')).toMatchObject({ payout_status: 'HELD', payout_tentativo: 1 });
  });

  it('persa: se Stripe ripete l evento, la merce torna a scaffale una volta sola', async () => {
    // La variante scomoda del rimedio: adesso un errore fa ripetere l'evento,
    // e `restore_stock_for_order` non ha un segno di «già fatto».
    stato.evento = {
      id: 'evt_dispute_lost',
      type: 'charge.dispute.closed',
      data: { object: { id: 'dp_1', status: 'lost', payment_intent: 'pi_1', charge: 'ch_1' } },
    };
    stato.db.tabelle.orders = [ordine({ delivery_status: 'OUT_FOR_DELIVERY', dispute_status: 'OPEN' })];
    // Tutto riesce tranne la marcatura finale dell'evento: Stripe riprova.
    stato.db.guasto = (s) => (s.tabella === 'stripe_event_log' && (s.valori as Riga | null)?.processed === true ? TIMEOUT : null);
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);

    const scaffale = stato.db.rpc.filter((r) => r.nome === 'restore_stock_for_order');
    expect(scaffale, 'merce rimessa in vendita due volte: prodotti fantasma').toHaveLength(1);
    expect(riga('orders')).toMatchObject({ dispute_status: 'LOST', delivery_status: 'CANCELED' });
  });
});

describe('gli altri gestori che muovono soldi', () => {
  it('storno di un bonifico non registrato: Stripe riprova', async () => {
    stato.evento = {
      id: 'evt_tr',
      type: 'transfer.reversed',
      data: { object: { id: 'tr_9', amount: 3240, amount_reversed: 3240 } },
    };
    stato.db.tabelle.orders = [ordine({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_9' })];
    stato.db.guasto = (s) => ((s.valori as Riga | null)?.payout_status === 'REVERSED' ? TIMEOUT : null);
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);
    expect(riga('orders')?.payout_status).toBe('REVERSED');
  });

  it('abbonamento da 50 € pagato e attivazione non scritta: Stripe riprova', async () => {
    stato.evento = {
      id: 'evt_sub',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sub', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1',
          metadata: { kind: 'seller_subscription', seller_id: 's1' },
        },
      },
    };
    stato.db.tabelle.profiles!.push({ id: 's1', role: 'seller', subscription_status: 'canceled' });
    stato.db.guasto = (s) => (s.tabella === 'profiles' ? TIMEOUT : null);
    expect((await consegna()).status, 'abbonamento pagato e mai attivato, senza nessun nuovo tentativo').toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);
    expect(riga('profiles', 's1')?.subscription_status).toBe('active');
  });

  it('una campanella che non parte NON fa ripetere l attivazione dell abbonamento', async () => {
    stato.evento = {
      id: 'evt_sub_2',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_sub', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1',
          metadata: { kind: 'seller_subscription', seller_id: 's1' },
        },
      },
    };
    stato.db.tabelle.profiles!.push({ id: 's1', role: 'seller', subscription_status: 'canceled' });
    stato.db.guasto = (s) => (s.tabella === 'notifications' ? TIMEOUT : null);
    expect((await consegna()).status).toBe(200);
    expect(riga('profiles', 's1')?.subscription_status).toBe('active');
  });

  it('cambio di stato dell abbonamento non scritto: Stripe riprova', async () => {
    stato.evento = {
      id: 'evt_sub_upd',
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'past_due', current_period_end: 1_900_000_000 } },
    };
    stato.db.tabelle.profiles!.push({ id: 's1', role: 'seller', stripe_subscription_id: 'sub_1', subscription_status: 'active' });
    stato.db.guasto = (s) => (s.tabella === 'profiles' ? TIMEOUT : null);
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);
  });

  it('carta dell abbonamento rifiutata e stato non scritto: Stripe riprova, non «nessun negozio»', async () => {
    stato.evento = {
      id: 'evt_inv',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', customer: 'cus_1' } },
    };
    stato.db.tabelle.profiles!.push({ id: 's1', role: 'seller', stripe_customer_id: 'cus_1', subscription_status: 'active' });
    stato.db.guasto = (s) => (s.tabella === 'profiles' ? TIMEOUT : null);
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);
    expect(riga('profiles', 's1')?.subscription_status).toBe('past_due');
  });

  it('versamenti del negozio bloccati da Stripe e non scritti: Stripe riprova', async () => {
    stato.evento = {
      id: 'evt_acct',
      type: 'account.updated',
      data: { object: { id: 'acct_1', charges_enabled: true, payouts_enabled: false, details_submitted: true } },
    };
    stato.db.tabelle.profiles!.push({ id: 's1', role: 'seller', stripe_account_id: 'acct_1', stripe_payouts_enabled: true });
    stato.db.guasto = (s) => (s.tabella === 'profiles' ? TIMEOUT : null);
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);
    expect(riga('profiles', 's1')?.stripe_payouts_enabled, 'il database dice ancora «versamenti abilitati»').toBe(false);
  });
});

describe('il carrello pagato', () => {
  it('ordine creato ma carrello non segnato come completato: Stripe riprova, e il negozio è avvisato una volta sola', async () => {
    // La variante scomoda: il secondo passaggio trova gli ordini già nati e non
    // manda più gli avvisi. Se la scrittura che fallisce venisse PRIMA degli
    // avvisi, il negozio non saprebbe mai di avere un ordine.
    stato.evento = {
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', payment_intent: 'pi_1',
          amount_total: 2790, customer_details: { email: 'cliente@example.com', name: 'Cliente' }, metadata: {},
        },
      },
    };
    stato.db.tabelle.pending_checkouts = [{
      id: 'pc_1', buyer_id: 'u1', status: 'PENDING', coupon_code: null, pickup_in_store: false, total_cents: 2790,
      stripe_session_id: 'cs_1', expires_at: '2999-01-01T00:00:00Z',
      delivery: { full_name: 'Cliente', address: 'Via Roma 1', city: 'Piacenza', zip: '29121', phone: '1', notes: null, lat: null, lng: null },
      groups: [{
        sellerId: 's1', storeName: 'Pane Quotidiano', subtotalCents: 2000, shippingCents: 490, deliveryFeeCents: 300,
        couponPortionCents: 0, pickupPortionCents: 0, totalCents: 2790,
        items: [{ productId: 'p1', name: 'Focaccia', quantity: 1, unitAmountCents: 2000 }],
      }],
    }];
    stato.db.unici.orders = [['stripe_session_id', 'seller_id']];
    stato.db.guasto = (s) =>
      s.tabella === 'pending_checkouts' && (s.valori as Riga | null)?.status === 'COMPLETED' ? TIMEOUT : null;

    expect((await consegna()).status, 'carrello rimasto aperto senza nuovo tentativo').toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);

    expect(stato.db.tabelle.orders, 'ordine creato due volte').toHaveLength(1);
    expect(riga('pending_checkouts', 'pc_1')?.status).toBe('COMPLETED');
    const campanelle = stato.db.tabelle.notifications!.filter((n) => n.user_id === 's1');
    expect(campanelle, 'il negozio non sa di avere un ordine, o lo sa due volte').toHaveLength(1);
  });
});

describe('la rotta stessa', () => {
  it('se non riesce a segnare l evento come lavorato, risponde 5xx e restituisce il turno', async () => {
    stato.evento = {
      id: 'evt_tr_2',
      type: 'transfer.reversed',
      data: { object: { id: 'tr_9', amount: 3240, amount_reversed: 3240 } },
    };
    stato.db.tabelle.orders = [ordine({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_9' })];
    stato.db.guasto = (s) => (s.tabella === 'stripe_event_log' && (s.valori as Riga | null)?.processed === true ? TIMEOUT : null);

    const risposta = await consegna();

    expect(risposta.status).toBeGreaterThanOrEqual(500);
    expect(registro()?.claimed_at).toBeNull();
  });

  it('se la rivendicazione del turno va in errore, non risponde «già visto»', async () => {
    stato.evento = {
      id: 'evt_retry',
      type: 'transfer.reversed',
      data: { object: { id: 'tr_9', amount: 3240, amount_reversed: 3240 } },
    };
    // Un primo tentativo fallito ha lasciato la riga non lavorata.
    stato.db.tabelle.stripe_event_log = [{ event_id: 'evt_retry', processed: false, claimed_at: null }];
    stato.db.tabelle.orders = [ordine({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_9' })];
    stato.db.guasto = (s) => (s.tabella === 'stripe_event_log' && s.operazione === 'update' ? TIMEOUT : null);

    const risposta = await consegna();

    expect(risposta.status, 'con 200 «duplicated» Stripe considera l avviso consegnato e l evento si perde').toBeGreaterThanOrEqual(500);
    expect(riga('orders')?.payout_status, 'gestore partito senza turno').toBe('TRANSFERRED');
  });

  it('sessione completata ma non pagata: se la chiusura non si scrive, Stripe riprova', async () => {
    stato.evento = {
      id: 'evt_np',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_np', payment_status: 'unpaid', metadata: {} } },
    };
    stato.db.guasto = (s) => (s.tabella === 'stripe_event_log' && (s.valori as Riga | null)?.processed === true ? TIMEOUT : null);
    expect((await consegna()).status).toBeGreaterThanOrEqual(500);
    expect(registro()?.claimed_at).toBeNull();
  });
});
