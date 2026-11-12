import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R11-007 — SE LA BANCA CONTESTA SOLO UNA PARTE E MYCITY VINCE, AL NEGOZIO
 * TORNA LA PARTE CHE GLI ERA STATA TOLTA.
 *
 * Ordine da 50 €, netto del negozio 45 €, la banca contesta 20 €: all'apertura
 * si stornano 18 € al negozio, lo storno non è pieno e l'ordine resta
 * 'TRANSFERRED'. Alla vittoria si rimettevano in coda solo gli ordini 'REVERSED':
 * i 18 € restavano tolti per sempre.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

type Storno = { id: string; transferId: string; amount: number; chiave: string; created: number; metadata: Record<string, string> };
const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
  storni: Storno[];
  bonifici: Array<{ id: string; amount: number; destination: string; chiave: string }>;
} = { db: fintoDatabase(), evento: { id: 'evt_x', type: 'noop', data: { object: {} } }, storni: [], bonifici: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    transfers: {
      create: async (params: { amount: number; destination: string }, opzioni: { idempotencyKey: string }) => {
        const gia = stato.bonifici.find((b) => b.chiave === opzioni.idempotencyKey);
        if (gia) return gia;
        const nuovo = { id: `tr_rest_${stato.bonifici.length + 1}`, amount: params.amount, destination: params.destination, chiave: opzioni.idempotencyKey };
        stato.bonifici.push(nuovo);
        return nuovo;
      },
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

/** Ordine da 40 €, 32,40 € al negozio, bonifico già uscito, e un reso da 5 € già stornato. */
function ordineConReso(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    total_price: 40,
    gross_total_cents: 4000,
    payment_status: 'PARTIALLY_REFUNDED',
    refunded_amount_cents: 617,
    delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED',
    dispute_status: null,
    stripe_payment_intent: 'pi_1',
    stripe_charge_id: 'ch_1',
    stripe_transfer_id: 'tr_1',
    stripe_reversal_id: 'trr_reso',
    seller_payout_cents: 3240,
    seller_payout_reversed_cents: 500,
    dispute_seller_reversed_cents: 0,
    dispute_rider_reversed_cents: 0,
    payout_tentativo: 0,
    rider_id: null,
    rider_transfer_id: null,
    rider_payout_status: null,
    rider_payout_reversed_cents: 0,
    rider_payout_tentativo: 0,
    ...extra,
  };
}

const ordine = () => stato.db.tabelle.orders.find((r) => r.id === 'o1')!;
const residuoDaVersare = () => (ordine().seller_payout_cents as number) - (ordine().seller_payout_reversed_cents as number);
const avvisi = () => stato.db.tabelle.notifications.map((n) => n.title);
const contestazione = { id: 'dp_1', amount: 4000, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };

beforeEach(() => {
  stato.storni = [];
  stato.bonifici = [];
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 's1', role: 'seller', stripe_account_id: 'acct_s1' }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
});


function ordineParziale(extra: Riga = {}): Riga {
  return ordineConReso({
    total_price: 50, gross_total_cents: 5000, payment_status: 'PAID', refunded_amount_cents: 0,
    seller_id: 's1', seller_payout_cents: 4500, seller_payout_reversed_cents: 0, stripe_reversal_id: null,
    ...extra,
  });
}
const parziale = { id: 'dp_p', amount: 2000, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };

describe('R11-007 — contestazione parziale vinta', () => {
  it('apertura: stornati 18 € su 45, l ordine resta TRANSFERRED', async () => {
    stato.db.tabelle.orders = [ordineParziale()];
    expect(await consegna('evt_ap', 'charge.dispute.created', parziale)).toBe(200);
    expect(ordine()).toMatchObject({ payout_status: 'TRANSFERRED', seller_payout_reversed_cents: 1800, dispute_seller_reversed_cents: 1800 });
  });

  it('vittoria: al negozio tornano esattamente i 18 €, e lo stornato torna a zero', async () => {
    stato.db.tabelle.orders = [ordineParziale()];
    await consegna('evt_ap', 'charge.dispute.created', parziale);
    expect(await consegna('evt_vinta', 'charge.dispute.closed', { ...parziale, status: 'won' })).toBe(200);

    expect(stato.bonifici, 'nessun bonifico restituisce al negozio la quota tolta all apertura').toHaveLength(1);
    expect(stato.bonifici[0]).toMatchObject({ amount: 1800, destination: 'acct_s1' });
    expect(ordine()).toMatchObject({
      payout_status: 'TRANSFERRED', seller_payout_reversed_cents: 0, dispute_seller_reversed_cents: 0, dispute_status: 'WON',
    });
  });

  it('Stripe ripete l evento: niente secondo bonifico', async () => {
    stato.db.tabelle.orders = [ordineParziale()];
    await consegna('evt_ap', 'charge.dispute.created', parziale);
    await consegna('evt_vinta', 'charge.dispute.closed', { ...parziale, status: 'won' });
    await consegna('evt_vinta_2', 'charge.dispute.closed', { ...parziale, status: 'won' });
    expect(stato.bonifici).toHaveLength(1);
  });

  it('non torna in HELD: il giro non riverserebbe i 45 € pieni', async () => {
    stato.db.tabelle.orders = [ordineParziale()];
    await consegna('evt_ap', 'charge.dispute.created', parziale);
    await consegna('evt_vinta', 'charge.dispute.closed', { ...parziale, status: 'won' });
    expect(ordine().payout_status).not.toBe('HELD');
  });
});
