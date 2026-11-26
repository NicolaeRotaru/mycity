import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga, type Scrittura } from './aiuti/finto-database-dei-pagamenti';

/**
 * LA CONTESTAZIONE PARZIALE VINTA, CON POSTGREST CHE NON CONOSCE ANCORA IL PROMEMORIA.
 *
 * Ordine da 50 €, 45 € al negozio, la banca contesta 20 €: all'apertura si stornano 18 €
 * e si mette da parte il promemoria. Alla vittoria si restituiscono i 18 € con un bonifico
 * la cui chiave porta il tentativo. Se PostgREST ha la memoria vecchia dello schema (il
 * database ha la colonna, il traduttore no: la lettura passa, la scrittura risponde PGRST204),
 * il ripiego scriveva il tentativo nuovo e lasciava il promemoria. Qualcosa più avanti
 * nello stesso evento lancia, Stripe ripete: promemoria ancora lì, tentativo nuovo, chiave
 * nuova, secondo bonifico da 18 €.
 */

process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

type Bonifico = { id: string; amount: number; destination: string; chiave: string };
const stato: {
  db: FintoDatabase;
  evento: { id: string; type: string; data: { object: Record<string, unknown> } };
  storni: Array<{ id: string; transferId: string; amount: number; chiave: string; created: number; metadata: Record<string, string> }>;
  bonifici: Bonifico[];
} = { db: fintoDatabase(), evento: { id: 'evt_x', type: 'noop', data: { object: {} } }, storni: [], bonifici: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => stato.evento },
    transfers: {
      // Come Stripe: la stessa chiave restituisce lo stesso bonifico, una chiave nuova ne fa un altro.
      create: async (params: { amount: number; destination: string }, opzioni: { idempotencyKey: string }) => {
        const gia = stato.bonifici.find((b) => b.chiave === opzioni.idempotencyKey);
        if (gia) return gia;
        const nuovo = { id: `tr_rest_${stato.bonifici.length + 1}`, amount: params.amount, destination: params.destination, chiave: opzioni.idempotencyKey };
        stato.bonifici.push(nuovo);
        return nuovo;
      },
      createReversal: async (transferId: string, params: { amount: number; metadata?: Record<string, string> }, opzioni: { idempotencyKey: string }) => {
        const gia = stato.storni.find((s) => s.chiave === opzioni.idempotencyKey);
        if (gia) return gia;
        const nuovo = { id: `trr_${stato.storni.length + 1}`, transferId, amount: params.amount, chiave: opzioni.idempotencyKey, created: 2_000_000_000, metadata: params.metadata ?? {} };
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

/** Ordine da 50 €, 45 € al negozio già versati, un reso da 5 € già stornato prima. */
function ordineParziale(extra: Riga = {}): Riga {
  return {
    id: 'o1', seller_id: 's1', total_price: 50, gross_total_cents: 5000,
    payment_status: 'PAID', refunded_amount_cents: 0, delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED', dispute_status: null,
    stripe_payment_intent: 'pi_1', stripe_charge_id: 'ch_1', stripe_transfer_id: 'tr_1', stripe_reversal_id: null,
    seller_payout_cents: 4500, seller_payout_reversed_cents: 500,
    dispute_seller_reversed_cents: 0, dispute_rider_reversed_cents: 0, payout_tentativo: 0,
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_payout_tentativo: 0,
    ...extra,
  };
}

const ordine = () => stato.db.tabelle.orders.find((r) => r.id === 'o1')!;
const parziale = { id: 'dp_p', amount: 2000, payment_intent: 'pi_1', charge: 'ch_1', created: 1_900_000_000 };
const vinta = { ...parziale, status: 'won' };

const scriveSulleOrdini = (s: Scrittura, colonna: string) =>
  s.tabella === 'orders' && s.operazione === 'update' && !!s.valori && !Array.isArray(s.valori) && colonna in s.valori;
/** PostgREST con lo schema vecchio: il database ha la colonna, il traduttore la rifiuta nelle scritture. */
const schemaVecchio = (colonna: string) => ({
  code: 'PGRST204',
  message: `Could not find the '${colonna}' column of 'orders' in the schema cache`,
});

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

/** Apertura con lo schema in ordine: stornati 18 €, promemoria 1800, lo stornato sale a 2300. */
async function apri() {
  stato.db.tabelle.orders = [ordineParziale({ rider_id: 'r1', rider_payout_status: 'REVERSED', rider_payout_reversed_cents: 300, dispute_rider_reversed_cents: 300 })];
  expect(await consegna('evt_ap', 'charge.dispute.created', parziale)).toBe(200);
  expect(ordine()).toMatchObject({ payout_status: 'TRANSFERRED', seller_payout_reversed_cents: 2300, dispute_seller_reversed_cents: 1800 });
}

describe('contestazione parziale vinta con la memoria di PostgREST vecchia', () => {
  it('errore a metà dell evento e ripetizione di Stripe: un solo bonifico, sempre con la stessa chiave', async () => {
    await apri();

    // Primo passaggio: PostgREST non conosce il promemoria, e più avanti il fattorino va in timeout.
    stato.db.guasto = (s) => {
      if (scriveSulleOrdini(s, 'dispute_seller_reversed_cents')) return schemaVecchio('dispute_seller_reversed_cents');
      if (scriveSulleOrdini(s, 'rider_payout_status')) return TIMEOUT;
      return null;
    };
    expect(await consegna('evt_vinta', 'charge.dispute.closed', vinta)).toBe(500);
    expect(stato.bonifici).toHaveLength(1);

    // Stripe ripete lo stesso evento, la memoria di PostgREST è ancora vecchia.
    stato.db.guasto = (s) => (scriveSulleOrdini(s, 'dispute_seller_reversed_cents') ? schemaVecchio('dispute_seller_reversed_cents') : null);
    await consegna('evt_vinta', 'charge.dispute.closed', vinta);
    expect(stato.bonifici, 'la ripetizione ha rifatto il bonifico con una chiave nuova').toHaveLength(1);

    // Poi la memoria si aggiorna e Stripe ripete ancora: si chiude, sempre senza un secondo bonifico.
    stato.db.guasto = () => null;
    expect(await consegna('evt_vinta', 'charge.dispute.closed', vinta)).toBe(200);
    expect(stato.bonifici).toHaveLength(1);
    expect(stato.bonifici[0]).toMatchObject({ amount: 1800, destination: 'acct_s1', chiave: 'dispute_won_seller_dp_p_o1_t1' });
    expect(ordine()).toMatchObject({
      payout_status: 'TRANSFERRED', dispute_seller_reversed_cents: 0, seller_payout_reversed_cents: 500, payout_tentativo: 1,
    });

    // Un altro avviso sulla stessa chiusura non rifà niente.
    expect(await consegna('evt_vinta_2', 'charge.dispute.closed', vinta)).toBe(200);
    expect(stato.bonifici).toHaveLength(1);
    expect(ordine().seller_payout_reversed_cents).toBe(500);
  });

  it('se a mancare è solo il tentativo, il promemoria si toglie lo stesso insieme allo stornato', async () => {
    await apri();
    stato.db.guasto = (s) => (scriveSulleOrdini(s, 'payout_tentativo') ? schemaVecchio('payout_tentativo') : null);
    expect(await consegna('evt_vinta', 'charge.dispute.closed', vinta)).toBe(200);
    expect(stato.bonifici).toHaveLength(1);
    expect(ordine()).toMatchObject({ dispute_seller_reversed_cents: 0, seller_payout_reversed_cents: 500 });

    // Una ripetizione non toglie i 18 € una seconda volta dallo stornato (il reso da 5 € resta).
    stato.db.guasto = () => null;
    await consegna('evt_vinta_2', 'charge.dispute.closed', vinta);
    expect(stato.bonifici).toHaveLength(1);
    expect(ordine().seller_payout_reversed_cents).toBe(500);
  });
});
