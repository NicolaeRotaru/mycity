import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-014 — Se l'invio di un lotto restava senza risposta, l'SDK lo rimandava
 * e presso Anthropic partivano due lotti, uno pagato e mai visto. Adesso la
 * creazione del lotto non si ritenta, e un invio senza risposta non diventa
 * «fallito»: resta un lavoro aperto da verificare.
 */

const createMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { batches: { create: createMock } } }) };
});

import { submitBatch } from '@/lib/ai/batch';

const RICHIESTA = {
  custom_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  model: 'claude-haiku-4-5-20251001' as const,
  max_tokens: 100,
  messages: [{ role: 'user' as const, content: 'x' }],
};

describe('la creazione del lotto non si rimanda da sola', () => {
  beforeEach(() => createMock.mockReset());

  it('submitBatch chiede zero tentativi in piu\' all\'SDK', async () => {
    createMock.mockResolvedValue({ id: 'b1', processing_status: 'in_progress', request_counts: {}, results_url: null });
    await submitBatch([RICHIESTA]);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  });
});
