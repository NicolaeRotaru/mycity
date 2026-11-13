import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-016 — Una descrizione lunga tornava tradotta solo all'inizio (il modello
 * vedeva la scheda tagliata a 4000 caratteri) e il modulo la presentava come
 * intera. Adesso la rotta rifiuta con un messaggio chiaro, prima di spendere.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
  TRADUCI_ACCESO: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));
const filtroMock = vi.fn(async () => undefined);
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: () => filtroMock() };
});
const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/translate/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const chiedi = (description: string, extra: Record<string, unknown> = {}) =>
  POST(new Request('http://localhost/api/ai/translate', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetLang: 'en', product: { name: 'Focaccia', description, ...extra } }),
  }) as never);

describe('traduzione di una descrizione lunga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ toolInput: { patch: { name: 'Focaccia', description: 'The first sentences only.' } } });
  });

  it('20 000 caratteri in 200 frasi: rifiutata con il limite detto, nessuna chiamata al modello', async () => {
    const lunga = Array.from({ length: 200 }, (_, i) => `Frase numero ${i} della descrizione del forno, con farina e acqua.`).join(' ').padEnd(20_000, '.');
    const res = await chiedi(lunga);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/troppo lunga per la traduzione automatica/);
    expect(runMessageMock).not.toHaveBeenCalled();
    // Rifiutata prima anche del filtro sui contenuti (che e' una chiamata a pagamento).
    expect(filtroMock).not.toHaveBeenCalled();
  });

  it('un alimento con descrizione corta ma ingredienti lunghi si traduce (si misura solo cio\' che si traduce)', async () => {
    const res = await chiedi('Focaccia genovese alta e morbida.', {
      attributes: { ingredienti: 'farina, acqua, olio, sale, lievito, '.repeat(120), valori_nutrizionali: 'x'.repeat(2000) },
    });
    expect(res.status).toBe(200);
    const testo = JSON.stringify(runMessageMock.mock.calls[0][0].messages);
    expect(testo).not.toContain('valori_nutrizionali');
  });

  it('una descrizione normale si traduce come prima', async () => {
    const res = await chiedi('Focaccia genovese alta e morbida.');
    expect(res.status).toBe(200);
    expect(runMessageMock).toHaveBeenCalledTimes(1);
  });
});
