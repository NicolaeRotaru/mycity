import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R03-006 — Reso con la carta in un carrello di due negozi, dopo un rimborso dal cruscotto
 * già diviso fra i due ordini.
 *
 * Ordini da 40 € (o1) e 60 € (o2) sullo stesso pagamento. Dal cruscotto escono 30 €, divisi
 * 5 € a o1 e 25 € a o2. Poi un reso da 20 € su o1: Stripe rimborsa, al negozio si stornano
 * 18 €, e un passo dopo cade. Il negozio riprova con la stessa chiave `return_<id>`.
 *
 * Prima: il controllo «il rimborso di questa chiave è già uscito e già contato?» contava per
 * intero i 30 € senza ordine, credeva il reso non contato, e lo registrava di nuovo: altri
 * 13,50 € stornati al negozio e o1 rimborsato per intero. Ora del rimborso diviso conta solo
 * la parte di o1 (5 €), scritta nella divisione decisa.
 */

type RimborsoSuStripe = { id: string; amount: number; status: string; metadata: Record<string, string>; chiave: string | null };
const stato: {
  db: FintoDatabase;
  suStripe: RimborsoSuStripe[];
  creati: number[];
  rispostePerse: number;
  /** Passate le 24 ore: Stripe non ricorda piu' la chiave. */
  chiaviScadute: boolean;
  storni: Array<{ amount: number; chiave: string }>;
  /** La prenotazione scrive ma la risposta torna {error}. */
  prenotazionePersa: boolean;
  /** Dopo la prenotazione persa anche la rilettura dell'ordine cade. */
  riletturaCade: boolean;
} = { db: fintoDatabase(), suStripe: [], creati: [], rispostePerse: 0, chiaviScadute: false, storni: [], prenotazionePersa: false, riletturaCade: false };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async (p: { amount: number; metadata?: Record<string, string> }, o: { idempotencyKey: string }) => {
        const gia = stato.chiaviScadute ? null : stato.suStripe.find((r) => r.chiave === o.idempotencyKey);
        if (gia) return { ...gia };
        stato.creati.push(p.amount);
        const nuovo = { id: `re_${stato.suStripe.length + 1}`, amount: p.amount, status: 'succeeded', metadata: p.metadata ?? {}, chiave: o.idempotencyKey };
        stato.suStripe.push(nuovo);
        if (stato.rispostePerse > 0) {
          stato.rispostePerse -= 1;
          throw new Error('socket hang up');
        }
        return { ...nuovo };
      },
      list: async () => ({ data: [...stato.suStripe].reverse().map((r) => ({ ...r, metadata: { ...r.metadata } })), has_more: false }),
    },
    transfers: {
      createReversal: async (_t: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        if (!stato.storni.some((s) => s.chiave === o.idempotencyKey)) stato.storni.push({ amount: p.amount, chiave: o.idempotencyKey });
        return { id: `trr_${o.idempotencyKey}` };
      },
    },
  }),
}));

import { refundOrder } from '@/lib/stripe/payout';

function ordine(id: string, lordo: number, rimborsato: number, extra: Riga = {}): Riga {
  return {
    id, user_id: 'cliente1', seller_id: `negozio-${id}`,
    total_price: lordo / 100, gross_total_cents: lordo, refunded_amount_cents: rimborsato,
    payment_method: 'card', payment_status: 'PARTIALLY_REFUNDED', delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED', seller_payout_cents: Math.round(lordo * 0.9), seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_transfer_id: `tr_${id}`, stripe_reversal_id: null, stripe_refund_id: 're_cruscotto',
    internal_dispute_status: null, wallet_applied_cents: 0,
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: null,
    shipping_cost: 0,
    ...extra,
  };
}

const o1 = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const reso = () =>
  refundOrder({ orderId: 'o1', amountCents: 2000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
const sommaStorni = () => stato.storni.reduce((s, x) => s + x.amount, 0);

beforeEach(() => {
  stato.suStripe = [
    // Il rimborso dal cruscotto: nessun ordine nei metadati, già diviso ed etichettato.
    { id: 're_cruscotto', amount: 3000, status: 'succeeded', metadata: { mycity_registrato: '1' }, chiave: null },
  ];
  stato.creati = [];
  stato.rispostePerse = 0;
  stato.chiaviScadute = false;
  stato.storni = [];
  stato.db = fintoDatabase({
    orders: [ordine('o1', 4000, 500), ordine('o2', 6000, 2500)],
    profiles: [{ id: 'admin1', role: 'admin' }],
    notifications: [],
    audit_logs: [{
      id: 'divisione-1', action: 'order.refund', target_table: 'orders', target_id: null,
      metadata: { origine: 'divisione_del_rimborso_dal_cruscotto', pagamento: 'pi_1', rimborsi: ['re_cruscotto'], parti: { o1: 500, o2: 2500 } },
    }],
  });
  stato.db.rispostaRpc = (nome, a) => {
    const riga = stato.db.tabelle.orders!.find((r) => r.id === a.p_order_id);
    if (nome === 'accumula_rimborso' && riga) {
      const tot = Number(riga.gross_total_cents);
      const nuovo = Number(riga.refunded_amount_cents ?? 0) + Number(a.p_delta);
      if (nuovo > tot) return { data: [], error: null };
      riga.refunded_amount_cents = nuovo;
      return { data: [{ totale_rimborsato: nuovo, totale_ordine: tot }], error: null };
    }
    if (nome === 'storna_rimborso' && riga) {
      riga.refunded_amount_cents = Number(riga.refunded_amount_cents ?? 0) - Number(a.p_delta);
    }
    return { data: null, error: null };
  };
});

describe('R03-006 — il reso ripreso non toglie di nuovo la quota dopo un rimborso diviso', () => {
  it('reso da 20 € su o1 ripreso dopo un guasto: 18 € stornati una volta, o1 a 25 €, nessun secondo rimborso', async () => {
    await reso();
    expect(o1().refunded_amount_cents).toBe(2500);
    // La scrittura sul reso cade: il negozio riprova con la stessa chiave.
    await reso();
    expect(stato.creati).toEqual([2000]);
    expect(sommaStorni(), 'al negozio la quota si toglie una volta sola').toBe(1800);
    expect(o1().refunded_amount_cents, 'o1 non risulta rimborsato per intero').toBe(2500);
  });

  it('un rimborso senza ordine che nessuna divisione ha scritto si conta ancora per intero', async () => {
    stato.db.tabelle.audit_logs = [];
    await reso();
    await reso();
    expect(stato.creati).toEqual([2000]);
  });
});
