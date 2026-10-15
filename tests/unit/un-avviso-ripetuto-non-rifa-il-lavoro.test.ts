import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';
import { logger } from '@/lib/logger';

/**
 * 15/10/2026 (R81, secondo giro di collaudo) — FAR RIPETERE UN AVVISO A STRIPE
 * È SICURO SOLO SE IL SECONDO PASSAGGIO NON RIFÀ IL LAVORO DEL PRIMO.
 *
 * Il primo giro di R81 aveva acceso il «se il database sbaglia, Stripe
 * riprova». Il collaudo ha trovato tre punti dove il secondo passaggio rifaceva
 * il lavoro, e li ha misurati sul codice vero:
 *
 *   ① CONTESTAZIONE PARZIALE: 20 € contestati su un ordine da 40 € già pagato
 *     al negozio. Lo storno registrato al primo passaggio lascia l'ordine
 *     'TRANSFERRED' e la chiave anti-doppione porta il totale stornato: al
 *     secondo passaggio la chiave è nuova e Stripe fa un secondo storno. Al
 *     negozio 32,40 € tolti invece di 16,20.
 *   ② RIMBORSO RESPINTO DALLA BANCA: il segno «lavorato» sull'avviso cade, la
 *     rotta risponde 500, il gestore ripete e toglie DUE volte i 5 € tornati:
 *     l'ordine risulta rimborsato 0 mentre su Stripe ne restano 5.
 *   ③ QUADRATURA FALLITA SENZA LA MIGRAZIONE 126 (com'è oggi la produzione): il
 *     ripiego verso 'CANCELED' non scattava, la rotta rispondeva 500 per sempre
 *     e a ogni ripetizione partiva un altro avviso agli amministratori.
 *
 * Questa prova fa girare la rotta VERA, i gestori VERI e lo storno VERO
 * (`reverseOrderTransfer`), con un database finto che sbaglia la scrittura
 * scelta e uno Stripe finto che, come quello vero, restituisce lo stesso storno
 * per la stessa chiave e sa elencare gli storni di un bonifico.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

/** Quando è nata la contestazione, e quando nascono gli storni fatti adesso (secondi). */
const NATA_LA_CONTESTAZIONE = 1_700_000_000;
const ADESSO = 1_800_000_000;

type Storno = { id: string; transferId: string; amount: number; chiave: string; created: number; metadata: Record<string, string> };
const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
  storni: Storno[];
  rimborsi: Array<{ amount: number | undefined; chiave: string }>;
  /** Quante risposte di Stripe a uno storno si perdono per strada, dopo averlo fatto. */
  stornoSenzaRisposta: number;
} = {
  db: fintoDatabase(),
  evento: { id: 'evt_x', type: 'noop', data: { object: {} } },
  storni: [],
  rimborsi: [],
  stornoSenzaRisposta: 0,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ contaAcquisto: vi.fn(async () => {}), analyticsConsentita: vi.fn(async () => false) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    transfers: {
      // Stripe vero: la stessa chiave anti-doppione restituisce lo STESSO storno.
      createReversal: async (
        transferId: string,
        params: { amount: number; metadata?: Record<string, string> },
        opzioni: { idempotencyKey: string },
      ) => {
        let gia = stato.storni.find((s) => s.chiave === opzioni.idempotencyKey);
        if (!gia) {
          gia = {
            id: `trr_${stato.storni.length + 1}`, transferId, amount: params.amount,
            chiave: opzioni.idempotencyKey, created: ADESSO, metadata: params.metadata ?? {},
          };
          stato.storni.push(gia);
        }
        if (stato.stornoSenzaRisposta > 0) {
          stato.stornoSenzaRisposta -= 1;
          throw new Error('socket hang up');
        }
        return { id: gia.id, amount: gia.amount, created: gia.created };
      },
      listReversals: async (transferId: string) => ({
        data: stato.storni.filter((s) => s.transferId === transferId).map((s) => ({ ...s })),
        has_more: false,
      }),
    },
    refunds: {
      create: async (p: { amount?: number }, o: { idempotencyKey: string }) => {
        if (!stato.rimborsi.some((r) => r.chiave === o.idempotencyKey)) stato.rimborsi.push({ amount: p.amount, chiave: o.idempotencyKey });
        return { id: `re_${o.idempotencyKey}` };
      },
      list: async () => ({ data: [], has_more: false }),
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

/** Ordine da 40 € già pagato al negozio: al negozio erano andati 32,40 €. */
function ordinePagatoAlNegozio(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    seller_id: 's1',
    user_id: 'u1',
    total_price: 40,
    gross_total_cents: 4000,
    refunded_amount_cents: 0,
    payment_method: 'card',
    payment_status: 'PAID',
    delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED',
    dispute_status: null,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_transfer_id: 'tr_1',
    stripe_reversal_id: null,
    seller_payout_cents: 3240,
    seller_payout_reversed_cents: 0,
    dispute_seller_reversed_cents: null,
    payout_tentativo: 0,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_fee_cents: null,
    ...extra,
  };
}

const ordine = (id = 'o1') => stato.db.tabelle.orders!.find((r) => r.id === id)!;
const registro = () => stato.db.tabelle.stripe_event_log?.find((r) => r.event_id === stato.evento.id);
const avvisi = (titolo: string) => stato.db.tabelle.notifications!.filter((n) => n.title === titolo);
const segnoLavoratoCade = () => (s: { tabella: string; valori: unknown }) =>
  s.tabella === 'stripe_event_log' && (s.valori as Riga | null)?.processed === true ? TIMEOUT : null;
/** Stripe consegna di nuovo lo stesso avviso, dopo che il turno di cinque minuti è scaduto. */
async function stripeLoRimandaDopo(): Promise<Response> {
  const r = registro();
  if (r) r.claimed_at = '2000-01-01T00:00:00.000Z';
  return consegna();
}

beforeEach(() => {
  vi.mocked(logger.error).mockClear();
  stato.storni = [];
  stato.rimborsi = [];
  stato.stornoSenzaRisposta = 0;
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    stripe_event_log: [],
    pending_checkouts: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
  // L'email al cliente dopo un rimborso legge l'indirizzo dagli utenti.
  Object.assign(stato.db.client, {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'cliente@example.com' } } }) } },
  });
});

describe('① contestazione PARZIALE ripetuta: al negozio si toglie una volta sola', () => {
  beforeEach(() => {
    stato.evento = {
      id: 'evt_dp_parziale',
      type: 'charge.dispute.created',
      data: { object: { id: 'dp_1', amount: 2000, payment_intent: 'pi_1', charge: 'ch_1', created: NATA_LA_CONTESTAZIONE } },
    };
    stato.db.tabelle.orders = [ordinePagatoAlNegozio()];
  });

  it('IL CASO DEL COLLAUDO (A1) — la scrittura OPEN va in timeout, Stripe ripete: uno storno da 16,20 €, non due', async () => {
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && (s.valori as Riga | null)?.dispute_status === 'OPEN' ? TIMEOUT : null;
    expect((await consegna()).status, 'la contestazione non scritta deve far riprovare Stripe').toBeGreaterThanOrEqual(500);

    stato.db.guasto = () => null;
    expect((await consegna()).status).toBe(200);

    expect(stato.storni.map((s) => s.amount), 'storno parziale ripetuto con una chiave nuova').toEqual([1620]);
    expect(ordine()).toMatchObject({
      dispute_status: 'OPEN', payout_status: 'TRANSFERRED',
      seller_payout_reversed_cents: 1620, dispute_seller_reversed_cents: 1620,
    });
  });

  it('IL CASO DEL COLLAUDO (A2) — cade solo il segno «lavorato»: Stripe NON ripete, e un doppione dopo cinque minuti non storna di nuovo', async () => {
    stato.db.guasto = segnoLavoratoCade();
    expect((await consegna()).status, 'un lavoro fatto non si fa ripetere').toBe(200);
    expect(registro()?.processed).toBe(false);
    expect(vi.mocked(logger.error).mock.calls.map((c) => String(c[0]))).toContain(
      '[stripe] lavoro fatto ma non segnato: non lo faccio ripetere',
    );

    stato.db.guasto = () => null;
    expect((await stripeLoRimandaDopo()).status).toBe(200);

    expect(stato.storni.map((s) => s.amount)).toEqual([1620]);
    expect(ordine()).toMatchObject({ seller_payout_reversed_cents: 1620, dispute_seller_reversed_cents: 1620 });
  });

  it('processo morto dopo OPEN e prima dello storno: al giro dopo lo storno si fa (lo storno vecchio di un reso non conta)', async () => {
    // Un reso di settimane prima aveva già ripreso 5 € al negozio, con uno
    // storno nato PRIMA della contestazione.
    stato.storni.push({
      id: 'trr_reso', transferId: 'tr_1', amount: 500, chiave: 'reversal_o1_tot_500',
      created: NATA_LA_CONTESTAZIONE - 86_400, metadata: { order_id: 'o1' },
    });
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({
      dispute_status: 'OPEN', seller_payout_reversed_cents: 500, stripe_reversal_id: 'trr_reso',
    })];

    expect((await consegna()).status).toBe(200);

    expect(stato.storni.map((s) => s.amount), 'la contestazione non ha ripreso niente al negozio').toEqual([500, 1620]);
    expect(ordine().seller_payout_reversed_cents).toBe(2120);
  });

  it('storno fatto su Stripe ma non scritto da noi, e chiave anti-doppione già scaduta: non si rifà, e si grida nei log', async () => {
    // Stripe ricorda una chiave anti-doppione per 24 ore, e ripete un avviso
    // per tre giorni: dopo un giorno la stessa chiave fa uno storno NUOVO.
    stato.storni.push({
      id: 'trr_perso', transferId: 'tr_1', amount: 1620, chiave: 'chiave dimenticata da Stripe dopo 24 ore',
      created: NATA_LA_CONTESTAZIONE + 5, metadata: { order_id: 'o1' },
    });
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({ dispute_status: 'OPEN' })];

    expect((await consegna()).status).toBe(200);

    expect(stato.storni.map((s) => s.amount)).toEqual([1620]);
    expect(vi.mocked(logger.error).mock.calls.map((c) => String(c[0]))).toContain(
      '[stripe] storno della contestazione fatto su Stripe ma non registrato sull ordine',
    );
    // Collaudo giro 2: non solo nei log. Senza registrazione, a contestazione
    // vinta il negozio non verrebbe ripagato: l'amministratore deve saperlo.
    const avviso = avvisi('⚠️ Storno al negozio da controllare');
    expect(avviso).toHaveLength(1);
    expect(String(avviso[0].body)).toMatch(/16,20\s€.*trr_perso.*Non va rifatto/);
  });

  it('la risposta di Stripe allo storno si perde per strada: gli amministratori sanno di guardare PRIMA di rifarlo', async () => {
    // Lo storno su Stripe c'è, ma per noi è un errore: nel database l'ordine
    // resta com'era. Un «recuperalo a mano» secco farebbe stornare due volte.
    stato.stornoSenzaRisposta = 1;
    expect((await consegna()).status).toBe(200);

    expect(stato.storni.map((s) => s.amount)).toEqual([1620]);
    const avviso = avvisi('⚠️ Storno al negozio da controllare');
    expect(avviso, 'l errore restava solo nei log').toHaveLength(1);
    expect(String(avviso[0].body)).toMatch(/guarda su Stripe.*può esserci già/);
    expect(avvisi('⚠️ Chargeback aperto')).toHaveLength(1);
  });

  it('un doppione non cancella il promemoria del primo passaggio, che alla vittoria serve a ripagare il negozio', async () => {
    // Contestazione PIENA: il venditore è già 'REVERSED', il fattorino no.
    stato.evento.data.object.amount = 4000;
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({
      dispute_status: 'OPEN', payout_status: 'REVERSED', seller_payout_reversed_cents: 3240,
      dispute_seller_reversed_cents: 3240,
      rider_id: 'r1', rider_transfer_id: 'tr_rider', rider_payout_status: 'TRANSFERRED', rider_fee_cents: 300,
    })];

    expect((await consegna()).status).toBe(200);

    expect(ordine()).toMatchObject({ dispute_seller_reversed_cents: 3240, dispute_rider_reversed_cents: 300 });
  });
});

describe('② rimborso respinto dalla banca: il segno «lavorato» che cade non fa ripetere il gestore', () => {
  it('IL CASO DEL COLLAUDO (B1) — due rimborsi da 5 €, la banca ne respinge uno: resta rimborsato 5 €, non 0', async () => {
    stato.evento = {
      id: 'evt_refund_failed',
      type: 'charge.refund.updated',
      data: { object: { id: 're_2', status: 'failed', amount: 500, payment_intent: 'pi_1', metadata: { order_id: 'o1' } } },
    };
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({
      payout_status: 'HELD', stripe_transfer_id: null, refunded_amount_cents: 1000, payment_status: 'PARTIALLY_REFUNDED',
    })];
    stato.db.guasto = segnoLavoratoCade();

    expect((await consegna()).status).toBe(200);

    expect(ordine()).toMatchObject({ refunded_amount_cents: 500, payment_status: 'PARTIALLY_REFUNDED' });
  });
});

describe('③ quadratura fallita sul database di oggi, senza la migrazione 126', () => {
  /** L'errore vero di PostgreSQL 16 sulla tabella della 042 (misurato dal collaudo con psql). */
  const VINCOLO_VECCHIO = {
    code: '23514',
    message: 'new row for relation "pending_checkouts" violates check constraint "pending_checkouts_status_check"',
  };

  beforeEach(() => {
    stato.evento = {
      id: 'evt_quadratura',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', payment_intent: 'pi_1',
          amount_total: 3000, customer_details: { email: 'cliente@example.com', name: 'Cliente' }, metadata: {},
        },
      },
    };
    stato.db.tabelle.pending_checkouts = [{
      id: 'pc_1', buyer_id: 'u1', status: 'PENDING', coupon_code: null, pickup_in_store: false, total_cents: 2790,
      stripe_session_id: 'cs_1', expires_at: '2999-01-01T00:00:00Z', delivery: {}, groups: [],
    }];
  });

  it('IL CASO DEL COLLAUDO — il ripiego scatta: carrello CANCELED, un 200, un avviso, un rimborso', async () => {
    stato.db.guasto = (s) =>
      s.tabella === 'pending_checkouts' && (s.valori as Riga | null)?.status === 'MISMATCH' ? VINCOLO_VECCHIO : null;

    const stati = [(await consegna()).status];
    // Se avesse risposto 500 Stripe riproverebbe: lo simuliamo, e non deve servire.
    if (stati[0] >= 500) stati.push((await consegna()).status);

    expect(stati, 'la quadratura fallita gira in tondo con risposte 500').toEqual([200]);
    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('CANCELED');
    expect(avvisi('⚠️ Incasso diverso dal preventivo')).toHaveLength(1);
    expect(stato.rimborsi.map((r) => r.chiave)).toEqual(['refund_quadratura_pc_1']);
  });

  it('se il carrello non si riesce a segnare per niente, Stripe non ripete lo stesso: il rimborso è partito, il carrello lo chiude il giro', async () => {
    stato.db.guasto = (s) => (s.tabella === 'pending_checkouts' ? TIMEOUT : null);

    expect((await consegna()).status).toBe(200);

    expect(avvisi('⚠️ Incasso diverso dal preventivo')).toHaveLength(1);
    expect(stato.rimborsi).toHaveLength(1);
    // Resta PENDING: il giro `expire-checkouts` lo chiude alla scadenza.
    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('PENDING');
  });

  it('con la migrazione 126 il carrello diventa MISMATCH, come prima', async () => {
    expect((await consegna()).status).toBe(200);
    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('MISMATCH');
  });
});

describe('④ le altre forme trovate dal collaudo: letture cadute e merce che non torna in vendita', () => {
  it('rimborso PIENO dal cruscotto con la lettura degli ordini caduta: Stripe riprova, e al secondo giro si registra', async () => {
    stato.evento = {
      id: 'evt_rimborso_pieno',
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount: 4000, amount_refunded: 4000 } },
    };
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({ payout_status: 'HELD', stripe_transfer_id: null })];
    stato.db.guastoLettura = (t) => (t === 'orders' ? TIMEOUT : null);
    expect((await consegna()).status, 'una lettura caduta valeva «nessun ordine»: rimborso mai registrato').toBeGreaterThanOrEqual(500);
    expect(ordine().payment_status).toBe('PAID');

    stato.db.guastoLettura = () => null;
    expect((await consegna()).status).toBe(200);
    expect(ordine()).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED', refunded_amount_cents: 4000 });
  });

  it('rimborso pieno con la merce che non torna a scaffale: gli amministratori lo sanno', async () => {
    stato.evento = {
      id: 'evt_rimborso_pieno_2',
      type: 'charge.refunded',
      data: { object: { id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount: 4000, amount_refunded: 4000 } },
    };
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({ payout_status: 'HELD', stripe_transfer_id: null, delivery_status: 'ACCEPTED' })];
    stato.db.rispostaRpc = (nome) => (nome === 'restore_stock_for_order' ? { data: null, error: TIMEOUT } : { data: null, error: null });

    expect((await consegna()).status).toBe(200);
    expect(avvisi('⚠️ Merce non rimessa in vendita'), 'merce tolta dalla vendita per sempre, senza che nessuno lo sappia').toHaveLength(1);
  });

  it('carrello abbandonato con la merce che non torna in vendita: gli amministratori lo sanno', async () => {
    stato.evento = {
      id: 'evt_scaduto',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_9', client_reference_id: 'pc_9', metadata: {} } },
    };
    stato.db.tabelle.pending_checkouts = [{
      id: 'pc_9', status: 'PENDING', coupon_code: null,
      groups: [{ sellerId: 's1', items: [{ productId: 'p1', quantity: 2 }] }],
    }];
    stato.db.rispostaRpc = (nome) => (nome === 'restore_stock' ? { data: null, error: TIMEOUT } : { data: null, error: null });

    expect((await consegna()).status).toBe(200);
    expect(stato.db.tabelle.pending_checkouts![0].status).toBe('EXPIRED');
    expect(avvisi('⚠️ Merce non rimessa in vendita')).toHaveLength(1);
  });

  it('pagamento su una riserva scaduta con la lettura degli ordini caduta: niente rimborso alla cieca, Stripe riprova', async () => {
    stato.evento = {
      id: 'evt_riserva_scaduta',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_7', payment_status: 'paid', client_reference_id: 'pc_7', payment_intent: 'pi_7', amount_total: 2790, metadata: {} } },
    };
    stato.db.tabelle.pending_checkouts = [{
      id: 'pc_7', buyer_id: 'u1', status: 'EXPIRED', coupon_code: null, pickup_in_store: false, total_cents: 2790,
      stripe_session_id: 'cs_7', expires_at: '2000-01-01T00:00:00Z', delivery: {}, groups: [],
    }];
    // Il negozio sta già preparando l'ordine: la lettura che lo dice va in timeout.
    stato.db.tabelle.orders = [ordinePagatoAlNegozio({ id: 'o7', stripe_session_id: 'cs_7', payout_status: 'HELD' })];
    stato.db.guastoLettura = (t) => (t === 'orders' ? TIMEOUT : null);

    expect((await consegna()).status).toBeGreaterThanOrEqual(500);
    expect(stato.rimborsi, 'cliente rimborsato a merce in lavorazione').toEqual([]);
  });
});
