import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';

/**
 * R16-006 (bollino della promo) — Lo sconto del negozio non va oltre il 70% (`discountedUnitCents`):
 * il bollino «In promo» sulla pagina del prodotto scriveva la percentuale grezza («-80%») accanto a un
 * prezzo scontato solo del 70%. Adesso scrive quella che il prezzo applica.
 */
vi.mock('@/lib/supabase/client', () => ({ supabase: { rpc: async () => ({ data: 0, error: null }) } }));

async function bollino(sconto: number, basePrice = 10) {
  const { default: ActivePromoBadge } = await import('@/components/ActivePromoBadge');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(queryKeys.products.activeDiscount('p1'), sconto);
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(ActivePromoBadge, { productId: 'p1', basePrice })),
  );
}

describe('R16-006 · il bollino della promo dice lo sconto che il prezzo applica', () => {
  it('uno sconto grezzo dell\'80% scrive -70%, come il prezzo (3,00 € su 10,00 €)', async () => {
    const html = await bollino(80);
    expect(html).toContain('In promo -70%');
    expect(html).not.toContain('-80%');
    expect(html).toContain('3,00');
  });

  it('uno sconto dentro il tetto resta quello scritto', async () => {
    const html = await bollino(25);
    expect(html).toContain('In promo -25%');
    expect(html).toContain('7,50');
  });
});
