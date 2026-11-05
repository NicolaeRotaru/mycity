/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';

/**
 * S06 — Il layout del negozio non approvato.
 * 2106: senza rete la lettura dello stato resta in pausa: niente frase
 *       definitiva «non ci è ancora arrivata», ma il testo prudente.
 * 2124: con in memoria «non mandata» e una rilettura in corso, si aspetta.
 */

const stato = vi.hoisted(() => ({ risposta: null as null | Promise<unknown> }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: () => stato.risposta }) }) }),
  },
}));
vi.mock('@/components/seller/SellerShell', () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock('@/components/seller/SubscriptionBanner', () => ({ SubscriptionBanner: () => null }));
vi.mock('@/components/ui/LoadingState', () => ({ LoadingState: () => createElement('p', null, 'CARICAMENTO') }));
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({
    profile: { id: 'u-1', role: 'seller', is_approved: false },
    isAuthenticated: true, isLoading: false, isSeller: true, isAdmin: false, isBuyer: false, isRider: false,
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function disegna(qc: QueryClient) {
  const { default: SellerLayout } = await import('@/app/seller/layout');
  const div = document.createElement('div');
  const root = createRoot(div);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerLayout, null, 'contenuto')));
  });
  return { div, root };
}

afterEach(() => { onlineManager.setOnline(true); });

describe('2106 — senza rete', () => {
  it('non dice «la richiesta non ci è ancora arrivata»', async () => {
    onlineManager.setOnline(false);
    stato.risposta = new Promise(() => {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { div, root } = await disegna(qc);
    expect(div.textContent).not.toContain('non ci è ancora arrivata');
    expect(div.textContent).toContain('Non siamo riusciti a leggere lo stato');
    root.unmount();
  });
});

describe('2124 — dato vecchio e rilettura in corso', () => {
  it('mostra il caricamento, non «non ci è ancora arrivata»', async () => {
    stato.risposta = new Promise(() => {});
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
    qc.setQueryData(['profile', 'stato-richiesta-negozio', 'u-1'], {
      approval_status: 'pending', approval_requested_at: null, rejection_reason: null,
    });
    await qc.invalidateQueries({ queryKey: ['profile'], refetchType: 'none' });
    const { div, root } = await disegna(qc);
    expect(div.textContent).not.toContain('non ci è ancora arrivata');
    expect(div.textContent).toContain('CARICAMENTO');
    root.unmount();
  });
});
