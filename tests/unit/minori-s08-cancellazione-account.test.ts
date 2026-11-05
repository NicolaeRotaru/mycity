import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * S08 (5/11/2026) — lib/account/cancellazione.ts: campi del fornitore KYC
 * (scheda 1863), file che non si tolgono (1693), conto Stripe collegato (123).
 */

const stripe = {
  saldo: { available: [{ amount: 0 }], pending: [{ amount: 0 }] } as { available: Array<{ amount: number }>; pending: Array<{ amount: number }> },
  chiusi: [] as string[],
  configurato: true,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/stripe/client', () => ({
  isStripeConfigured: () => stripe.configurato,
  getStripe: () => ({
    customers: { del: async (id: string) => ({ id, deleted: true }) },
    balance: { retrieve: async () => stripe.saldo },
    accounts: { del: async (id: string) => { stripe.chiusi.push(id); return { id, deleted: true }; } },
  }),
}));

import { cancellaAccount, CAMPI_KYC_DA_AZZERARE } from '@/lib/account/cancellazione';

const UTENTE = '11111111-1111-4111-8111-111111111111';

function fintoMondo(o: { contoCollegato?: string | null; storageRotto?: boolean } = {}) {
  const diario: string[] = [];
  const admin = {
    from(tabella: string) {
      return {
        select(_c: string) {
          return {
            eq: async () => {
              if (tabella === 'profiles') return { data: [{ stripe_customer_id: null, stripe_account_id: o.contoCollegato ?? null }], error: null };
              if (tabella === 'orders') return { data: [], error: null };
              return { data: [], error: null };
            },
          };
        },
        update(_v: Record<string, unknown>) {
          return { eq: async () => { diario.push(`update:${tabella}`); return { error: null }; } };
        },
        delete() {
          return { ilike: async () => ({ error: null }) };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: 'x@example.it' } } }),
        deleteUser: async () => { diario.push('cancella-account'); return { error: null }; },
      },
    },
    storage: {
      from: () => ({
        list: async () => (o.storageRotto ? { data: null, error: { message: 'storage giù' } } : { data: [], error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { admin, diario };
}

beforeEach(() => {
  stripe.saldo = { available: [{ amount: 0 }], pending: [{ amount: 0 }] };
  stripe.chiusi = [];
  stripe.configurato = true;
});

describe('cancellare un account', () => {
  it('scheda 1863 — si azzerano anche i campi del controllo presso il fornitore KYC', () => {
    expect(CAMPI_KYC_DA_AZZERARE).toMatchObject({
      kyc_provider_check_id: null,
      kyc_provider_status: null,
      kyc_provider_checked_at: null,
    });
  });

  it('scheda 1693 — se lo storage non risponde l account NON si cancella', async () => {
    const { admin, diario } = fintoMondo({ storageRotto: true });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(false);
    expect(diario).not.toContain('cancella-account');
    expect(esito.erroriFile.length).toBeGreaterThan(0);
  });

  it('scheda 123 — il conto Stripe collegato a zero si chiude prima del passo irreversibile', async () => {
    const { admin, diario } = fintoMondo({ contoCollegato: 'acct_forno' });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(true);
    expect(stripe.chiusi).toEqual(['acct_forno']);
    expect(diario).toContain('cancella-account');
  });

  it('scheda 123 — col saldo non a zero la cancellazione si rinvia e il codice del conto resta', async () => {
    stripe.saldo = { available: [{ amount: 0 }], pending: [{ amount: 1250 }] };
    const { admin, diario } = fintoMondo({ contoCollegato: 'acct_forno' });
    const esito = await cancellaAccount(admin as never, UTENTE);
    expect(esito.ok).toBe(false);
    expect(stripe.chiusi).toEqual([]);
    expect(diario).not.toContain('cancella-account');
  });
});
