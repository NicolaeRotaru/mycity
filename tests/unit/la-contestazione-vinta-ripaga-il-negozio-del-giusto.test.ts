import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 15/10/2026 (R81, collaudo giro 2) — LA CONTESTAZIONE VINTA E IL PROMEMORIA
 * CHE NESSUNO CHIEDEVA.
 *
 * All'apertura di una contestazione, il gestore mette da parte quanto ha
 * stornato al negozio PER quella contestazione (`dispute_seller_reversed_cents`,
 * migrazione 126). Alla vittoria si dovrebbe restituire quello, e non tutto lo
 * stornato: dentro il totale può esserci un reso già rimborsato prima.
 *
 * Ma la vittoria quel campo non lo chiedeva nella select. PostgREST restituisce
 * solo le colonne chieste, quindi il promemoria arrivava sempre vuoto e si
 * azzerava il totale. Il caso del collaudo: ordine con 32,40 € al negozio, reso
 * da 5 € stornato, poi contestazione piena, poi vinta. Il negozio si faceva
 * ripagare 32,40 € invece di 27,40 €: i 5 € del reso li pagava MyCity. Le
 * prove di prima non lo vedevano perché il database finto restituiva la riga
 * intera; adesso restituisce solo le colonne chieste, come quello vero.
 *
 * E in produzione, dove la 126 non c'è, la vittoria falliva per intero: la
 * scrittura con la colonna nuova riceve PGRST204 dal traduttore, il ripiego non
 * lo riconosceva, Stripe riprovava per tre giorni e gli amministratori non
 * ricevevano più nessun avviso.
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
import { promemoriaOTotale } from '@/lib/stripe/webhook/dispute';

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
  stato.db = fintoDatabase({
    orders: [],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    stripe_event_log: [],
  });
  stato.db.predefiniti.stripe_event_log = { processed: false, processed_at: null };
  stato.db.unici.stripe_event_log = [['event_id']];
});

describe('contestazione piena su un ordine con un reso già stornato, poi vinta', () => {
  it('IL CASO DEL COLLAUDO — il negozio si fa ripagare 27,40 €, non 32,40', async () => {
    stato.db.tabelle.orders = [ordineConReso()];

    expect(await consegna('evt_aperta', 'charge.dispute.created', contestazione)).toBe(200);
    expect(ordine()).toMatchObject({ payout_status: 'REVERSED', seller_payout_reversed_cents: 3240, dispute_seller_reversed_cents: 2740 });

    expect(await consegna('evt_vinta', 'charge.dispute.closed', { ...contestazione, status: 'won' })).toBe(200);
    expect(ordine()).toMatchObject({ payout_status: 'HELD', dispute_status: 'WON', payout_tentativo: 1 });
    expect(residuoDaVersare(), 'il reso da 5 € era già del cliente: ripagarlo lo mette a carico di MyCity').toBe(2740);
  });

  it('su un database senza la migrazione 126: 200, bonifico in coda col tentativo NUOVO, e l avviso arriva', async () => {
    // Senza la 126 il promemoria non esiste: si ricade sull'azzeramento di
    // prima (il caso peggiore di ieri). Ma la vittoria deve registrarsi, e il
    // numero di tentativo deve salire: è lui a dare al bonifico una chiave
    // anti-doppione nuova, altrimenti Stripe restituisce quello stornato.
    stato.db.colonneMancanti.orders = ['dispute_seller_reversed_cents', 'dispute_rider_reversed_cents'];
    const senza126 = ordineConReso();
    delete senza126.dispute_seller_reversed_cents;
    delete senza126.dispute_rider_reversed_cents;
    stato.db.tabelle.orders = [senza126];

    expect(await consegna('evt_aperta', 'charge.dispute.created', contestazione)).toBe(200);
    expect(ordine().payout_status).toBe('REVERSED');

    const vinta = await consegna('evt_vinta', 'charge.dispute.closed', { ...contestazione, status: 'won' });
    expect(vinta, 'col 500 Stripe riprova per tre giorni e nessuno sa della vittoria').toBe(200);
    expect(ordine()).toMatchObject({ payout_status: 'HELD', dispute_status: 'WON', stripe_transfer_id: null });
    expect(ordine().payout_tentativo, 'col tentativo vecchio Stripe restituisce il bonifico già stornato').toBe(1);
    expect(avvisi()).toContain('✓ Chargeback vinto');
  });

  it('contestazione aperta PRIMA della 126 e vinta dopo: il promemoria è zero, non si ripaga zero', async () => {
    // La 126 crea la colonna con DEFAULT 0: chi era già stornato prima la trova
    // a zero. Usarlo alla lettera lascerebbe il negozio senza niente.
    stato.db.tabelle.orders = [ordineConReso({
      payout_status: 'REVERSED', seller_payout_reversed_cents: 3240, dispute_status: 'OPEN', dispute_seller_reversed_cents: 0,
    })];
    expect(await consegna('evt_vinta', 'charge.dispute.closed', { ...contestazione, status: 'won' })).toBe(200);
    expect(residuoDaVersare()).toBe(3240);
  });
});

describe('promemoriaOTotale', () => {
  it('il promemoria vale se c è; vuoto o zero → il totale, come prima della 126', () => {
    expect(promemoriaOTotale(2740, 3240)).toBe(2740);
    expect(promemoriaOTotale(0, 3240)).toBe(3240);
    expect(promemoriaOTotale(undefined, 3240)).toBe(3240);
    expect(promemoriaOTotale(null, null)).toBe(0);
  });
});
