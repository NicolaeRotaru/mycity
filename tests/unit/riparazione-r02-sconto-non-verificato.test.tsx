/**
 * @vitest-environment jsdom
 *
 * R02-011 (dopo il collaudo, 12/11/2026) — Con il nuovo tentativo unico dell'app (retry: 1) una
 * lettura dello sconto che cadeva due volte ricadeva su «sconto 0». Ora la domanda riprova di più
 * e, se cade lo stesso, la scheda dice che non ha potuto verificare le promozioni.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let chiamate = 0;
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: async () => {
      chiamate += 1;
      return chiamate <= 3 ? { data: null, error: { message: 'rete caduta' } } : { data: 20, error: null };
    },
  },
}));

import ActivePromoBadge from '@/components/ActivePromoBadge';

describe('R02-011 · una lettura dello sconto che cade più volte', () => {
  it('con il retry dell app (1) e tre cadute di fila, la quarta lettura arriva: si vede «-20%»', async () => {
    const box = document.createElement('div');
    document.body.appendChild(box);
    const root = createRoot(box);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(ActivePromoBadge, { productId: 'p-1', basePrice: 5 })));
    });
    await vi.waitFor(() => { if (!box.textContent?.includes('-20%')) throw new Error('non ancora'); }, { timeout: 2000 }).catch(() => {});
    expect(box.textContent).toContain('In promo -20%');
    act(() => root.unmount());
  });

  it('se cade lo stesso, la scheda dice che non ha verificato le promozioni (non presenta il pieno come certo)', () => {
    const src = readFileSync('app/product/[id]/page.tsx', 'utf8');
    expect(src).toMatch(/isError: scontoNonVerificato/);
    expect(src).toMatch(/\{scontoNonVerificato && \(/);
    const domanda = src.slice(src.indexOf('isError: scontoNonVerificato'), src.indexOf('staleTime: 60_000', src.indexOf('isError: scontoNonVerificato')));
    expect(domanda).toMatch(/retry: 3/);
  });
});
