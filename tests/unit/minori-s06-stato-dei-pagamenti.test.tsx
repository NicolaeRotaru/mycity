import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * S06 · 66 — Se lo stato dei pagamenti non si legge, i due pulsanti Stripe lo
 * dicono con «Riprova» invece di dire «completa la verifica» o sparire.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: () => ({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() }),
}));
const { default: Connetti } = await import('@/components/seller/StripeConnectButton');
const { default: Cruscotto } = await import('@/components/seller/StripeDashboardButton');

describe('66 — stato dei pagamenti non letto', () => {
  it('StripeConnectButton non dice «Completa prima la verifica»', () => {
    const html = renderToStaticMarkup(<Connetti />);
    expect(html).not.toContain('Completa prima la verifica');
    expect(html).toContain('Non riesco a leggere lo stato dei pagamenti');
  });
  it('StripeDashboardButton non sparisce in silenzio', () => {
    expect(renderToStaticMarkup(<Cruscotto />)).toContain('Riprova');
  });
});
