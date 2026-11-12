import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R04-002 — Il modello grande (claude-sonnet-4-5) si spegne il 30/11/2026.
 * Senza variabile d'ambiente il sito deve girare su un modello ancora attivo,
 * e un 404 del fornitore non deve diventare «Riprova» all'infinito.
 */

async function client() {
  vi.resetModules();
  return import('@/lib/ai/client');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('dopo il 30/11 il sito non usa un modello spento', () => {
  it('senza variabili, vision e smart non sono modelli ritirati', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T09:00:00Z'));
    const { MODELS, MODELLI_RITIRATI, segnalaModelloRitirato } = await client();
    const errore = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const m of [MODELS.vision, MODELS.smart]) {
      expect(MODELLI_RITIRATI[m], `${m} e' ritirato`).toBeUndefined();
      expect(segnalaModelloRitirato(m, new Date())).toBe(false);
    }
    errore.mockRestore();
  });

  it('il predefinito ha una riga prezzi (il freno di spesa resta vista)', async () => {
    const { MODELLO_PREDEFINITO, eModelloConPrezzo } = await client();
    expect(eModelloConPrezzo(MODELLO_PREDEFINITO)).toBe(true);
  });

  it('nessun file della scheda scrive a mano il modello ritirato', () => {
    const files = [
      'lib/ai/run.ts',
      'app/api/vision/extract-product/route.ts',
      'app/api/vision/extract-products/route.ts',
      'app/api/vision/photo-order/route.ts',
      'app/api/ai/improve-product/route.ts',
      'app/api/ai/barcode-lookup/route.ts',
      'app/api/ai/diagnose/route.ts',
      'app/api/ai/variants/route.ts',
      'app/api/ai/product-chat/route.ts',
      'app/api/ai/catalog-chat/route.ts',
      'app/api/ai/copilot/route.ts',
      'lib/products/externalSync.ts',
    ];
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toContain("'claude-sonnet-4-5'");
  });
});

describe('un 404 del fornitore non dice «Riprova»', () => {
  it('mapAiError(404) risponde 503 con un messaggio onesto', async () => {
    const { mapAiError, AiCallError } = await import('@/lib/ai/run');
    const res = mapAiError(new AiCallError('vision-extract', 404, new Error('not_found')), 'vision-extract');
    expect(res.status).toBe(503);
    const corpo = JSON.stringify(await res.json());
    expect(corpo).not.toMatch(/Riprova/i);
    expect(corpo).toMatch(/non disponibile/i);
  });
});
