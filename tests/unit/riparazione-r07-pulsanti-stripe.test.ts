import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * Nella pagina guadagni i due pulsanti di Stripe potevano dirsi il contrario.
 *
 * StripeConnectButton dice «Pagamenti attivi» con conto Stripe e versamenti
 * accesi, anche se gli incassi sono ancora in verifica. Il pulsante accanto, che
 * apre il conto Stripe, chiedeva anche gli incassi: il negozio leggeva «Pagamenti
 * attivi» e il pulsante per aprire il conto non c'era. Ora seguono la stessa regola.
 */
const st = vi.hoisted(() => ({
  profilo: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: st.profilo, isLoading: false, isError: false, refetch: vi.fn() }),
}));
const { default: Connetti } = await import('@/components/seller/StripeConnectButton');
const { default: Cruscotto } = await import('@/components/seller/StripeDashboardButton');

const PULSANTE = 'Gestisci pagamenti e IBAN su Stripe';

beforeEach(() => {
  st.profilo = null;
});

describe('i due pulsanti di Stripe dicono la stessa cosa', () => {
  it('conto e versamenti accesi, incassi ancora in verifica: «Pagamenti attivi» e il pulsante per aprire Stripe', () => {
    st.profilo = {
      stripe_account_id: 'acct_forno',
      stripe_charges_enabled: false,
      stripe_payouts_enabled: true,
      approval_status: 'approved',
    };
    expect(renderToStaticMarkup(createElement(Connetti))).toContain('Pagamenti attivi');
    expect(
      renderToStaticMarkup(createElement(Cruscotto)),
      'accanto a «Pagamenti attivi» manca il pulsante per aprire il conto Stripe',
    ).toContain(PULSANTE);
  });

  it('controprova: versamenti non ancora accesi, niente «Pagamenti attivi» e niente pulsante', () => {
    st.profilo = {
      stripe_account_id: 'acct_forno',
      stripe_charges_enabled: true,
      stripe_payouts_enabled: false,
      approval_status: 'approved',
    };
    expect(renderToStaticMarkup(createElement(Connetti))).not.toContain('Pagamenti attivi');
    expect(renderToStaticMarkup(createElement(Cruscotto))).not.toContain(PULSANTE);
  });

  it('controprova: senza conto Stripe il pulsante non compare', () => {
    st.profilo = {
      stripe_account_id: null,
      stripe_charges_enabled: true,
      stripe_payouts_enabled: true,
      approval_status: 'approved',
    };
    expect(renderToStaticMarkup(createElement(Connetti))).not.toContain('Pagamenti attivi');
    expect(renderToStaticMarkup(createElement(Cruscotto))).not.toContain(PULSANTE);
  });
});
