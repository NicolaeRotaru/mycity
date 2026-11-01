import { describe, it, expect, vi } from 'vitest';
import type { FintoDatabase, Riga } from './aiuti/finto-database-dei-rimborsi';
import { creaFintoDatabase, creditoDi, notificheConTitolo } from './aiuti/finto-database-dei-rimborsi';

// Collaudo B, ricollaudo S1: varianti del freno del credito gia' uscito.
const finto = vi.hoisted(() => ({
  db: null as unknown as FintoDatabase,
  diarioMutoDopoAccredito: false,
  diarioAppesoDopoAccredito: false,
  accreditato: false,
}));

vi.mock('@/lib/supabase/server', () => {
  const client = () => {
    const vero = finto.db.client;
    return {
      ...vero,
      rpc: async (nome: string, args?: Record<string, unknown>) => {
        const r = await vero.rpc(nome, args);
        if (nome === 'wallet_credit') {
          finto.accreditato = true;
          if (finto.diarioMutoDopoAccredito) { finto.diarioMutoDopoAccredito = false; finto.db.guasti.diarioIlleggibile = 1; }
        }
        return r;
      },
      from: (t: string) => {
        if (t === 'wallet_ledger' && finto.diarioAppesoDopoAccredito && finto.accreditato) {
          finto.diarioAppesoDopoAccredito = false;
          const appesa: Record<string, unknown> = {};
          appesa.select = () => appesa; appesa.eq = () => appesa; appesa.maybeSingle = () => appesa;
          appesa.then = () => new Promise(() => {}); // la funzione resta appesa: Vercel la chiude
          return appesa;
        }
        return vero.from(t);
      },
    };
  };
  return { getAdminSupabase: () => client(), getServerSupabase: async () => client() };
});
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => true,
  getStripe: () => ({
    refunds: { create: vi.fn(async () => ({ id: 're_x' })), list: vi.fn(async () => ({ data: [], has_more: false })) },
    transfers: { createReversal: vi.fn(async () => ({ id: 'trr_1' })), listReversals: vi.fn(async () => ({ data: [] })) },
  }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => {}) }));

import { refundOrder } from '@/lib/stripe/payout';

const O = 'a1b2c3d4-1111-4111-8111-111111111111';
function soloCredito(extra: Riga = {}): Riga {
  return {
    id: O, user_id: 'giulia', seller_id: 'negozio',
    total_price: 0, gross_total_cents: 4000, wallet_applied_cents: 4000,
    seller_payout_cents: 3600, seller_payout_reversed_cents: 0, payout_status: 'AWAITING_REMITTANCE',
    stripe_payment_intent: null, stripe_transfer_id: null, stripe_reversal_id: null, stripe_refund_id: null,
    refunded_amount_cents: 0, payment_method: 'cod',
    rider_id: null, rider_transfer_id: null, rider_payout_status: null, rider_payout_reversed_cents: 0,
    rider_fee_cents: 0, shipping_cost: 0,
    delivery_status: 'DELIVERED', payment_status: 'PAID', cash_confirmed_at: '2026-10-10T18:00:00Z',
    internal_dispute_status: null,
    ...extra,
  };
}
function nuovo(extra: Riga = {}) {
  finto.diarioMutoDopoAccredito = false; finto.diarioAppesoDopoAccredito = false; finto.accreditato = false;
  finto.db = creaFintoDatabase({ orders: [soloCredito(extra)], profiles: [{ id: 'admin-1', role: 'admin' }], notifications: [] });
}
const ordine = () => finto.db.tabelle.orders[0];

describe('ricollaudo B: credito gia uscito e prenotazione stornata', () => {
  for (const [altro, questo] of [[2000, 2000], [2500, 1500], [1000, 1000]] as const) {
    it(`un altro reso da ${altro} gia contato, poi guasto doppio su questo da ${questo}: il ritentativo lo registra`, async () => {
      nuovo();
      await refundOrder({ orderId: O, amountCents: altro, idempotencyKey: 'return_r0' });
      expect(ordine().refunded_amount_cents).toBe(altro);
      // accredito che perde la risposta + diario muto subito dopo: si storna la prenotazione
      finto.db.guasti.walletCreditaPoiCade = true;
      finto.diarioMutoDopoAccredito = true;
      await expect(refundOrder({ orderId: O, amountCents: questo, idempotencyKey: 'return_r1' })).rejects.toThrow();
      expect(ordine().refunded_amount_cents, 'prenotazione stornata').toBe(altro);
      expect(creditoDi(finto.db, 'giulia')).toBe(altro + questo);
      // il negozio riprova
      await refundOrder({ orderId: O, amountCents: questo, idempotencyKey: 'return_r1' });
      expect(creditoDi(finto.db, 'giulia')).toBe(altro + questo);
      expect(ordine().refunded_amount_cents, 'credito uscito ma non contato sull ordine').toBe(altro + questo);
      expect(ordine().seller_payout_reversed_cents, 'quota del negozio non ripresa').toBe(Math.round(((altro + questo) * 3600) / 4000));
    });
  }

  it('la funzione resta appesa dopo l accredito (Vercel la chiude): il ritentativo con la stessa chiave toglie la quota una volta e scrive lo stato', async () => {
    nuovo();
    finto.diarioAppesoDopoAccredito = true;
    void refundOrder({ orderId: O, amountCents: 2000, idempotencyKey: 'return_r1' });
    await new Promise((r) => setTimeout(r, 50));
    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    const esito = await refundOrder({ orderId: O, amountCents: 2000, idempotencyKey: 'return_r1' });
    console.log('APPESA', JSON.stringify({ esito, rimborsato: ordine().refunded_amount_cents, ripreso: ordine().seller_payout_reversed_cents, pagamento: ordine().payment_status, avvisi: (finto.db.tabelle.notifications ?? []).map((n) => n.title) }));
    expect(creditoDi(finto.db, 'giulia')).toBe(2000);
    expect(ordine().refunded_amount_cents).toBe(2000);
    const avvisato = (finto.db.tabelle.notifications ?? []).length > 0;
    const quotaPresa = ordine().seller_payout_reversed_cents === 1800 && ordine().payment_status === 'PARTIALLY_REFUNDED';
    expect(quotaPresa || avvisato, 'quota non ripresa, stato PAID e nessun avviso a chi amministra').toBe(true);
  });

  it('dispute + reso sullo stesso ordine: il reso col guasto doppio si registra anche se la contestazione ha gia rimborsato 20', async () => {
    nuovo();
    await refundOrder({ orderId: O, amountCents: 2000, idempotencyKey: 'dispute_d1' });
    finto.db.guasti.walletCreditaPoiCade = true;
    finto.diarioMutoDopoAccredito = true;
    await expect(refundOrder({ orderId: O, amountCents: 2000, idempotencyKey: 'return_r1' })).rejects.toThrow();
    await refundOrder({ orderId: O, amountCents: 2000, idempotencyKey: 'return_r1' });
    console.log('DISPUTE', JSON.stringify({ rimborsato: ordine().refunded_amount_cents, ripreso: ordine().seller_payout_reversed_cents, pagamento: ordine().payment_status, credito: creditoDi(finto.db, 'giulia'), avvisi: notificheConTitolo(finto.db, '').length }));
    expect(ordine().refunded_amount_cents).toBe(4000);
    expect(ordine().payment_status).toBe('REFUNDED');
  });
});
