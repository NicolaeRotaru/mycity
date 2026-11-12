/**
 * @vitest-environment jsdom
 *
 * R02-014 (12/11/2026) — L'amministratore che apre una scheda prodotto non scrive una visita in
 * product_views; un cliente sì. (Il negoziante era già escluso; le righe vecchie le scarta il
 * conto nel database, migrazione 260: tests/sql/rls/riparazione-r02-visite.test.sql.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const scritte: unknown[] = [];
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    from: (t: string) => ({
      insert: async (riga: unknown) => { if (t === 'product_views') scritte.push(riga); return { error: null }; },
      upsert: async () => ({ error: null }),
    }),
  },
}));
vi.mock('@/lib/analytics/events', () => ({ trackProductViewed: () => {} }));
vi.mock('@/lib/consent', () => ({ hasConsent: () => true }));
vi.mock('@/components/hooks/useUtente', () => ({ idUtenteInMemoria: async () => 'utente-1' }));

import ProductViewTracker from '@/components/ProductViewTracker';

async function monta(props: Record<string, unknown>) {
  const box = document.createElement('div');
  document.body.appendChild(box);
  const root = createRoot(box);
  await act(async () => { root.render(createElement(ProductViewTracker, { productId: 'p-1', sellerId: 'negozio-1', ...props } as never)); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  act(() => root.unmount());
}

describe('R02-014 · la visita dell amministratore non conta', () => {
  beforeEach(() => { scritte.length = 0; sessionStorage.clear(); localStorage.clear(); });

  it('l amministratore non scrive in product_views', async () => {
    await monta({ chiGuardaEAdmin: true });
    expect(scritte).toEqual([]);
  });

  it('un cliente sì', async () => {
    await monta({ chiGuardaEAdmin: false });
    expect(scritte).toHaveLength(1);
  });
});
