import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S01 — avvisi sui conti Stripe Connect (lib/stripe/webhook/trasferimenti.ts).
 *  · 628: il bonifico rifiutato di un fattorino gli parla dei compensi e lo porta a /rider/earnings.
 *  · 1571: se la lettura del profilo cade, l'avviso non dice «il conto non è nostro».
 *  · 76: se Stripe spegne i versamenti, il negozio e Nicola lo sanno.
 */
const st = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
  letturaCade: false,
  notifiche: [] as Array<Record<string, unknown>>,
  admin: [] as Array<{ t: string; b: string }>,
  conto: { id: 'acct_1', charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { past_due: [] as string[] } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({ getStripe: () => ({ accounts: { retrieve: async () => st.conto } }) }));
vi.mock('@/lib/stripe/webhook/comune', async (o) => ({
  ...((await o()) as object),
  notifyAdmins: vi.fn(async (t: string, b: string) => (st.admin.push({ t, b }), 'scritto')),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (t: string) => {
      if (t === 'notifications') return { insert: async (r: Record<string, unknown>) => (st.notifiche.push(r), { error: null }) };
      return {
        select: () => ({
          eq: () => ({
            limit: async () => (st.letturaCade ? { data: null, error: { message: 'timeout' } } : { data: st.profilo ? [st.profilo] : [], error: null }),
          }),
        }),
        update: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'x' }], error: null }) }) }),
      };
    },
  }),
}));

import { handlePayoutFailed, handleAccountUpdated } from '@/lib/stripe/webhook/trasferimenti';

const payout = { id: 'po_1', amount: 1200, failure_message: 'IBAN chiuso' } as never;
beforeEach(() => {
  st.profilo = null;
  st.letturaCade = false;
  st.notifiche = [];
  st.admin = [];
  st.conto = { id: 'acct_1', charges_enabled: true, payouts_enabled: true, details_submitted: true, requirements: { past_due: [] } };
});

describe('628 — il bonifico rifiutato di un fattorino', () => {
  it('lo porta ai suoi guadagni e parla dei compensi', async () => {
    st.profilo = { id: 'marco', role: 'rider', store_name: null, full_name: 'Marco' };
    await handlePayoutFailed(payout, 'acct_1');
    expect(st.notifiche[0]).toMatchObject({ user_id: 'marco', link: '/rider/earnings' });
    expect(String(st.notifiche[0].body)).toMatch(/compensi/);
    expect(st.admin[0].t).toMatch(/fattorino/);
  });
  it('controprova: il negozio resta su /seller/earnings', async () => {
    st.profilo = { id: 'forno', role: 'seller', store_name: 'Pane Quotidiano' };
    await handlePayoutFailed(payout, 'acct_1');
    expect(st.notifiche[0]).toMatchObject({ link: '/seller/earnings' });
  });
});

describe('1571 — lettura del profilo caduta', () => {
  it('l avviso non dice che il conto non è riconosciuto', async () => {
    st.letturaCade = true;
    await handlePayoutFailed(payout, 'acct_1');
    expect(st.admin[0].b).not.toMatch(/non è riconosciuto/);
    expect(st.admin[0].b).toMatch(/lettura del profilo/);
  });
});

describe('76 — Stripe spegne i versamenti', () => {
  it('il negozio riceve un avviso e gli amministratori anche', async () => {
    st.profilo = { id: 'forno', role: 'seller', store_name: 'Pane Quotidiano', stripe_charges_enabled: true, stripe_payouts_enabled: true };
    st.conto = { ...st.conto, payouts_enabled: false };
    await handleAccountUpdated({ id: 'acct_1' } as never);
    expect(st.notifiche).toHaveLength(1);
    expect(st.notifiche[0]).toMatchObject({ user_id: 'forno', category: 'system' });
    expect(st.admin).toHaveLength(1);
  });
  it('controprova: niente cambia, nessun avviso', async () => {
    st.profilo = { id: 'forno', role: 'seller', stripe_charges_enabled: true, stripe_payouts_enabled: true };
    await handleAccountUpdated({ id: 'acct_1' } as never);
    expect(st.notifiche).toHaveLength(0);
    expect(st.admin).toHaveLength(0);
  });
});
