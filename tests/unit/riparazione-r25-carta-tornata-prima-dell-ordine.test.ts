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
      data = righeNuove.map((r) => ({ id: `${nome}_${t.length + 1}`, ...r }));
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
    refunds: { list: async () => ({ data: [] }), create: async () => ({ id: 're_x' }) },
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
