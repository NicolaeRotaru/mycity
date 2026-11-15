import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R23-012 — Una richiesta di informazioni della banca che diventa contestazione vera non
 * toglieva niente al negozio: arrivava solo un avviso, e solo se la contestazione si perdeva.
 *
 * La richiesta (stato `warning_needs_response`) passa da `charge.dispute.created` senza storni,
 * giustamente: la banca non ha tolto niente. Quando la banca la trasforma in contestazione vera
 * non arriva un secondo `created`: Stripe toglie i soldi e lo dice con
 * `charge.dispute.funds_withdrawn`. La rotta non lo ascoltava, quindi la quota del negozio già
 * pagato restava al negozio, mentre i soldi a MyCity erano stati tolti.
 *
 * Stripe è finto (storni con la loro chiave anti-doppione), il database è quello finto dei pagamenti.
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
const contestazione = { id: 'dp_1', amount: 2790, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };

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

describe('R23-012 — la richiesta di informazioni diventata contestazione toglie al negozio la sua quota', () => {
  it('27,90 € al Pane Quotidiano già pagato: alla contestazione vera i 18 € del negozio tornano indietro', async () => {
    stato.db.tabelle.orders = [ordine('o1')];

    expect(await consegna('evt_inq', 'charge.dispute.created', { ...contestazione, status: 'warning_needs_response' })).toBe(200);
    expect(stato.storni, 'la richiesta non toglie niente').toEqual([]);

    // La banca la trasforma in contestazione: Stripe toglie i soldi a MyCity.
    expect(await consegna('evt_prelievo', 'charge.dispute.funds_withdrawn', { ...contestazione, status: 'needs_response' })).toBe(200);
    expect(stato.storni.map((s) => s.amount), 'i soldi sono stati tolti a MyCity e il negozio li tiene').toEqual([1800]);
    expect(riga('o1')).toMatchObject({ payout_status: 'REVERSED', dispute_status: 'OPEN', dispute_seller_reversed_cents: 1800 });
    expect(avvisi().some((a) => a.includes('Chargeback aperto'))).toBe(true);

    // Persa: niente «riprendere la quota a mano», è già stata ripresa.
    expect(await consegna('evt_persa', 'charge.dispute.closed', { ...contestazione, status: 'lost' })).toBe(200);
    expect(avvisi().some((a) => a.includes('Nessuno storno al negozio registrato'))).toBe(false);
    expect(stato.storni).toHaveLength(1);
  });

  it('su una contestazione nata vera, il prelievo che arriva dopo non storna due volte e non ripete l avviso', async () => {
    stato.db.tabelle.orders = [ordine('o1')];
    expect(await consegna('evt_c', 'charge.dispute.created', { ...contestazione, status: 'needs_response' })).toBe(200);
    expect(await consegna('evt_p', 'charge.dispute.funds_withdrawn', { ...contestazione, status: 'needs_response' })).toBe(200);

    expect(stato.storni.map((s) => s.amount)).toEqual([1800]);
    expect(riga('o1').seller_payout_reversed_cents).toBe(1800);
    expect(avvisi().filter((a) => a.includes('Chargeback aperto'))).toHaveLength(1);
  });

  it('una contestazione di una parte (10 € su 27,90): al negozio la stessa fetta, una volta sola', async () => {
    stato.db.tabelle.orders = [ordine('o1')];
    const parte = { ...contestazione, amount: 1000 };
    expect(await consegna('evt_inq', 'charge.dispute.created', { ...parte, status: 'warning_needs_response' })).toBe(200);
    expect(await consegna('evt_p', 'charge.dispute.funds_withdrawn', { ...parte, status: 'needs_response' })).toBe(200);
    expect(await consegna('evt_p2', 'charge.dispute.funds_withdrawn', { ...parte, status: 'needs_response' })).toBe(200);
    // 1800 × 1000 / 2790 = 645
    expect(stato.storni.map((s) => s.amount)).toEqual([645]);
  });

  it('un rimborso fatto durante la richiesta non passa per lo storno della contestazione: la fetta del negozio si toglie', async () => {
    // Durante la richiesta di informazioni il pagamento si può ancora rimborsare: 5 € al negozio
    // tornano indietro con uno storno che porta l'ordine ed è nato dopo la contestazione.
    stato.storni.push({
      id: 'trr_rimborso', transferId: 'tr_o1', amount: 500, chiave: 'reversal_o1_tot_500',
      created: contestazione.created + 3_600, metadata: { order_id: 'o1' },
    });
    stato.db.tabelle.orders = [ordine('o1', { seller_payout_reversed_cents: 500, stripe_reversal_id: 'trr_rimborso' })];
    const parte = { ...contestazione, amount: 1000 };

    expect(await consegna('evt_inq', 'charge.dispute.created', { ...parte, status: 'warning_needs_response' })).toBe(200);
    expect(await consegna('evt_p', 'charge.dispute.funds_withdrawn', { ...parte, status: 'needs_response' })).toBe(200);

    // 1800 × 1000 / 2790 = 645: lo storno del rimborso non è quello della contestazione.
    expect(stato.storni.map((s) => s.amount), 'la fetta del negozio non si toglie mai').toEqual([500, 645]);
    expect(riga('o1')).toMatchObject({ seller_payout_reversed_cents: 1145, dispute_seller_reversed_cents: 645 });
  });

  it('lo storno che porta l id di questa contestazione è il suo, anche con un importo diverso dalla quota', async () => {
    stato.storni.push({
      id: 'trr_suo', transferId: 'tr_o1', amount: 600, chiave: 'chiave scaduta',
      created: contestazione.created + 60, metadata: { order_id: 'o1', dispute_id: 'dp_1' },
    });
    stato.db.tabelle.orders = [ordine('o1', { dispute_status: 'OPEN' })];
    expect(await consegna('evt_p', 'charge.dispute.funds_withdrawn', { ...contestazione, amount: 1000, status: 'needs_response' })).toBe(200);
    expect(stato.storni.map((s) => s.id)).toEqual(['trr_suo']);
  });

  it('negozio non ancora pagato: la richiesta diventata contestazione manda comunque «Chargeback aperto», una volta', async () => {
    stato.db.tabelle.orders = [ordine('o1', { payout_status: 'HELD', stripe_transfer_id: null })];
    expect(await consegna('evt_inq', 'charge.dispute.created', { ...contestazione, status: 'warning_needs_response' })).toBe(200);
    expect(await consegna('evt_p', 'charge.dispute.funds_withdrawn', { ...contestazione, status: 'needs_response' })).toBe(200);

    expect(stato.storni).toEqual([]);
    expect(riga('o1').dispute_status, 'il bonifico fermo non deve partire').toBe('OPEN');
    expect(avvisi().filter((a) => a.includes('Chargeback aperto')), 'nessuno sa che la banca si è ripresa i soldi').toHaveLength(1);
  });

  it('il prelievo arriva prima di created: uno storno e un avviso solo', async () => {
    stato.db.tabelle.orders = [ordine('o1')];
    expect(await consegna('evt_p', 'charge.dispute.funds_withdrawn', { ...contestazione, status: 'needs_response' })).toBe(200);
    expect(await consegna('evt_c', 'charge.dispute.created', { ...contestazione, status: 'needs_response' })).toBe(200);

    expect(stato.storni.map((s) => s.amount)).toEqual([1800]);
    expect(avvisi().filter((a) => a.includes('Chargeback aperto')), 'due avvisi per la stessa contestazione').toHaveLength(1);
  });
});
