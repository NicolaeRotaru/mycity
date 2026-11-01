import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * 1/11/2026 — IL MODELLO CHE LEGGE LE FOTO SI SPEGNE IL 30 NOVEMBRE.
 *
 * claude-sonnet-4-5 era scritto a mano nel codice: per cambiarlo serviva un
 * rilascio. Ora AI_MODELLO_VISION / AI_MODELLO_SMART lo scelgono, ma solo fra i
 * modelli con una riga prezzi (altrimenti il costo diventa NaN e il freno di
 * spesa resta cieco). Nessun modello si accende da solo: il default e' lo stesso.
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
    expect(MODELS.smart).toBe('claude-sonnet-4-5');
    avviso.mockRestore();
  });

  it('senza variabili non cambia niente', async () => {
    const { MODELS } = await client();
    expect(MODELS.smart).toBe('claude-sonnet-4-5');
    expect(MODELS.vision).toBe('claude-sonnet-4-5');
  });

  it('dal 30/11/2026 un modello ritirato in uso si segnala come errore', async () => {
    const mod = (await client()) as unknown as Record<string, unknown>;
    const segnala = mod.segnalaModelloRitirato as ((m: string, d: Date) => boolean) | undefined;
    expect(typeof segnala, 'manca l\'avviso del modello ritirato').toBe('function');
    const errore = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(segnala!('claude-sonnet-4-5', new Date('2026-11-29T12:00:00Z'))).toBe(false);
    expect(segnala!('claude-sonnet-4-5', new Date('2026-11-30T08:00:00Z'))).toBe(true);
    expect(segnala!('claude-sonnet-4-6', new Date('2026-12-15T08:00:00Z'))).toBe(false);
    expect(errore).toHaveBeenCalledTimes(1);
    errore.mockRestore();
  });
});
