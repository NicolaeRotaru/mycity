import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fintoDatabase, type FintoDatabase, type Riga } from './aiuti/finto-database-dei-pagamenti';

/**
 * 14/11/2026 (R17-013 correzione) — IL RIMBORSO DAL CRUSCOTTO CHE CHIUDE L'ORDINE
 * PRENDE AL NEGOZIO QUELLO CHE GLI RESTA, COME `refundOrder`.
 *
 * Il caso del collaudo: ordine con la carta da 19 € (al forno 13,50 €). L'euro
 * della veloce torna al cliente senza toccare il forno (quota 0, è di MyCity).
 * Poi i 18 € che restano escono dal cruscotto Stripe e chi amministra li scrive
 * sull'ordine (`registraSullOrdine`). Prima la quota del forno era la
 * proporzione sul lordo intero: 18 × 13,50 / 19 = 12,79 €, e 71 centesimi
 * restavano al forno su un ordine rimborsato tutto. Adesso è quello che gli
 * resta: 13,50 €. I parziali, e gli ordini con uno storno caduto
 * (REVERSAL_FAILED), restano in proporzione.
 */

const stato: {
  db: FintoDatabase;
  storni: Array<{ transferId: string; amount: number; chiave: string }>;
} = { db: fintoDatabase(), storni: [] };

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/supabase/server', () => ({ getAdminSupabase: () => stato.db.client }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: {
      create: async () => { throw new Error('qui nessuno deve chiedere un rimborso a Stripe: è già uscito'); },
      list: async () => ({ data: [], has_more: false }),
      update: async (id: string) => ({ id }),
    },
    transfers: {
      createReversal: async (transferId: string, p: { amount: number }, o: { idempotencyKey: string }) => {
        if (!stato.storni.some((s) => s.chiave === o.idempotencyKey)) {
          stato.storni.push({ transferId, amount: p.amount, chiave: o.idempotencyKey });
        }
        return { id: `trr_${o.idempotencyKey}` };
      },
      list: async () => ({ data: [] }),
    },
  }),
}));

import { registraSullOrdine, type OrdineDelRimborso } from '@/lib/stripe/webhook/rimborsi-da-fuori';

/** L'ordine dopo l'euro della veloce: 19 € pagati, 1 € già reso, al forno non è stato tolto niente. */
function ordineDopoLEuroDellaVeloce(extra: Riga = {}): Riga {
  return {
    id: 'o1',
    seller_id: 'forno',
    total_price: 19,
    gross_total_cents: 1900,
    refunded_amount_cents: 100,
    payment_method: 'card',
    payment_status: 'PARTIALLY_REFUNDED',
    delivery_status: 'DELIVERED',
    payout_status: 'HELD',
    seller_payout_cents: 1350,
    seller_payout_reversed_cents: 0,
    stripe_transfer_id: null,
    stripe_reversal_id: null,
    stripe_refund_id: 're_veloce',
    internal_dispute_status: null,
    reversal_error: null,
    ...extra,
  };
}

function riga(): Riga {
  return stato.db.tabelle.orders[0];
}

/** L'ordine come lo legge chi registra: una copia, come dal database. */
function letto(): OrdineDelRimborso {
  return { ...riga() } as unknown as OrdineDelRimborso;
}

beforeEach(() => {
  stato.db = fintoDatabase({ orders: [], profiles: [{ id: 'admin1', role: 'admin' }], notifications: [] });
  stato.storni = [];
});

describe('R17-013 — il rimborso dal cruscotto che chiude l ordine prende quello che resta al negozio', () => {
  it('bonifico non ancora partito: la quota tolta dal bonifico da fare è 13,50 €, non 12,79 €', async () => {
    stato.db.tabelle.orders.push(ordineDopoLEuroDellaVeloce());

    const conto = await registraSullOrdine(letto(), 1800, { chargeId: 'ch_1', rimborsi: ['re_cruscotto'] });

    expect(conto.quotaNegozioCents).toBe(1350);
    expect(riga().refunded_amount_cents).toBe(1900);
    expect(riga().payment_status).toBe('REFUNDED');
    // Al forno, su un ordine rimborsato tutto, non resta niente da versare.
    expect(riga().seller_payout_reversed_cents).toBe(1350);
    expect(stato.storni).toEqual([]);
  });

  it('bonifico già partito: lo storno chiesto a Stripe è 13,50 €, non 12,79 €', async () => {
    stato.db.tabelle.orders.push(ordineDopoLEuroDellaVeloce({ payout_status: 'TRANSFERRED', stripe_transfer_id: 'tr_forno' }));

    const conto = await registraSullOrdine(letto(), 1800, { chargeId: 'ch_1', rimborsi: ['re_cruscotto'] });

    expect(conto.quotaNegozioCents).toBe(1350);
    expect(stato.storni.map((s) => [s.transferId, s.amount])).toEqual([['tr_forno', 1350]]);
    expect(riga().seller_payout_reversed_cents).toBe(1350);
    expect(riga().payout_status).toBe('REVERSED');
  });

  it('se al negozio era già stato tolto qualcosa, prende solo quello che resta', async () => {
    // Un reso di prima gli aveva già tolto 2,00 €: restano 11,50 €.
    stato.db.tabelle.orders.push(ordineDopoLEuroDellaVeloce({ seller_payout_reversed_cents: 200 }));

    const conto = await registraSullOrdine(letto(), 1800, { chargeId: 'ch_1', rimborsi: ['re_cruscotto'] });

    expect(conto.quotaNegozioCents).toBe(1150);
    expect(riga().seller_payout_reversed_cents).toBe(1350);
  });

  it('un rimborso parziale resta in proporzione', async () => {
    stato.db.tabelle.orders.push(ordineDopoLEuroDellaVeloce());

    const conto = await registraSullOrdine(letto(), 900, { chargeId: 'ch_1', rimborsi: ['re_cruscotto'] });

    // 9 × 13,50 / 19 = 6,39 €
    expect(conto.quotaNegozioCents).toBe(639);
    expect(riga().refunded_amount_cents).toBe(1000);
    expect(riga().payment_status).toBe('PARTIALLY_REFUNDED');
    expect(riga().seller_payout_reversed_cents).toBe(639);
  });

  it('con uno storno caduto prima (REVERSAL_FAILED) resta in proporzione: quello che resta non si sa', async () => {
    stato.db.tabelle.orders.push(ordineDopoLEuroDellaVeloce({ payout_status: 'REVERSAL_FAILED', stripe_transfer_id: 'tr_forno' }));

    const conto = await registraSullOrdine(letto(), 1800, { chargeId: 'ch_1', rimborsi: ['re_cruscotto'] });

    expect(conto.quotaNegozioCents).toBe(1279);
    expect(stato.storni).toEqual([]);
    // Si dice a chi amministra quanto recuperare a mano.
    const avvisi = (stato.db.tabelle.notifications ?? []).map((n) => String(n.body ?? n.message ?? ''));
    expect(avvisi.some((t) => t.includes('12,79'))).toBe(true);
  });
});
