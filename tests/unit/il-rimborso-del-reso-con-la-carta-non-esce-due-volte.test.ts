import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, TIMEOUT, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 1/11/2026 — IL RIMBORSO DEL RESO CON LA CARTA NON ESCE DUE VOLTE.
 *
 * Le rotte dei resi passano a `refundOrder` la chiave `return_<id>`, una per
 * tutto il reso. Ordine con carta da 40 €, bonifico al negozio gia' partito
 * (36 € di sua parte). Il negozio approva il reso con 20 € di rimborso: Stripe
 * rimborsa 20 € e al negozio si stornano 18 €. Poi un passo dopo cade (la
 * scrittura sul reso, l'elenco dei rimborsi, la risposta di Stripe) e il
 * negozio riprova con la stessa chiave: prima si prenotava di nuovo, al negozio
 * si toglievano altri 18 € e, dopo le 24 ore della chiave, il cliente riceveva
 * i 20 € una seconda volta.
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

function ordineConCarta(extra: Riga = {}): Riga {
  return {
    id: 'o1', user_id: 'cliente1', seller_id: 'negozio1',
    total_price: 40, gross_total_cents: 4000, refunded_amount_cents: 0,
    payment_method: 'card', payment_status: 'PAID', delivery_status: 'DELIVERED',
    payout_status: 'TRANSFERRED', seller_payout_cents: 3600, seller_payout_reversed_cents: 0,
    stripe_payment_intent: 'pi_1', stripe_transfer_id: 'tr_1', stripe_reversal_id: null, stripe_refund_id: null,
    internal_dispute_status: null, wallet_applied_cents: 0,
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0, rider_fee_cents: null,
    shipping_cost: 0,
    ...extra,
  };
}

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const reso = (cifra = 2000) =>
  refundOrder({ orderId: 'o1', amountCents: cifra, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
const sommaStorni = () => stato.storni.reduce((s, x) => s + x.amount, 0);

beforeEach(() => {
  stato.suStripe = [];
  stato.creati = [];
  stato.rispostePerse = 0;
  stato.chiaviScadute = false;
  stato.storni = [];
  stato.prenotazionePersa = false;
  stato.riletturaCade = false;
  stato.db = fintoDatabase({
    orders: [ordineConCarta()],
    profiles: [{ id: 'admin1', role: 'admin' }, { id: 'negozio1', role: 'seller' }],
    notifications: [],
  });
  stato.db.guastoLettura = (t) => (t === 'orders' && stato.riletturaCade ? TIMEOUT : null);
  stato.db.rispostaRpc = (nome, a) => {
    const riga = stato.db.tabelle.orders!.find((r) => r.id === a.p_order_id);
    if (nome === 'accumula_rimborso' && riga) {
      const tot = Number(riga.gross_total_cents);
      const nuovo = Number(riga.refunded_amount_cents ?? 0) + Number(a.p_delta);
      if (nuovo > tot) return { data: [], error: null };
      riga.refunded_amount_cents = nuovo;
      if (stato.prenotazionePersa) return { data: null, error: TIMEOUT };
      return { data: [{ totale_rimborsato: nuovo, totale_ordine: tot }], error: null };
    }
    if (nome === 'storna_rimborso' && riga) {
      riga.refunded_amount_cents = Number(riga.refunded_amount_cents ?? 0) - Number(a.p_delta);
    }
    return { data: null, error: null };
  };
});

describe('lo stesso reso con la carta, ripreso dopo un guasto', () => {
  it('ripreso entro 24 ore: al negozio la sua parte si toglie una volta, il totale non raddoppia', async () => {
    await reso();
    // La scrittura sul reso cade: il negozio segue «Rimborsa e chiudi».
    await reso();
    expect(stato.creati).toEqual([2000]);
    expect(sommaStorni()).toBe(1800);
    expect(ordine().refunded_amount_cents).toBe(2000);
  });

  it('ripreso dopo 24 ore: il cliente non riceve i soldi due volte', async () => {
    await reso();
    stato.chiaviScadute = true;
    const esito = await reso();
    expect(stato.creati).toEqual([2000]);
    expect(esito.refundId).toBe('re_1');
    expect(sommaStorni()).toBe(1800);
  });

  it('cade anche l elenco dei rimborsi dell ordine: «rimborsato» non rimborsa la carta di nuovo', async () => {
    stato.db.guasto = (s) =>
      s.tabella === 'orders' && s.operazione === 'update' && !Array.isArray(s.valori) && s.valori && 'stripe_refund_id' in s.valori ? TIMEOUT : null;
    await reso();
    stato.db.guasto = () => null;
    stato.chiaviScadute = true;
    await reso();
    expect(stato.creati).toEqual([2000]);
    expect(sommaStorni()).toBe(1800);
    expect(ordine().refunded_amount_cents).toBe(2000);
  });

  it('carrello di due negozi: il rimborso dell altro ordine sullo stesso pagamento non confonde il conto', async () => {
    stato.suStripe.push({ id: 're_fuori', amount: 1000, status: 'succeeded', metadata: { registrato_da_fuori: '1', order_id: 'altro' }, chiave: null });
    await reso();
    await reso();
    expect(stato.storni.map((s) => s.amount)).toEqual([1800]);
    expect(ordine().refunded_amount_cents).toBe(2000);
  });

  it('risposta di Stripe persa, ordine senza altri rimborsi, ripreso dopo 24 ore: un rimborso solo, contato una volta', async () => {
    stato.rispostePerse = 1;
    await expect(reso()).rejects.toThrow();
    expect(ordine().refunded_amount_cents).toBe(0);
    stato.chiaviScadute = true;
    const esito = await reso();
    expect(stato.creati).toEqual([2000]);
    expect(esito.refundId).toBe('re_1');
    expect(ordine().refunded_amount_cents).toBe(2000);
    expect(sommaStorni()).toBe(1800);
  });

  it('importi piccoli (9 €) e un rimborso pieno sopra 30 € seguono la stessa regola', async () => {
    await reso(900);
    await reso(900);
    expect(stato.creati).toEqual([900]);
    stato.db.tabelle.orders = [ordineConCarta({ id: 'o1' })];
    stato.suStripe = [];
    stato.creati = [];
    await refundOrder({ orderId: 'o1', amountCents: 4000, metadata: { return_id: 'r9' }, idempotencyKey: 'return_r9' });
    stato.chiaviScadute = true;
    await refundOrder({ orderId: 'o1', amountCents: 4000, metadata: { return_id: 'r9' }, idempotencyKey: 'return_r9' });
    expect(stato.creati).toEqual([4000]);
  });
});

describe('la prenotazione del rimborso con la risposta persa', () => {
  it('scritta ma senza risposta: si toglie, e il secondo tentativo rimborsa invece di leggere «gia rimborsato»', async () => {
    stato.prenotazionePersa = true;
    await expect(reso(4000)).rejects.toThrow();
    expect(ordine().refunded_amount_cents).toBe(0);
    expect(stato.creati).toEqual([]);
    stato.prenotazionePersa = false;
    await reso(4000);
    expect(stato.creati).toEqual([4000]);
    expect(ordine().refunded_amount_cents).toBe(4000);
  });

  it('se non si riesce neanche a rileggere l ordine, chi amministra viene avvisato', async () => {
    stato.prenotazionePersa = true;
    stato.db.rispostaRpc = ((orig) => (nome: string, a: Record<string, unknown>) => {
      const r = orig(nome, a);
      if (nome === 'accumula_rimborso') stato.riletturaCade = true;
      return r;
    })(stato.db.rispostaRpc);
    await expect(reso(4000)).rejects.toThrow();
    expect(stato.creati).toEqual([]);
    expect((stato.db.tabelle.notifications ?? []).length).toBeGreaterThan(0);
  });
});
