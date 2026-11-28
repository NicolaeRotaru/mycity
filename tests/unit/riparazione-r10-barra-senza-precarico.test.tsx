// @vitest-environment jsdom
/**
 * R10-005 — Nel pannello del negozio ogni link della barra laterale veniva precaricato da Next:
 * ogni precarico è una richiesta /seller/… che ripassa dal controllo d'accesso del middleware
 * (getUser + lettura di profiles), quindi due chiamate a Supabase per voce a ogni apertura.
 * Il controllo d'accesso non si tocca: si toglie il precarico automatico alle voci della barra,
 * così la richiesta parte solo al clic vero. Qui il guscio VERO, con un next/link finto che
 * registra la prop `prefetch` che riceve.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: { signOut: async () => ({}), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    from() {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: (r: unknown) => unknown) => ok({ count: 0, data: [], error: null });
      return q;
    },
  },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/seller/dashboard',
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, prefetch: () => undefined }),
}));
vi.mock('next/link', async () => {
  const { createElement: ce } = await import('react');
  return {
    default: ({ href, children, prefetch, ...r }: Record<string, unknown>) =>
      ce('a', { href: String(href), 'data-prefetch': prefetch === undefined ? 'predefinito' : String(prefetch), ...r }, children as never),
  };
});
vi.mock('@/components/hooks/useProfile', () => ({
  useProfile: () => ({ profile: { id: 's-1', role: 'seller', store_name: 'Forno' }, userEmail: 'f@f.it', isAuthenticated: true, isSeller: true }),
}));
vi.mock('@/components/hooks/useBottomSheetA11y', () => ({ useBottomSheetA11y: () => undefined }));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const { default: SellerShell } = await import('@/components/seller/SellerShell');

async function monta() {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(SellerShell, null, createElement('p', null, 'x'))));
  });
  return { div, smonta: () => root.unmount() };
}

describe('R10-005 — le voci della barra del negozio non si precaricano da sole', () => {
  it('ogni link della navigazione laterale ha prefetch={false}', async () => {
    const { div, smonta } = await monta();
    const voci = Array.from(div.querySelectorAll('aside[aria-label="Menu venditore"] nav a'));
    // La barra ha davvero le sue voci (Dashboard, Ordini, Prodotti, …): la prova non passa a vuoto.
    expect(voci.length).toBeGreaterThan(8);
    const conPrecarico = voci.filter((a) => a.getAttribute('data-prefetch') !== 'false').map((a) => a.getAttribute('href'));
    expect(conPrecarico).toEqual([]);
    smonta();
  });

  it('anche il marchio in cima alla barra porta alla dashboard senza precarico', async () => {
    const { div, smonta } = await monta();
    const marchio = div.querySelector('aside[aria-label="Menu venditore"] > div a[href="/seller/dashboard"]');
    expect(marchio).not.toBeNull();
    expect(marchio?.getAttribute('data-prefetch')).toBe('false');
    smonta();
  });
});
