// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * S10 (5/11/2026, scheda 282) — il disegno del server (e dell'idratazione)
 * parte sempre da «non pronto», anche quando nel browser la risposta su chi è
 * entrato è già arrivata: altrimenti server e browser disegnano due pagine.
 */

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1', email: 'maria@example.com' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock('@/lib/analytics/posthog', () => ({ identify: vi.fn(), resetUser: vi.fn() }));
vi.mock('@/lib/analytics/sentry', () => ({ setSentryUser: vi.fn() }));

import { useProfile } from '@/components/hooks/useProfile';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Sonda() {
  const p = useProfile() as unknown as { authChecked?: boolean; isAuthenticated?: boolean; userId?: string | null };
  return createElement('span', null, p.isAuthenticated ? 'dentro' : 'in-attesa');
}

describe('il primo disegno combacia con quello del server (282)', () => {
  it('a risposta già arrivata, il disegno «del server» resta in attesa', async () => {
    // Nel browser la risposta arriva…
    const c = document.createElement('div');
    document.body.appendChild(c);
    const root = createRoot(c);
    const qc = new QueryClient();
    await act(async () => root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda))));
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(c.textContent).toBe('dentro');
    // …ma il disegno da server (quello che l'idratazione deve ritrovare) parte da zero.
    const html = renderToString(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Sonda)));
    expect(html).toContain('in-attesa');
    await act(async () => root.unmount());
  });
});
