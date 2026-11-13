import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 1/11/2026 — IL MODELLO CHE LEGGE LE FOTO SI SPEGNE IL 30 NOVEMBRE.
 *
 * claude-sonnet-4-5 era scritto a mano nel codice: per cambiarlo serviva un
 * rilascio. Ora AI_MODELLO_VISION / AI_MODELLO_SMART lo scelgono, ma solo fra i
 * modelli con una riga prezzi (altrimenti il costo diventa NaN e il freno di
 * spesa resta cieco). 12/11 (R04-002): il default e' claude-sonnet-4-6, stesso prezzo del 4-5 che si spegne.
 */

async function client() {
  vi.resetModules();
  return import('@/lib/ai/client');
}

describe('il modello di «vision» e «smart» si sceglie dall\'ambiente', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('AI_MODELLO_SMART=claude-sonnet-4-6: si usa quello, e il costo si conta col suo prezzo', async () => {
    vi.stubEnv('AI_MODELLO_SMART', 'claude-sonnet-4-6');
    const { MODELS, estimateCostEur, USD_EUR } = await client();
    expect(MODELS.smart).toBe('claude-sonnet-4-6');
    const eur = estimateCostEur(MODELS.smart, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(eur).toBeCloseTo(3 * USD_EUR, 6);
  });

  it('AI_MODELLO_VISION=claude-sonnet-4-6: anche le foto passano al nuovo', async () => {
    vi.stubEnv('AI_MODELLO_VISION', 'claude-sonnet-4-6');
    const { MODELS } = await client();
    expect(MODELS.vision).toBe('claude-sonnet-4-6');
  });

  it('un modello sconosciuto non passa: resta il default', async () => {
    vi.stubEnv('AI_MODELLO_SMART', 'modello-che-non-esiste');
    const avviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { MODELS } = await client();
    expect(MODELS.smart).toBe('claude-sonnet-4-6');
    avviso.mockRestore();
  });

  it('senza variabili non cambia niente', async () => {
    const { MODELS } = await client();
    expect(MODELS.smart).toBe('claude-sonnet-4-6');
    expect(MODELS.vision).toBe('claude-sonnet-4-6');
  });
});
