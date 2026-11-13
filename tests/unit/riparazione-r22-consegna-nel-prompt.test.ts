import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R22-008 — Il prompt di «Migliora» non chiama più «fee di consegna» quella di un carrello con un
 * solo pezzo. Il dato del contesto era già la regola del carrello (R04-021); restava il SYSTEM,
 * che elencava «la fee di consegna» fra le cose su cui ragionare per il netto del venditore.
 * Adesso dice la regola: la consegna si paga sul carrello intero e non tocca il netto.
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
import { regolaConsegnaPerAi } from '@/lib/products/economics';

const chiedi = (price: number | null) =>
  POST(new Request('http://localhost/api/ai/improve-product', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ product: { name: 'Pagnotta', price } }),
  }) as never);

describe('R22-008 · la consegna nel prompt di «Migliora» è la regola del carrello', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { summary: 'ok', patch: {} } });
  });

  for (const prezzo of [3.5, null]) {
    it(`pagnotta a ${prezzo ?? 'nessun prezzo'}: nessuna «fee di consegna», si dice la regola del carrello`, async () => {
      await chiedi(prezzo);
      expect(runMessageMock).toHaveBeenCalledTimes(1);
      const { system, messages } = runMessageMock.mock.calls[0][0] as { system: string; messages: unknown };
      const contesto = JSON.stringify(messages);

      // Il SYSTEM non parla più di una «fee di consegna» su cui ragionare per il netto.
      expect(system).not.toMatch(/fee di consegna/i);
      expect(system).toMatch(/regola della consegna, che si paga sul carrello intero e non sul singolo prodotto/);
      expect(system).toMatch(/non tocca il netto/);

      // E il dato che arriva col prodotto è la stessa regola, con le cifre della tariffa vera.
      expect(contesto).not.toMatch(/fee di consegna/i);
      expect(contesto).toContain(regolaConsegnaPerAi());
    });
  }
});
