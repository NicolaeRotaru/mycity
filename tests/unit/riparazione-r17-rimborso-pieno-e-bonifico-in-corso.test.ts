import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { creaLibro, creaStripe, ordineConCarta, type Libro, type StripeFinto } from './aiuti/riparazione-r17-libro-dei-rimborsi-finto';
import type { Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * R17-025 — Un rimborso pieno che arriva mentre parte il bonifico non lascia al negozio la sua quota.
 *
 * Il 20/11 Nicola rimborsa per intero un ordine da 30 € negli stessi secondi in cui il giro versa
 * 27 € a Pane Quotidiano. Prima: il rimborso pieno dal cruscotto stornava solo su TRANSFERRED e su
 * PROCESSING scriveva REFUNDED; poi il giro scriveva TRANSFERRED sopra, solo per id. Lo stesso con
 * `refundOrder`. La cliente riprendeva 30 €, il forno teneva 27 €, e nessuno lo sapeva.
 * Adesso: il webhook col bonifico in corso aspetta (Stripe ripete); il giro scrive TRANSFERRED solo su
 * PROCESSING e, se un rimborso pieno ha chiuso il bonifico mentre partiva, lo storna; e chi scrive
 * REFUNDED dopo che il giro ha pagato se ne accorge e storna.
 */

type Bonifico = { id: string; amount: number };
const stato: {
  libro: Libro;
  stripe: StripeFinto;
  bonifici: Bonifico[];
  durante: null | (() => Promise<void>);
  createRifiutato: boolean;
} = { libro: creaLibro({}), stripe: creaStripe(), bonifici: [], durante: null, createRifiutato: false };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.libro.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => {
    const base = stato.stripe.client() as { refunds: unknown; transfers: Record<string, unknown> };
    return {
      ...base,
      transfers: {
        ...base.transfers,
        create: async (p: { amount: number }) => {
          // Mentre il bonifico è in viaggio succede qualcos'altro sullo stesso ordine.
          const durante = stato.durante;
          stato.durante = null;
          if (durante) await durante();
          if (stato.createRifiutato) throw new Error('Stripe: insufficient funds');
          const nuovo = { id: `tr_${stato.bonifici.length + 1}`, amount: p.amount };
          stato.bonifici.push(nuovo);
          return { id: nuovo.id };
        },
        list: async () => ({ data: [] }),
        retrieve: async (id: string) => {
          const b = stato.bonifici.find((x) => x.id === id);
          return { id, amount: b?.amount ?? 0, amount_reversed: 0 };
        },
      },
    };
  },
}));

import { refundOrder, releaseOrderPayout } from '@/lib/stripe/payout';
import { handleChargeRefunded } from '@/lib/stripe/webhook/rimborsi';

const ordine = () => stato.libro.db.tabelle.orders!.find((r) => r.id === 'o1')!;
const sommaStorni = () => stato.stripe.storni.reduce((s, x) => s + x.amount, 0);
const rimborsoPieno = () => refundOrder({ orderId: 'o1', amountCents: 3000, reason: 'reso', metadata: { return_id: 'r1' }, idempotencyKey: 'return_r1' });
const caricaRimborsataTutta = {
  id: 'ch_1', object: 'charge', payment_intent: 'pi_1', refunded: true, amount: 3000, amount_refunded: 3000,
  refunds: { object: 'list', data: [{ id: 're_cruscotto', reason: 'requested_by_customer' }], has_more: false },
} as never;

/** Il giro dei bonifici che finisce di pagare proprio mentre questa scrittura sta per passare. */
function ilGiroPagaPrimaDi(scrittura: (v: Riga) => boolean) {
  let fatto = false;
  stato.libro.db.guasto = (s) => {
    const v = s.valori as Riga | null;
    if (!fatto && s.tabella === 'orders' && s.operazione === 'update' && v && scrittura(v)) {
      fatto = true;
      stato.bonifici.push({ id: 'tr_9', amount: 2700 });
      Object.assign(ordine(), { payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_9' });
    }
    return null;
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T10:00:00.000Z'));
  stato.stripe = creaStripe();
  stato.bonifici = [];
  stato.durante = null;
  stato.createRifiutato = false;
  stato.libro = creaLibro({
    orders: [
      ordineConCarta({
        total_price: 30, gross_total_cents: 3000, seller_payout_cents: 2700,
        payout_status: 'HELD', stripe_transfer_id: null, stripe_charge_id: 'ch_1', stripe_transfer_group: 'order_o1',
        payout_tentativo: 0, payout_claimed_at: null, delivered_at: '2026-11-20T08:00:00.000Z', coupon_code: null,
      }),
    ],
    profiles: [
      { id: 'admin1', role: 'admin' },
      { id: 'negozio1', role: 'seller', stripe_account_id: 'acct_forno', stripe_payouts_enabled: true },
    ],
    notifications: [],
  });
});
afterEach(() => vi.useRealTimers());

describe('R17-025 · il rimborso pieno e il bonifico in corso', () => {
  it('il rimborso pieno dal cruscotto col bonifico in corso aspetta: Stripe ripete, niente REFUNDED sotto il giro', async () => {
    ordine().payout_status = 'PROCESSING';

    await expect(handleChargeRefunded(caricaRimborsataTutta)).rejects.toThrow(/bonifico al negozio in corso/);

    expect(ordine().payout_status).toBe('PROCESSING');
    expect(ordine().payment_status).toBe('PAID');
  });

  it('il giro che paga fra la lettura e la scrittura del rimborso dal cruscotto: i 27 € si stornano', async () => {
    ilGiroPagaPrimaDi((v) => v.payment_status === 'REFUNDED');

    await handleChargeRefunded(caricaRimborsataTutta);

    expect(sommaStorni()).toBe(2700);
    expect(ordine().payout_status).toBe('REVERSED');
    expect(ordine().seller_payout_reversed_cents).toBe(2700);
  });

  it('refundOrder pieno mentre parte il bonifico: il giro trova REFUNDED, non ci scrive sopra e storna i 27 €', async () => {
    stato.durante = async () => { await rimborsoPieno(); };

    const esito = await releaseOrderPayout('o1');

    expect(esito).toMatchObject({ ok: true, code: 'NOTHING_TO_PAY' });
    expect(stato.bonifici.map((b) => b.amount)).toEqual([2700]);
    expect(sommaStorni()).toBe(2700);
    expect(ordine().payout_status).toBe('REVERSED');
    expect(ordine().stripe_transfer_id).toBe('tr_1');
    expect(ordine().seller_payout_reversed_cents).toBe(2700);
  });

  it('il bonifico che fallisce mentre un rimborso pieno ha chiuso l ordine non torna HELD', async () => {
    stato.durante = async () => { await rimborsoPieno(); };
    stato.createRifiutato = true;

    const esito = await releaseOrderPayout('o1');

    expect(esito.ok).toBe(false);
    expect(ordine().payout_status).toBe('REFUNDED');
  });

  it('refundOrder pieno che scrive REFUNDED dopo che il giro ha pagato: se ne accorge e storna i 27 €', async () => {
    ilGiroPagaPrimaDi((v) => v.payout_status === 'REFUNDED');

    await rimborsoPieno();

    expect(sommaStorni()).toBe(2700);
    expect(ordine().payout_status).toBe('REVERSED');
    expect(ordine().stripe_transfer_id).toBe('tr_9');
  });
});
