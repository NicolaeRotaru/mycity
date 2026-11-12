import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-017 — Il tetto di spesa AI si sforava quando piu' chiamate partivano
 * insieme: tutte leggevano lo stesso «speso» e passavano tutte. Adesso chi
 * passa prenota la sua stima e il confronto e' «speso + in volo + stima».
 */

const createMock = vi.fn();
const rpcMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }),
}));

import { runMessage, controllaTettoSpesaAi, __inVoloSpesaAiCents, AiCallError } from '@/lib/ai/run';
import { __azzeraRipiegoSpesaAi } from '@/lib/ai/tettoSpesa';

const attesa = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('il tetto regge anche con chiamate partite insieme', () => {
  beforeEach(() => {
    __azzeraRipiegoSpesaAi();
    createMock.mockReset();
    rpcMock.mockReset();
    vi.stubEnv('AI_GLOBAL_DAILY_BUDGET_EUR', '0.10'); // 10 centesimi
    // Il conto condiviso dice: 5 centesimi gia' spesi (e non si muove finche'
    // le chiamate non finiscono: la registrazione arriva dopo).
    rpcMock.mockImplementation(async (nome: string) => {
      await attesa(5);
      return nome === 'spesa_ai_di_oggi' ? { data: 5, error: null } : { data: 5, error: null };
    });
    createMock.mockImplementation(async () => {
      await attesa(20);
      return {
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      };
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('cinque chiamate da ~2 centesimi con 5 su 10 gia\' spesi: non passano tutte', async () => {
    const chiama = () =>
      runMessage({
        feature: 'prova-tetto',
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000, // ~1,84 centesimi di uscita al massimo
        messages: [{ role: 'user', content: 'ciao' }],
      });
    const esiti = await Promise.allSettled([chiama(), chiama(), chiama(), chiama(), chiama()]);
    const passate = esiti.filter((e) => e.status === 'fulfilled').length;
    const fermate = esiti.filter(
      (e) => e.status === 'rejected' && e.reason instanceof AiCallError && e.reason.motivo === 'tetto_spesa',
    ).length;
    expect(passate).toBeLessThanOrEqual(2);
    expect(passate + fermate).toBe(5);
    expect(createMock.mock.calls.length).toBe(passate);
    // Finite le chiamate, niente resta prenotato.
    expect(__inVoloSpesaAiCents()).toBe(0);
  });

  it('una stima che da sola sfora quello che resta viene fermata (speso + stima, non solo speso)', async () => {
    await expect(controllaTettoSpesaAi('ai-catalog-batch-start', 2000)).rejects.toMatchObject({ motivo: 'tetto_spesa' });
  });

  it('il lotto passa la sua stima al controllo del tetto', () => {
    const src = readFileSync('app/api/ai/catalog-batch/start/route.ts', 'utf8');
    expect(src).toMatch(/controllaTettoSpesaAi\('ai-catalog-batch-start',\s*impegnato \* 100\)/);
  });
});
