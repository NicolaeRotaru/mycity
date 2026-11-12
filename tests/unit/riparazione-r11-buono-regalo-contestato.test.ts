import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

/**
 * R11-022 — Sui buoni regalo la contestazione andava in una sola direzione: una
 * richiesta di informazioni della banca (che non toglie soldi) annullava il
 * buono, e se MyCity vinceva nessuno lo restituiva.
 */

const stato = vi.hoisted(() => ({
  rpc: [] as string[],
  avvisi: [] as string[],
  buono: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({}) }));
vi.mock('@/lib/stripe/webhook/comune', () => ({
  findOrdersForDispute: async () => [],
  notifyAdmins: vi.fn(async (titolo: string) => {
    stato.avvisi.push(titolo);
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    rpc: async (nome: string) => {
      stato.rpc.push(nome);
      return { data: { esito: 'annullato' }, error: null };
    },
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = async () => ({ data: stato.buono, error: null });
      return c;
    },
  }),
}));

import { handleDisputeClosed, handleDisputeCreated } from '@/lib/stripe/webhook/dispute';

const contestazione = (status: string) =>
  ({ id: 'dp_buono', status, amount: 3000, payment_intent: 'pi_buono', charge: 'ch_buono' }) as unknown as Stripe.Dispute;

beforeEach(() => {
  stato.rpc = [];
  stato.avvisi = [];
  stato.buono = null;
});

describe('R11-022 — buono regalo e contestazione', () => {
  it('una richiesta di informazioni non annulla il buono', async () => {
    await handleDisputeCreated(contestazione('warning_needs_response'));
    expect(stato.rpc, 'la banca chiede solo informazioni e il buono del cliente si spegne').not.toContain('gift_card_void_for_payment');
    expect(stato.avvisi).toContain('ℹ️ La banca chiede informazioni su un pagamento');
  });

  it('una contestazione vera lo annulla ancora', async () => {
    await handleDisputeCreated(contestazione('needs_response'));
    expect(stato.rpc).toContain('gift_card_void_for_payment');
  });

  it('vinta la contestazione, chi gestisce sa che il buono va riattivato', async () => {
    stato.buono = { code: 'BUONO-1', voided_cents: 3000, void_reason: 'disputed', voided_at: '2026-11-01T10:00:00Z' };
    await handleDisputeClosed(contestazione('won'));
    expect(stato.avvisi, 'MyCity vince e il buono resta spento senza che nessuno lo sappia').toContain(
      '⚠️ Contestazione vinta: buono regalo da riattivare',
    );
  });

  it('persa, nessun avviso di riattivazione', async () => {
    stato.buono = { code: 'BUONO-1', voided_cents: 3000, void_reason: 'disputed', voided_at: '2026-11-01T10:00:00Z' };
    await handleDisputeClosed(contestazione('lost'));
    expect(stato.avvisi).not.toContain('⚠️ Contestazione vinta: buono regalo da riattivare');
  });
});
