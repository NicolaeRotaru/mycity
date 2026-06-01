import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Test del client AI centralizzato: config-throw, singleton, calcolo costo.
 */

import {
  getAnthropic,
  AiConfigError,
  AI_NOT_CONFIGURED,
  estimateCostEur,
  MODELS,
  PRICE_PER_MTOK,
  __resetAnthropicClient,
} from '@/lib/ai/client';

describe('lib/ai/client', () => {
  beforeEach(() => {
    __resetAnthropicClient();
    vi.unstubAllEnvs();
  });

  describe('getAnthropic', () => {
    it('lancia AiConfigError (code AI_NOT_CONFIGURED) se manca la chiave', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      expect(() => getAnthropic()).toThrow(AiConfigError);
      try {
        getAnthropic();
      } catch (e) {
        expect((e as AiConfigError).code).toBe(AI_NOT_CONFIGURED);
      }
    });

    it('restituisce lo stesso singleton tra chiamate', () => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-123');
      const a = getAnthropic();
      const b = getAnthropic();
      expect(a).toBe(b);
    });
  });

  describe('estimateCostEur', () => {
    it('Haiku: 1M input + 1M output = (1+5) USD × 0.92 = 5.52 EUR', () => {
      const eur = estimateCostEur(MODELS.fast, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
      expect(eur).toBeCloseTo(5.52, 6);
    });

    it('Sonnet: 1M input = 3 USD × 0.92 = 2.76 EUR', () => {
      const eur = estimateCostEur(MODELS.vision, {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
      expect(eur).toBeCloseTo(2.76, 6);
    });

    it('cache read costa 0.1× input (Haiku 1M read = 0.092 EUR)', () => {
      const eur = estimateCostEur(MODELS.fast, {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 1_000_000,
      });
      expect(eur).toBeCloseTo(0.092, 6);
    });

    it('costo nullo con zero token', () => {
      const eur = estimateCostEur(MODELS.smart, {
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
      });
      expect(eur).toBe(0);
    });
  });

  it('ogni modello in MODELS ha una riga prezzi in PRICE_PER_MTOK', () => {
    for (const id of Object.values(MODELS)) {
      expect(PRICE_PER_MTOK[id]).toBeDefined();
      expect(PRICE_PER_MTOK[id].input).toBeGreaterThan(0);
      expect(PRICE_PER_MTOK[id].output).toBeGreaterThan(0);
    }
  });
});
