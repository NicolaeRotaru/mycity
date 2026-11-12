import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-021 — All'assistente AI si diceva che la consegna di una pagnotta da
 * 3,50 € costa 4 €, ma la consegna si paga sul carrello, non sul singolo
 * prodotto. Adesso il prompt di «Migliora» riceve la regola del carrello.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/improve-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiedi = (price: number | null) =>
  POST(new Request('http://localhost/api/ai/improve-product', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ product: { name: 'Pagnotta', price } }),
  }) as never);

describe('la consegna nel prompt di «Migliora»', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { summary: 'ok', patch: {} } });
  });

  for (const prezzo of [3.5, null]) {
    it(`pagnotta a ${prezzo ?? 'nessun prezzo'}: niente cifra di consegna per prodotto, si dice la regola del carrello`, async () => {
      await chiedi(prezzo);
      const testo = JSON.stringify(runMessageMock.mock.calls[0][0].messages);
      expect(testo).not.toMatch(/Fee di consegna a domicilio: €/);
      expect(testo).toMatch(/si paga sul CARRELLO intero/);
      expect(testo).toMatch(/€3\.00 per una spesa da 10 € in su/);
      expect(testo).toMatch(/€4\.00 sotto i 10 €/);
    });
  }
});
