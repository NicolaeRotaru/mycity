import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R21-001 — Una chiamata AI che non risponde deve finire (col suo ritentativo)
 * prima che Vercel spenga la rotta, così `mapAiError` scrive l'errore chiaro.
 */

const createMock = vi.fn();

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runMessage } from '@/lib/ai/run';
import { MODELS } from '@/lib/ai/client';

const RISPOSTA = {
  content: [],
  stop_reason: 'end_turn',
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
};

/** Il tempo che l'SDK lascia a UN tentativo, come lo vede runMessage. */
async function tempoDelTentativo(maxTokens: number): Promise<number> {
  createMock.mockClear();
  createMock.mockResolvedValue(RISPOSTA);
  await runMessage({ feature: 'f', model: MODELS.smart, max_tokens: maxTokens, messages: [] });
  const opzioni = createMock.mock.calls[0][1] as { timeout?: number } | undefined;
  // Senza un tempo per chiamata vale quello del client (60 s prima della correzione).
  return opzioni?.timeout ?? 60_000;
}

function maxDurationDi(percorso: string): number | undefined {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
    functions: Record<string, { maxDuration?: number }>;
  };
  return cfg.functions[percorso]?.maxDuration;
}

describe('R21-001 · il tempo delle chiamate AI sta dentro quello della rotta', () => {
  beforeEach(() => vi.clearAllMocks());

  it('filtro + chiamata più lunga, ognuna col suo ritentativo, finiscono sotto i 120 s della rotta', async () => {
    const filtro = await tempoDelTentativo(128);
    for (const token of [512, 1024, 1500, 2048, 3072, 6000]) {
      const vera = await tempoDelTentativo(token);
      // un tentativo + il ritentativo (SDK: una pausa di circa mezzo secondo)
      const peggiore = 2 * filtro + 500 + (2 * vera + 500);
      expect(peggiore, `max_tokens ${token}`).toBeLessThan(120_000);
    }
  });

  it('le rotte di visione hanno un tempo dichiarato, come quelle AI', () => {
    expect(maxDurationDi('app/api/ai/**/route.ts')).toBe(120);
    expect(maxDurationDi('app/api/vision/**/route.ts')).toBe(120);
  });
});
