import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R17-017 — La protezione dal doppio bonifico al negozio e al fattorino non dura solo 24 ore.
 *
 * Lunedì alle 10 parte il bonifico da 22,50 € al negozio e la risposta di Stripe si perde: l'ordine
 * torna HELD. Un reso aperto lo ferma fino a mercoledì; il giro di mercoledì lo ritenta. La chiave di
 * idempotenza Stripe la tiene 24 ore: prima, senza quota tolta al negozio, l'elenco dei bonifici non
 * si guardava e partiva un secondo bonifico. Il fattorino non aveva nessun controllo. Adesso l'elenco
 * di Stripe si guarda prima di ogni bonifico, e se non risponde dopo un turno di prima (scritto nel
 * database prima di chiamare Stripe) non si rifà il bonifico alla cieca.
 */

type Bonifico = { id: string; amount: number; metadata: Record<string, string>; chiave: string; creato: number };

const stato: {
  db: FintoDatabase;
  suStripe: Bonifico[];
  rispostaPersa: boolean;
  elencoGiu: boolean;
} = { db: fintoDatabase({}), suStripe: [], rispostaPersa: false, elencoGiu: false };

const VENTIQUATTRO_ORE = 24 * 3_600_000;

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    transfers: {
      create: async (p: { amount: number; metadata: Record<string, string> }, o: { idempotencyKey: string }) => {
        // La chiave vale 24 ore: dopo, Stripe non la ricorda più.
        const gia = stato.suStripe.find((b) => b.chiave === o.idempotencyKey && Date.now() - b.creato < VENTIQUATTRO_ORE);
        if (gia) return { id: gia.id };
        const nuovo = { id: `tr_${stato.suStripe.length + 1}`, amount: p.amount, metadata: { ...p.metadata }, chiave: o.idempotencyKey, creato: Date.now() };
        stato.suStripe.push(nuovo);
        if (stato.rispostaPersa) {
          stato.rispostaPersa = false;
          throw new Error('socket hang up');
        }
        return { id: nuovo.id };
      },
      list: async () => {
        if (stato.elencoGiu) throw new Error('Stripe non risponde');
        return { data: stato.suStripe.map((b) => ({ id: b.id, amount: b.amount, metadata: { ...b.metadata } })) };
      },
    },
  }),
}));

import { releaseOrderPayout, releaseRiderPayout } from '@/lib/stripe/payout';

const ordine = () => stato.db.tabelle.orders!.find((r) => r.id === 'o1')!;

function ordineConsegnato(extra: Riga = {}): Riga {
  return {
    id: 'o1', seller_id: 'negozio1', rider_id: 'fattorino1',
    payout_status: 'HELD', seller_payout_cents: 2250, seller_payout_reversed_cents: 0, payout_tentativo: 0,
    payout_claimed_at: null, stripe_charge_id: 'ch_1', stripe_transfer_group: 'order_o1', stripe_transfer_id: null,
    delivery_status: 'DELIVERED', payment_method: 'card', delivered_at: '2026-11-16T08:00:00.000Z',
    rider_payout_status: null, rider_payout_claimed_at: null, rider_fee_cents: 390, shipping_cost: 3.9, rider_payout_tentativo: 0,
    total_price: 30, pickup_in_store: false, cash_confirmed_at: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T10:00:00.000Z'));
  stato.suStripe = [];
  stato.rispostaPersa = false;
  stato.elencoGiu = false;
  stato.db = fintoDatabase({
    orders: [ordineConsegnato()],
    profiles: [
      { id: 'negozio1', stripe_account_id: 'acct_negozio', stripe_payouts_enabled: true },
      { id: 'fattorino1', stripe_account_id: 'acct_fattorino', stripe_payouts_enabled: true },
    ],
  });
});

describe('R17-017 · il bonifico con la risposta persa non si rifà dopo 24 ore', () => {
  it('al negozio: lunedì la risposta si perde, mercoledì il giro registra il bonifico di lunedì invece di farne un secondo', async () => {
    stato.rispostaPersa = true;
    const lunedi = await releaseOrderPayout('o1');
    expect(lunedi.ok).toBe(false);
    expect(ordine().payout_status).toBe('HELD');
    expect(stato.suStripe.map((b) => b.amount)).toEqual([2250]);

    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const mercoledi = await releaseOrderPayout('o1');

    expect(mercoledi).toEqual({ ok: true, transferId: 'tr_1' });
    expect(stato.suStripe.map((b) => b.amount)).toEqual([2250]);
    expect(ordine().payout_status).toBe('TRANSFERRED');
    expect(ordine().stripe_transfer_id).toBe('tr_1');
  });

  it('al negozio: se dopo un turno di prima l elenco di Stripe non risponde, il bonifico non si rifà alla cieca', async () => {
    stato.rispostaPersa = true;
    await releaseOrderPayout('o1');
    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    stato.elencoGiu = true;

    const esito = await releaseOrderPayout('o1');

    expect(esito.ok).toBe(false);
    expect(stato.suStripe).toHaveLength(1);
    expect(ordine().payout_status).toBe('HELD');
  });

  it('al fattorino: lunedì la risposta si perde, mercoledì il compenso di lunedì si registra, non si paga due volte', async () => {
    stato.rispostaPersa = true;
    const lunedi = await releaseRiderPayout('o1');
    expect(lunedi.ok).toBe(false);
    expect(ordine().rider_payout_status).toBe('HELD');
    expect(stato.suStripe[0].metadata).toMatchObject({ kind: 'rider_fee', tentativo: '0' });

    vi.setSystemTime(new Date('2026-11-18T10:00:00.000Z'));
    const mercoledi = await releaseRiderPayout('o1');

    expect(mercoledi).toEqual({ ok: true, transferId: 'tr_1' });
    expect(stato.suStripe.map((b) => b.amount)).toEqual([390]);
    expect(ordine().rider_payout_status).toBe('TRANSFERRED');
    expect(ordine().rider_transfer_id).toBe('tr_1');
  });

  it('il bonifico al fattorino non viene scambiato per quello del negozio, e viceversa', async () => {
    await releaseRiderPayout('o1');
    const esito = await releaseOrderPayout('o1');
    expect(esito).toEqual({ ok: true, transferId: 'tr_2' });
    expect(stato.suStripe.map((b) => b.amount)).toEqual([390, 2250]);
  });
});
