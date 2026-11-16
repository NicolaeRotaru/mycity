import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * R25-001 — SE IL CLIENTE VIENE RIMBORSATO PRIMA CHE IL SUO ORDINE NASCA.
 *
 * L'avviso «pagamento completato» fallisce e Stripe lo ripete per ore. Nel frattempo la cliente
 * chiama perché non vede l'ordine, e Nicola la rimborsa dal cruscotto. L'avviso del rimborso non
 * trovava ordini e usciva bene; poi l'avviso del pagamento passava e l'ordine nasceva PAID/HELD:
 * il forno preparava e il giro dei bonifici gli versava il netto. La cliente aveva merce e soldi.
 *
 * Qui il gestore vero (`lib/stripe/webhook/ordini.ts`, `lib/stripe/webhook/rimborsi.ts`) gira su
 * un database finto in memoria e su uno Stripe finto: si guarda cosa resta scritto.
 * Il caso del collaudo K04 (carrello di due negozi, il sito rende A, il cruscotto rende il resto:
 * la carta dice refunded=true) è il terzo.
 */

type Riga = Record<string, unknown>;
const db: Record<string, Riga[]> = {};
const rpc: Array<{ nome: string; args: unknown }> = [];
let carica: Partial<Stripe.Charge> | string = 'ch_1';
let creaRimborso: (...a: unknown[]) => Promise<unknown> = async () => ({ id: 're_x' });
/** I rimborsi che Stripe elenca per il pagamento (`refunds.list`). */
let rimborsiSuStripe: Array<Record<string, unknown>> = [];

function tabella(nome: string): Riga[] {
  db[nome] ??= [];
  return db[nome];
}

/** Un costruttore di query alla PostgREST, in memoria. Un metodo che non conosco non filtra. */
function query(nome: string) {
  let modo: 'select' | 'insert' | 'update' | 'delete' = 'select';
  let righeNuove: Riga[] = [];
  let valori: Riga = {};
  let uno: 'single' | 'maybe' | null = null;
  const filtri: Array<(r: Riga) => boolean> = [];
  const esegui = () => {
    const t = tabella(nome);
    const scelte = () => t.filter((r) => filtri.every((f) => f(r)));
    let data: Riga[] = [];
    if (modo === 'insert') {
      for (const r of righeNuove) {
        if (nome === 'orders' && t.some((o) => o.stripe_session_id === r.stripe_session_id && o.seller_id === r.seller_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        if (r.id && t.some((o) => o.id === r.id)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      data = righeNuove.map((r) => ({ id: `${nome}_${t.length + 1}`, ...(nome === 'orders' ? { refunded_amount_cents: 0, seller_payout_reversed_cents: 0 } : {}), ...r }));
      t.push(...data);
    } else if (modo === 'update') {
      data = scelte();
      for (const r of data) Object.assign(r, valori);
    } else if (modo === 'delete') {
      data = scelte();
      db[nome] = t.filter((r) => !data.includes(r));
    } else {
      data = scelte();
    }
    const copia = data.map((r) => ({ ...r }));
    if (uno === 'single') return copia[0] ? { data: copia[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
    if (uno === 'maybe') return { data: copia[0] ?? null, error: null };
    return { data: copia, error: null };
  };
  // I metodi restituiscono il proxy, così anche un metodo sconosciuto in mezzo alla catena non la rompe.
  let p: Record<string, unknown> = {};
  const b: Record<string, unknown> = {
    select: () => p,
    insert: (r: Riga | Riga[]) => { modo = 'insert'; righeNuove = Array.isArray(r) ? r : [r]; return p; },
    update: (v: Riga) => { modo = 'update'; valori = v; return p; },
    delete: () => { modo = 'delete'; return p; },
    eq: (c: string, v: unknown) => { filtri.push((r) => r[c] === v); return p; },
    in: (c: string, v: unknown[]) => { filtri.push((r) => v.includes(r[c])); return p; },
    single: () => { uno = 'single'; return Promise.resolve(esegui()); },
    maybeSingle: () => { uno = 'maybe'; return Promise.resolve(esegui()); },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(esegui()).then(ok, ko),
  };
  p = new Proxy(b, { get: (o, k: string) => (k in o ? o[k] : () => p) });
  return p;
}

const finto = {
  from: (nome: string) => query(nome),
  rpc: async (nome: string, args: unknown) => {
    rpc.push({ nome, args });
    return { data: nome === 'gift_card_void_for_payment' ? { esito: 'non_trovato' } : null, error: null };
  },
  auth: { admin: { getUserById: async () => ({ data: { user: { email: 'negozio@test.it' } }, error: null }) } },
};

vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => finto }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('next/server', () => ({ after: () => undefined, NextResponse: { json: (b: unknown) => b } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/analytics/server', () => ({ analyticsConsentita: async () => false, contaAcquisto: async () => undefined }));
vi.mock('@/lib/stripe/client', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  getStripe: () => ({
    paymentIntents: { retrieve: async () => ({ id: 'pi_1', latest_charge: carica }) },
    refunds: { list: async () => ({ data: rimborsiSuStripe, has_more: false }), create: async (...a: unknown[]) => creaRimborso(...a), update: async (id: string) => ({ id }) },
  }),
}));

const { handleCheckoutCompleted } = await import('@/lib/stripe/webhook/ordini');
const { handleChargeRefunded } = await import('@/lib/stripe/webhook/rimborsi');

const CONSEGNA = { full_name: 'Maria Rossi', phone: '333', address: 'Via Verdi 10', city: 'Piacenza', zip: '29121', notes: null, lat: null, lng: null, slot: null };
const gruppo = (sellerId: string, cents: number, productId: string) => ({
  sellerId, storeName: sellerId, totalCents: cents, subtotalCents: cents, shippingCents: 0, deliveryFeeCents: 0,
  couponPortionCents: 0, pickupPortionCents: 0, items: [{ productId, name: productId, quantity: 1, unitAmountCents: cents }],
});

function carrello(stato: string, gruppi: ReturnType<typeof gruppo>[]) {
  const totale = gruppi.reduce((s, g) => s + g.totalCents, 0);
  tabella('pending_checkouts').push({
    id: 'pc_1', buyer_id: 'cliente-1', status: stato, groups: gruppi, coupon_code: null, delivery: CONSEGNA,
    pickup_in_store: false, total_cents: totale, stripe_session_id: 'cs_1', expires_at: '2026-11-21T12:00:00Z',
  });
  return { id: 'cs_1', payment_status: 'paid', client_reference_id: 'pc_1', amount_total: totale, payment_intent: 'pi_1', created: 1795262400, customer_details: { email: 'cliente@test.it', name: 'Maria Rossi' }, metadata: {} } as unknown as Stripe.Checkout.Session;
}

const ordiniPagati = () => tabella('orders').filter((o) => o.payment_status === 'PAID' || o.payout_status === 'HELD');
const avvisiAgliAdmin = () => tabella('notifications').filter((n) => n.user_id === 'admin-1');
const campanelleAiNegozi = () => tabella('notifications').filter((n) => n.category === 'order');
const statoDelCarrello = () => tabella('pending_checkouts')[0]?.status;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00+01:00'));
  for (const k of Object.keys(db)) delete db[k];
  rpc.length = 0;
  tabella('profiles').push({ id: 'admin-1', role: 'admin' });
  carica = 'ch_1';
  creaRimborso = async () => ({ id: 're_x' });
  rimborsiSuStripe = [];
});
afterEach(() => vi.useRealTimers());

describe('R25-001 · la carta già tornata al cliente non fa nascere un ordine pagato', () => {
  it('rimborsata per intero dal cruscotto prima dell ordine: nessun ordine pagato, nessun bonifico, lo sa un amministratore', async () => {
    const sessione = carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 3000, refunded: true, disputed: false };

    await handleCheckoutCompleted(sessione);

    expect(ordiniPagati(), 'è nato un ordine pagato su una carta già rimborsata').toEqual([]);
    expect(tabella('orders').filter((o) => o.payout_status === 'HELD'), 'il giro dei bonifici avrebbe un ordine da pagare').toEqual([]);
    expect(campanelleAiNegozi(), 'il forno è stato avvisato di preparare').toEqual([]);
    expect(avvisiAgliAdmin().map((n) => n.title)).toEqual(['⚠️ Pagamento già rimborsato o contestato: nessun ordine']);
    // Il carrello si chiude (non ricomincia al prossimo avviso) e la merce torna in vendita.
    expect(statoDelCarrello()).toBe('EXPIRED');
    expect(rpc.map((r) => r.nome)).toContain('restore_stock');
  });

  it('contestata in banca prima dell ordine: nessun ordine pagato', async () => {
    const sessione = carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 0, refunded: false, disputed: true };

    await handleCheckoutCompleted(sessione);

    expect(ordiniPagati()).toEqual([]);
    expect(campanelleAiNegozi()).toEqual([]);
    expect(avvisiAgliAdmin()).toHaveLength(1);
  });

  it('K04: carrello di due negozi, il sito rende A (20 €) e il cruscotto il resto (30 €): B non nasce pagato', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    // A è nato in un tentativo di prima, poi il sito l'ha rimborsato (refundOrder) e annullato.
    const ordineA = {
      id: 'ordine-a', stripe_session_id: 'cs_1', seller_id: 'negozio-a', payment_status: 'REFUNDED', delivery_status: 'CANCELED',
      payout_status: 'REFUNDED', refunded_amount_cents: 2000, stripe_payment_intent: 'pi_1',
    };
    tabella('orders').push({ ...ordineA });
    // La somma dei rimborsi «da fuori» è 3000 su 5000: è la carta a dire che è tornato tutto.
    carica = {
      id: 'ch_1', amount: 5000, amount_refunded: 5000, refunded: true, disputed: false,
      refunds: { data: [
        { id: 're_sito', amount: 2000, status: 'succeeded', metadata: { order_id: 'ordine-a' } },
        { id: 're_cruscotto', amount: 3000, status: 'succeeded', metadata: {} },
      ] } as unknown as Stripe.Charge['refunds'],
    };

    await handleCheckoutCompleted(sessione);

    expect(tabella('orders').filter((o) => o.seller_id === 'negozio-b'), 'B è nato su una carta rimborsata per intero').toEqual([]);
    expect(campanelleAiNegozi()).toEqual([]);
    // A non si tocca: l'ha già sistemato chi l'ha rimborsato.
    expect(tabella('orders').find((o) => o.id === 'ordine-a')).toEqual(ordineA);
    expect(avvisiAgliAdmin()).toHaveLength(1);
    // Con un ordine già nato il carrello non si chiude da solo: resta aperto e si guarda a mano.
    expect(statoDelCarrello()).toBe('PENDING');
  });

  it('K04 primo collaudo: il sito ha reso solo A (rimborso parziale della carta): B nasce come sempre', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    tabella('orders').push({ id: 'ordine-a', stripe_session_id: 'cs_1', seller_id: 'negozio-a', payment_status: 'REFUNDED', delivery_status: 'CANCELED', payout_status: 'REFUNDED' });
    carica = { id: 'ch_1', amount: 5000, amount_refunded: 2000, refunded: false, disputed: false };

    await handleCheckoutCompleted(sessione);

    const b = tabella('orders').find((o) => o.seller_id === 'negozio-b');
    expect(b).toMatchObject({ payment_status: 'PAID', delivery_status: 'NEW', payout_status: 'HELD' });
    expect(statoDelCarrello()).toBe('COMPLETED');
  });

  it.each(['CANCELED', 'MISMATCH'])('un carrello %s è finale come COMPLETED: nessun ordine, e lo sa un amministratore', async (stato) => {
    const sessione = carrello(stato, [gruppo('pane-quotidiano', 3000, 'pane')]);
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 0, refunded: false, disputed: false };

    await handleCheckoutCompleted(sessione);

    expect(tabella('orders'), `un carrello ${stato} ha fatto nascere un ordine`).toEqual([]);
    expect(avvisiAgliAdmin().map((n) => n.title)).toEqual(['⚠️ Pagamento su un carrello già chiuso']);
    expect(statoDelCarrello()).toBe(stato);
  });
});

describe('R25-001 · il rimborso arrivato prima dell ordine non si perde in silenzio', () => {
  const rimborso = (extra: Partial<Stripe.Charge>) =>
    ({ id: 'ch_1', payment_intent: 'pi_1', amount: 3000, amount_refunded: 3000, refunded: true, metadata: {}, transfer_group: null, ...extra }) as unknown as Stripe.Charge;

  it('carrello ancora aperto: l avviso del rimborso risponde errore, così Stripe lo ripete quando l ordine c è', async () => {
    carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    await expect(handleChargeRefunded(rimborso({ metadata: { pending_checkout_id: 'pc_1' } }))).rejects.toThrow(/pc_1/);
  });

  it('anche un rimborso parziale, riconosciuto dal gruppo dei bonifici del carrello', async () => {
    carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    await expect(handleChargeRefunded(rimborso({ refunded: false, amount_refunded: 1000, transfer_group: 'mc_pc_1' }))).rejects.toThrow(/pc_1/);
  });

  it('carrello già chiuso senza ordini (rimborso fatto dal sito): nessun errore, non si ripete per niente', async () => {
    carrello('EXPIRED', [gruppo('pane-quotidiano', 3000, 'pane')]);
    await expect(handleChargeRefunded(rimborso({ metadata: { pending_checkout_id: 'pc_1' } }))).resolves.toBeUndefined();
  });

  it('la sequenza intera: rimborso respinto, ordine non nato, rimborso ripetuto lavorato', async () => {
    const sessione = carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    const r = rimborso({ metadata: { pending_checkout_id: 'pc_1' } });
    await expect(handleChargeRefunded(r)).rejects.toThrow(/pc_1/);
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 3000, refunded: true, disputed: false };
    await handleCheckoutCompleted(sessione);
    await expect(handleChargeRefunded(r)).resolves.toBeUndefined();
    expect(ordiniPagati()).toEqual([]);
  });
});

// Giro di correzione C1 (revisore V1): gli scenari che la prima riparazione lasciava aperti.
describe('R25-001 · C1 · ordini già nati, carrello scaduto, richiesta di informazioni', () => {
  const ordineA = (extra: Record<string, unknown>) => ({
    id: 'ordine-a', stripe_session_id: 'cs_1', seller_id: 'negozio-a', user_id: 'cliente-1', payment_status: 'PAID', delivery_status: 'NEW',
    payout_status: 'HELD', total_price: 20, refunded_amount_cents: 0, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_charge_id: 'ch_1', stripe_refund_id: null, internal_dispute_status: null, stripe_transfer_id: null, ...extra,
  });
  const rimborsoDi50 = (rimborsato: number, rimborsi: Array<Record<string, unknown>>) => ({
    id: 'ch_1', payment_intent: 'pi_1', amount: 5000, amount_refunded: rimborsato, refunded: rimborsato >= 5000, disputed: false,
    metadata: { pending_checkout_id: 'pc_1' }, transfer_group: 'mc_pc_1', refunds: { data: rimborsi, has_more: false },
  }) as unknown as Stripe.Charge;
  const fermi = () => tabella('orders').filter((o) => o.internal_dispute_status === 'RIMBORSO_DA_RIPARTIRE').map((o) => o.seller_id);

  it('V1-A carrello scaduto dal giro, carta già rimborsata dal cruscotto: nessun secondo rimborso, un avviso, e Stripe smette di ripetere', async () => {
    const sessione = carrello('EXPIRED', [gruppo('pane-quotidiano', 3000, 'pane')]);
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 3000, refunded: true, disputed: false };
    // Stripe vero: un pagamento già rimborsato per intero non si rimborsa di nuovo.
    creaRimborso = async () => { throw Object.assign(new Error('Charge ch_1 has already been refunded.'), { code: 'charge_already_refunded', type: 'StripeInvalidRequestError' }); };
    for (let i = 0; i < 3; i++) await expect(handleCheckoutCompleted(sessione), `tentativo ${i + 1}: Stripe ripete per tre giorni`).resolves.toBeUndefined();
    expect(tabella('orders')).toEqual([]);
    expect(avvisiAgliAdmin().map((n) => n.title)).toContain('⚠️ Pagamento su carrello scaduto già rimborsato');
    expect(avvisiAgliAdmin().map((n) => n.title)).not.toContain('⚠️ Pagamento su carrello scaduto');
  });

  it('V1-A un altro rifiuto di Stripe sul carrello scaduto si ripete ancora (500)', async () => {
    const sessione = carrello('EXPIRED', [gruppo('pane-quotidiano', 3000, 'pane')]);
    creaRimborso = async () => { throw Object.assign(new Error('rete giù'), { code: 'api_connection_error' }); };
    await expect(handleCheckoutCompleted(sessione)).rejects.toThrow('rete giù');
  });

  // C2 — Questi due cambiano di proposito: con A già nato il rimborso non si ripete più (un carrello pagato a metà resta
  // PENDING per sempre, V1b-1). A si ferma subito, e B, che nasce dopo, nasce col bonifico fermo: Stripe non ripete un 200.
  it('V1-B A nato in un tentativo di prima, il cruscotto rende 30 € prima che B nasca: A si ferma subito, B nasce col bonifico fermo', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    tabella('orders').push(ordineA({}));
    rimborsiSuStripe = [{ id: 're_cruscotto', amount: 3000, status: 'succeeded', metadata: {}, created: 1 }];
    await expect(handleChargeRefunded(rimborsoDi50(3000, rimborsiSuStripe)), 'il rimborso con il carrello aperto si perdeva').resolves.toBeUndefined();
    expect(fermi()).toEqual(['negozio-a']);
    carica = { id: 'ch_1', amount: 5000, amount_refunded: 3000, refunded: false, disputed: false };
    await handleCheckoutCompleted(sessione);
    expect(statoDelCarrello()).toBe('COMPLETED');
    expect(fermi().sort(), 'B nato col netto pieno e il suo bonifico non fermo').toEqual(['negozio-a', 'negozio-b']);
    expect(tabella('orders').find((o) => o.seller_id === 'negozio-b')).toMatchObject({ payment_status: 'PAID', payout_status: 'HELD' });
    expect(avvisiAgliAdmin().map((n) => n.title)).toContain('⚠️ Rimborso dal cruscotto da dividere fra i negozi');
  });

  it('V1-B2 il sito rende A (20 €), poi il cruscotto 10 € prima che B nasca: A si ferma, B nasce fermo, e il rimborso da dividere è di 10 €', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    tabella('orders').push(ordineA({ payment_status: 'REFUNDED', delivery_status: 'CANCELED', payout_status: 'REFUNDED', refunded_amount_cents: 2000, seller_payout_reversed_cents: 1800, stripe_refund_id: 're_sito' }));
    rimborsiSuStripe = [
      { id: 're_cruscotto', amount: 1000, status: 'succeeded', metadata: {}, created: 2 },
      { id: 're_sito', amount: 2000, status: 'succeeded', metadata: { order_id: 'ordine-a' }, created: 1 },
    ];
    await expect(handleChargeRefunded(rimborsoDi50(3000, rimborsiSuStripe))).resolves.toBeUndefined();
    carica = { id: 'ch_1', amount: 5000, amount_refunded: 3000, refunded: false, disputed: false };
    await handleCheckoutCompleted(sessione);
    expect(fermi(), 'i 10 € dal cruscotto si perdevano e B nasceva col netto pieno').toContain('negozio-b');
    expect(avvisiAgliAdmin().find((n) => n.title === '⚠️ Rimborso dal cruscotto da dividere fra i negozi')?.body).toMatch(/10,00/);
  });

  it('V1-C un negozio solo, rimborso parziale (10 €) prima dell ordine: si ripete e poi si scrive', async () => {
    const sessione = carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    const r = {
      id: 'ch_1', payment_intent: 'pi_1', amount: 3000, amount_refunded: 1000, refunded: false, metadata: { pending_checkout_id: 'pc_1' }, transfer_group: 'mc_pc_1',
      refunds: { data: [{ id: 're_c', amount: 1000, status: 'succeeded', metadata: {}, created: 1 }], has_more: false },
    } as unknown as Stripe.Charge;
    await expect(handleChargeRefunded(r)).rejects.toThrow();
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 1000, refunded: false, disputed: false };
    await handleCheckoutCompleted(sessione);
    await handleChargeRefunded(r);
    expect(tabella('orders')[0]).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000, seller_payout_reversed_cents: 900 });
  });

  it('V1-F A nato prima, il cruscotto rende tutto (50 €): A rimborsato subito, B non nasce', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    tabella('orders').push(ordineA({}));
    await handleChargeRefunded(rimborsoDi50(5000, [{ id: 're_cruscotto', amount: 5000, status: 'succeeded', metadata: {}, created: 1 }]));
    carica = { id: 'ch_1', amount: 5000, amount_refunded: 5000, refunded: true, disputed: false };
    await handleCheckoutCompleted(sessione);
    expect(tabella('orders').find((o) => o.id === 'ordine-a')).toMatchObject({ payment_status: 'REFUNDED', payout_status: 'REFUNDED' });
    expect(tabella('orders').find((o) => o.seller_id === 'negozio-b')).toBeUndefined();
  });

  it('contestata (forse solo una richiesta di informazioni della banca): l avviso dice che va deciso a mano', async () => {
    const sessione = carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 0, refunded: false, disputed: true };
    await handleCheckoutCompleted(sessione);
    expect(avvisiAgliAdmin()[0]?.body).toMatch(/richiesta di informazioni.*deciso a mano se rimborsare il cliente o far nascere l'ordine/);
  });
});

// Giro di correzione C2 (revisore V1b): il carrello pagato a metà, il negozio solo rimasto PENDING, la corsa, la contestazione.
describe('R25-001 · C2 · carrello a metà, corsa fra le letture, carrello scaduto contestato', () => {
  const ordineA = (extra: Record<string, unknown> = {}) => ({
    id: 'ordine-a', stripe_session_id: 'cs_1', seller_id: 'negozio-a', user_id: 'cliente-1', payment_status: 'PAID', delivery_status: 'NEW',
    payout_status: 'HELD', total_price: 20, refunded_amount_cents: 0, seller_payout_cents: 1800, seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_charge_id: 'ch_1', stripe_refund_id: null, internal_dispute_status: null, stripe_transfer_id: null, ...extra,
  });
  const rimborso = (totale: number, rimborsato: number) => ({
    id: 'ch_1', payment_intent: 'pi_1', amount: totale, amount_refunded: rimborsato, refunded: rimborsato >= totale, disputed: false,
    metadata: { pending_checkout_id: 'pc_1' }, transfer_group: 'mc_pc_1',
    refunds: { data: [{ id: 're_cruscotto', amount: rimborsato, status: 'succeeded', metadata: {}, created: 1 }], has_more: false },
  }) as unknown as Stripe.Charge;
  const fermi = () => tabella('orders').filter((o) => o.internal_dispute_status === 'RIMBORSO_DA_RIPARTIRE').map((o) => o.seller_id as string);
  const daDividere = () => avvisiAgliAdmin().find((n) => n.title === '⚠️ Rimborso dal cruscotto da dividere fra i negozi');
  const fromOrig = finto.from;
  afterEach(() => { finto.from = fromOrig; });

  it('V1b-1 carrello pagato a metà (B non nasce mai): il cruscotto rende 10 €, A si ferma e lo sa un amministratore, senza ripetere per sempre', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    tabella('orders').push(ordineA());
    // B non entra mai (un errore che si ripete uguale): il carrello resta PENDING per sempre, il giro non lo scade.
    finto.from = ((nome: string) => {
      const q = fromOrig(nome) as Record<string, (...a: unknown[]) => unknown>;
      if (nome !== 'orders') return q;
      return new Proxy(q, { get: (o, k: string) => k === 'insert'
        ? (r: Riga) => (r.seller_id === 'negozio-b' ? { select: () => ({ single: async () => ({ data: null, error: { code: '23503', message: 'fk' } }) }) } : o.insert(r))
        : o[k] });
    }) as typeof finto.from;
    for (let i = 0; i < 3; i++) await expect(handleCheckoutCompleted(sessione)).rejects.toThrow(/negozio-b/);
    expect(statoDelCarrello()).toBe('PENDING');

    await expect(handleChargeRefunded(rimborso(5000, 1000)), 'ogni consegna rispondeva 500 e il rimborso non si scriveva mai').resolves.toBeUndefined();
    expect(fermi()).toEqual(['negozio-a']);
    // Stripe non dice di quale negozio sono i 10 €: non si scrivono su A da solo, si dividono dal pannello.
    expect(tabella('orders').find((o) => o.id === 'ordine-a')).toMatchObject({ refunded_amount_cents: 0, payout_status: 'HELD' });
    expect(daDividere()?.body).toMatch(/10,00/);
    expect(daDividere()?.body).toMatch(/carrello è ancora aperto: sono nati 1 ordini su 2 negozi/);
  });

  it('V1b-2 negozio solo, ordine già nato, carrello rimasto PENDING: il rimborso parziale si scrive sull ordine invece di ripetersi', async () => {
    const sessione = carrello('PENDING', [gruppo('pane-quotidiano', 3000, 'pane')]);
    tabella('orders').push(ordineA({ seller_id: 'pane-quotidiano', total_price: 30, seller_payout_cents: 2700 }));
    carica = { id: 'ch_1', amount: 3000, amount_refunded: 0, refunded: false, disputed: true };
    await handleCheckoutCompleted(sessione);
    expect(statoDelCarrello()).toBe('PENDING');

    await expect(handleChargeRefunded(rimborso(3000, 1000))).resolves.toBeUndefined();
    expect(tabella('orders')[0]).toMatchObject({ payment_status: 'PARTIALLY_REFUNDED', refunded_amount_cents: 1000 });
    expect(fermi()).toEqual([]);
  });

  it('V1b-3 corsa: B nasce e il carrello diventa COMPLETED mentre si lavora il rimborso: i bonifici di A e di B si fermano tutti e due', async () => {
    const sessione = carrello('PENDING', [gruppo('negozio-a', 2000, 'a'), gruppo('negozio-b', 3000, 'b')]);
    tabella('orders').push(ordineA());
    // Il gestore di B ha letto la carta prima del rimborso: per lui non è rimborsata.
    carica = { id: 'ch_1', amount: 5000, amount_refunded: 0, refunded: false, disputed: false };
    let gara: null | (() => Promise<void>) = () => handleCheckoutCompleted(sessione);
    // B nasce proprio mentre il gestore del rimborso legge il carrello.
    finto.from = ((nome: string) => {
      const q = fromOrig(nome) as Record<string, (...a: unknown[]) => unknown>;
      if (nome !== 'pending_checkouts' || !gara) return q;
      const g = gara; gara = null;
      const io: Record<string, unknown> = new Proxy({}, { get: (_o, k: string) => k === 'maybeSingle'
        ? async () => { await g(); return q.maybeSingle(); }
        : (...a: unknown[]) => { q[k](...a); return io; } });
      return io;
    }) as typeof finto.from;

    await handleChargeRefunded(rimborso(5000, 1000));
    expect(statoDelCarrello()).toBe('COMPLETED');
    expect(fermi().sort(), 'il rimborso andava tutto su A e B prendeva il netto pieno').toEqual(['negozio-a', 'negozio-b']);
    expect(tabella('orders').find((o) => o.id === 'ordine-a')?.refunded_amount_cents).toBe(0);
  });

  it('carrello scaduto e carta contestata: Stripe rifiuta il rimborso (charge_disputed), un avviso e Stripe smette di ripetere', async () => {
    const sessione = carrello('EXPIRED', [gruppo('pane-quotidiano', 3000, 'pane')]);
    creaRimborso = async () => { throw Object.assign(new Error('Charge ch_1 has been disputed.'), { code: 'charge_disputed', type: 'StripeInvalidRequestError' }); };
    for (let i = 0; i < 3; i++) await expect(handleCheckoutCompleted(sessione), `tentativo ${i + 1}: Stripe ripete per tre giorni`).resolves.toBeUndefined();
    expect(tabella('orders')).toEqual([]);
    expect(avvisiAgliAdmin().map((n) => n.title)).toContain('⚠️ Pagamento su carrello scaduto contestato');
    expect(avvisiAgliAdmin().map((n) => n.title)).not.toContain('⚠️ Pagamento su carrello scaduto');
  });
});
