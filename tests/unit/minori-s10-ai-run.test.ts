import { describe, it, expect, vi } from 'vitest';

/**
 * S10 (5/11/2026, scheda 2645) — ogni chiamata all'AI deve far partire il
 * controllo del modello ritirato: se si toglie quella riga da runMessage,
 * questa prova diventa rossa.
 */

const createMock = vi.fn();
const segnalaMock = vi.fn(() => false);

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () => ({ messages: { create: createMock } }),
    segnalaModelloRitirato: (...a: unknown[]) => segnalaMock(...(a as [])),
  };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: async () => ({ data: 0, error: null }) }),
}));

import { runMessage } from '@/lib/ai/run';
import { MODELS } from '@/lib/ai/client';

describe('runMessage controlla il modello ritirato a ogni chiamata (2645)', () => {
  it('chiama segnalaModelloRitirato col modello della chiamata', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    await runMessage({ feature: 'f', model: MODELS.fast, max_tokens: 10, messages: [{ role: 'user', content: 'x' }] });
    expect(segnalaMock).toHaveBeenCalledWith(MODELS.fast);
  });
});
