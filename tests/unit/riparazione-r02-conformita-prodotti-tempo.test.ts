import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

/**
 * classifyProductPolicy usava i 60 s del client (con ritentativo): i lavori sul catalogo la
 * chiamano a gruppi su fino a 200 righe e con il fornitore lento passavano i 120 s della
 * funzione. Ora ha un tempo suo, breve, e non ritenta.
 */

// Un client finto che si comporta come l'SDK: scade dopo `timeout` (60 s se non dichiarato).
const chiamate: { opzioni: { timeout?: number; maxRetries?: number } | undefined }[] = [];
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () => ({
      messages: {
        create: (_corpo: unknown, opzioni?: { timeout?: number; maxRetries?: number }) => {
          chiamate.push({ opzioni });
          return new Promise((_ok, no) => {
            setTimeout(() => no(new Error('Request timed out.')), opzioni?.timeout ?? 60_000);
          });
        },
      },
    }),
  };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { classifyProductPolicy } from '@/lib/ai/moderation';

describe('la conformita dei prodotti ha un tempo suo', () => {
  beforeEach(() => {
    chiamate.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('con un fornitore che non risponde, dopo 10 secondi lancia (il chiamante nega) e non ritenta', async () => {
    let esito: 'in attesa' | 'lanciato' | 'risposto' = 'in attesa';
    const p = classifyProductPolicy({ name: 'Bici', description: 'usata' }, 'prova-r02').then(
      () => { esito = 'risposto'; },
      () => { esito = 'lanciato'; },
    );
    await vi.advanceTimersByTimeAsync(10_001);
    expect(esito, 'prima restava in attesa fino ai 60 s del client').toBe('lanciato');
    await p;
    expect(chiamate).toHaveLength(1);
    expect(chiamate[0].opzioni).toEqual({ timeout: 10_000, maxRetries: 0 });
  });
});
