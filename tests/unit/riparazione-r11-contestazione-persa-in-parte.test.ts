import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * R11-023 — Una contestazione persa su una parte del carrello segnava persi,
 * rimborsati per intero (e, se non consegnati, annullati con la merce rimessa a
 * scaffale) anche gli ordini degli altri negozi. Carrello da 50 €: forno 30,
 * salumeria 20; la banca contesta e vince 20 €.
 */

const stato = vi.hoisted(() => ({
  ordini: [] as Record<string, unknown>[],
  scritture: [] as Record<string, unknown>[],
  rpc: [] as string[],
  avvisi: [] as string[],
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({}) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  findOrdersForDispute: async () => stato.ordini,
  notifyAdmins: vi.fn(async (titolo: string) => {
    stato.avvisi.push(titolo);
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string) => {
      stato.rpc.push(nome);
      return { data: null, error: null };
    },
    from: () => {
      const c: Record<string, unknown> = {};
      c.update = (v: Record<string, unknown>) => {
        stato.scritture.push(v);
        return c;
      };
      c.in = () => c;
      c.eq = () => c;
      (c as { then: unknown }).then = (ok: (v: unknown) => void) => ok({ data: null, error: null });
      return c;
    },
  }),
}));

import { handleDisputeClosed } from '@/lib/stripe/webhook/dispute';

const ordine = (id: string, lordo: number, consegna: string) => ({
  id, gross_total_cents: lordo, total_price: lordo / 100, delivery_status: consegna, dispute_status: 'OPEN',
  payment_status: 'PAID', payout_status: 'HELD', seller_payout_cents: Math.round(lordo * 0.9), seller_payout_reversed_cents: 0,
  dispute_seller_reversed_cents: 0, rider_id: null, rider_payout_status: null,
});
const persa = (amount: number) =>
  ({ id: 'dp_carrello', status: 'lost', amount, payment_intent: 'pi_carrello', charge: 'ch_carrello' }) as unknown as Stripe.Dispute;

beforeEach(() => {
  stato.ordini = [ordine('forno-ord', 3000, 'DELIVERED'), ordine('salumi-ord', 2000, 'CONFIRMED')];
  stato.scritture = [];
  stato.rpc = [];
  stato.avvisi = [];
});

describe('R11-023 — contestazione persa su una parte del carrello', () => {
  it('nessun ordine annullato, nessuna merce a scaffale, nessun «rimborsato per intero»', async () => {
    await handleDisputeClosed(persa(2000));
    expect(stato.scritture.some((v) => v.delivery_status === 'CANCELED'), 'l ordine dell altro negozio viene annullato').toBe(false);
    expect(stato.rpc).not.toContain('restore_stock_for_order');
    expect(stato.scritture.some((v) => v.payment_status === 'REFUNDED')).toBe(false);
    expect(stato.scritture).toContainEqual({ dispute_status: 'LOST', payment_status: 'PARTIALLY_REFUNDED' });
    expect(stato.avvisi).toContain('✕ Chargeback perso su una parte del carrello');
  });

  it('persa per intero: come prima', async () => {
    await handleDisputeClosed(persa(5000));
    expect(stato.scritture.some((v) => v.payment_status === 'REFUNDED')).toBe(true);
    expect(stato.rpc).toContain('restore_stock_for_order');
  });
});
