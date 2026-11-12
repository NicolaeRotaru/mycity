/**
 * @vitest-environment jsdom
 *
 * R02-011 (12/11/2026) — Se la lettura dello sconto della promozione cade, non vale zero: la
 * domanda si riprova e, appena risponde, la scheda mostra lo sconto che la cassa applicherà.
 */
import { describe, it, expect, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let chiamate = 0;
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async () => {
      chiamate += 1;
      return chiamate === 1 ? { data: null, error: { message: 'rete caduta' } } : { data: 20, error: null };
    },
  },
}));

import ActivePromoBadge from '@/components/ActivePromoBadge';

describe('R02-011 · lo sconto della promo con una lettura caduta', () => {
  it('la prima lettura cade, la seconda risponde: si vede «-20%», non il prezzo pieno', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(ActivePromoBadge, { productId: 'p-1', basePrice: 5 })));
    });
    await vi.waitFor(() => { if (!box.textContent?.includes('-20%')) throw new Error('sconto non ancora a schermo'); }, { timeout: 2000 }).catch(() => {});
    expect(box.textContent).toContain('In promo -20%');
    act(() => root.unmount());
  });
});
