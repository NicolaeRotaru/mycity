import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 1/11/2026 — LA CONTESTAZIONE TOCCA I SOLDI DEL NEGOZIO SOLO QUANDO LA BANCA
 * LI HA TOLTI DAVVERO, E ALLA VITTORIA RESTITUISCE SOLO QUELLO CHE HA TOLTO.
 *
 * Due strade sbagliate:
 * ① richiesta di informazioni della banca (stato `warning_needs_response`):
 *   Stripe non toglie niente, ma al negozio si stornava il bonifico, e alla
 *   chiusura (`warning_closed`) nessuno glielo restituiva;
 * ② pagamento rimborsato per intero e poi contestato, poi vinto: lo storno
 *   del rimborso veniva preso per quello della contestazione, e negozio e
 *   fattorino venivano rimessi in coda per essere pagati una seconda volta.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

type Storno = { id: string; transferId: string; amount: number; chiave: string; created: number; metadata: Record<string, string> };
const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
  storni: Storno[];
} = { db: fintoDatabase(), evento: { id: 'evt_x', type: 'noop', data: { object: {} } }, storni: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    transfers: {
      createReversal: async (
        transferId: string,
        params: { amount: number; metadata?: Record<string, string> },
        opzioni: { idempotencyKey: string },
      ) => {
        const gia = stato.storni.find((s) => s.chiave === opzioni.idempotencyKey);
        if (gia) return gia;
        const nuovo = {
          id: `trr_${stato.storni.length + 1}`, transferId, amount: params.amount, chiave: opzioni.idempotencyKey,
          created: 2_000_000_000, metadata: params.metadata ?? {},
        };
        stato.storni.push(nuovo);
        return nuovo;
      },
      listReversals: async (transferId: string) => ({ data: stato.storni.filter((s) => s.transferId === transferId) }),
    },
  }),
  isStripeConfigured: () => true,
}));

import { POST } from '@/app/api/stripe/webhook/route';

async function consegna(id: string, type: string, object: Record<string, unknown>): Promise<number> {
  stato.evento = { id, type, data: { object } };
  const r = await POST(
    new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=ok' },
      body: '{}',
    }) as never,
  );
  return r.status;
}

function ordine(id: string, extra: Riga = {}): Riga {
  return {
    id,
    total_price: 27.9,
    gross_total_cents: 2790,
    payment_status: 'PAID',
    refunded_amount_cents: 0,
    delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED',
    dispute_status: null,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_transfer_id: `tr_${id}`,
    stripe_reversal_id: null,
    seller_payout_cents: 1800,
    seller_payout_reversed_cents: 0,
    dispute_seller_reversed_cents: 0,
    dispute_rider_reversed_cents: 0,
    payout_tentativo: 0,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_payout_tentativo: 0,
    rider_fee_cents: null,
    shipping_cost: 0,
    ...extra,
  };
}

const riga = (id: string) => stato.db.tabelle.orders.find((r) => r.id === id)!;
const avvisi = () => stato.db.tabelle.notifications.map((n) => `${n.title} ${n.message ?? n.body ?? ''}`);

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

describe('richiesta di informazioni della banca (inquiry)', () => {
  const richiesta = { id: 'dp_inq', amount: 2790, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };

  it('27,90 € al Pane Quotidiano, bonifico già partito: niente storno, e alla chiusura il bonifico riparte', async () => {
    stato.db.tabelle.orders = [ordine('o1')];

    expect(await consegna('evt_a', 'charge.dispute.created', { ...richiesta, status: 'warning_needs_response' })).toBe(200);
    expect(stato.storni, 'la banca non ha tolto niente: al negozio non si toglie niente').toEqual([]);
    expect(riga('o1')).toMatchObject({ payout_status: 'TRANSFERRED', seller_payout_reversed_cents: 0, dispute_status: 'OPEN' });
    expect(avvisi().some((a) => a.includes('informazioni'))).toBe(true);
    expect(avvisi().some((a) => a.includes('Chargeback aperto'))).toBe(false);

    expect(await consegna('evt_c', 'charge.dispute.closed', { ...richiesta, status: 'warning_closed' })).toBe(200);
    expect(riga('o1').dispute_status, 'OPEN per sempre = il giro dei bonifici lo esclude per sempre').toBe('WON');

    // Doppio tocco: la stessa chiusura riconsegnata (evento nuovo) non fa danni.
    expect(await consegna('evt_c2', 'charge.dispute.closed', { ...richiesta, status: 'warning_closed' })).toBe(200);
    expect(riga('o1')).toMatchObject({ dispute_status: 'WON', payout_status: 'TRANSFERRED', seller_payout_reversed_cents: 0 });
    expect(stato.storni).toEqual([]);
  });

  it('la chiusura non riscrive un esito vero: un ordine già LOST resta LOST', async () => {
    stato.db.tabelle.orders = [ordine('o1', { dispute_status: 'LOST' })];
    expect(await consegna('evt_c', 'charge.dispute.closed', { ...richiesta, status: 'warning_closed' })).toBe(200);
    expect(riga('o1').dispute_status).toBe('LOST');
  });

  it('risposta persa: se il database non scrive OPEN, Stripe riprova (500)', async () => {
    stato.db.tabelle.orders = [ordine('o1', { payout_status: 'HELD', stripe_transfer_id: null })];
    stato.db.guasto = (s) => (s.tabella === 'orders' && s.operazione === 'update' ? TIMEOUT : null);
    expect(await consegna('evt_a', 'charge.dispute.created', { ...richiesta, status: 'warning_needs_response' })).toBe(500);
    expect(stato.storni).toEqual([]);
  });

  it('richiesta diventata contestazione e persa: l avviso dice di riprendere la quota a mano', async () => {
    stato.db.tabelle.orders = [ordine('o1')];
    expect(await consegna('evt_a', 'charge.dispute.created', { ...richiesta, status: 'warning_needs_response' })).toBe(200);
    expect(await consegna('evt_p', 'charge.dispute.closed', { ...richiesta, status: 'lost' })).toBe(200);
    expect(avvisi().some((a) => a.includes('Nessuno storno al negozio registrato'))).toBe(true);
  });
});

describe('rimborsato per intero, poi contestato, poi vinto', () => {
  const contestazione = { id: 'dp_1', amount: 2500, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };

  it('25 €: negozio (18 €) e fattorino (3 €) già ripresi dal rimborso non vengono rimessi in coda', async () => {
    stato.db.tabelle.orders = [ordine('o1', {
      total_price: 25, gross_total_cents: 2500, payment_status: 'REFUNDED', refunded_amount_cents: 2500,
      payout_status: 'REVERSED', seller_payout_reversed_cents: 1800, stripe_reversal_id: 'trr_reso',
      rider_id: 'r1', rider_transfer_id: 'tr_rider', rider_payout_status: 'REVERSED', rider_payout_reversed_cents: 300,
      rider_fee_cents: 300,
    })];

    expect(await consegna('evt_a', 'charge.dispute.created', { ...contestazione, status: 'needs_response' })).toBe(200);
    expect(stato.storni).toEqual([]);
    expect(await consegna('evt_v', 'charge.dispute.closed', { ...contestazione, status: 'won' })).toBe(200);
    // Doppio tocco della vittoria.
    expect(await consegna('evt_v2', 'charge.dispute.closed', { ...contestazione, status: 'won' })).toBe(200);

    expect(riga('o1'), 'HELD con residuo 1800 = il giro dei bonifici paga di nuovo il negozio').toMatchObject({
      dispute_status: 'WON', payout_status: 'REVERSED', seller_payout_reversed_cents: 1800,
    });
    expect(riga('o1'), 'lo stesso per il fattorino').toMatchObject({
      rider_payout_status: 'REVERSED', rider_payout_reversed_cents: 300,
    });
  });

  it('due negozi, sotto i 10 € e sopra i 30 €: solo quello stornato dalla contestazione torna in coda', async () => {
    const pieno = { ...contestazione, amount: 4300 };
    stato.db.tabelle.orders = [
      ordine('oa', { total_price: 8, gross_total_cents: 800, seller_payout_cents: 700 }),
      ordine('ob', {
        total_price: 35, gross_total_cents: 3500, seller_payout_cents: 3150, payment_status: 'REFUNDED',
        payout_status: 'REVERSED', seller_payout_reversed_cents: 3150,
      }),
    ];
    expect(await consegna('evt_a', 'charge.dispute.created', { ...pieno, status: 'needs_response' })).toBe(200);
    expect(riga('oa')).toMatchObject({ payout_status: 'REVERSED', seller_payout_reversed_cents: 700 });
    expect(await consegna('evt_v', 'charge.dispute.closed', { ...pieno, status: 'won' })).toBe(200);
    expect(riga('oa')).toMatchObject({ payout_status: 'HELD', seller_payout_reversed_cents: 0 });
    expect(riga('ob')).toMatchObject({ payout_status: 'REVERSED', seller_payout_reversed_cents: 3150 });
  });
});
