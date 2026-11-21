/**
 * R01-004 — Nei log la spesa dell'AI non mostrava i token: il logger oscura ogni chiave che contiene
 * «token» (per i gettoni d'accesso), e la riga `ai_usage` usciva con `inputTokens: "[redacted]"`.
 * Qui il logger vero scrive la riga, e la riga deve dire i numeri.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});

import { runMessage } from '@/lib/ai/run';
import { MODELS } from '@/lib/ai/client';

function righe(spia: { mock: { calls: unknown[][] } }): Array<Record<string, unknown>> {
  return spia.mock.calls
    .map((c: unknown[]) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
    .filter((r: Record<string, unknown> | null): r is Record<string, unknown> => r !== null);
}

let log: ReturnType<typeof vi.spyOn>;
let avvisi: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  createMock.mockReset();
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  avvisi = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('la spesa dell\'AI nei log dice i token', () => {
  it('la riga ai_usage porta i token in ingresso, in uscita e della memoria, non «[redacted]»', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1234, output_tokens: 56, cache_creation_input_tokens: 7, cache_read_input_tokens: 890 },
    });
    await runMessage({ feature: 'descrizione-prodotto', model: MODELS.fast, max_tokens: 200, messages: [{ role: 'user', content: 'x' }] });
    const spesa = righe(log).find((r) => r.level === 'spesa' && r.msg === 'ai_usage');
    expect(spesa, 'la riga della spesa non è uscita').toBeTruthy();
    expect(JSON.stringify(spesa), 'i token della spesa escono oscurati').not.toContain('[redacted]');
    const numeri = Object.values(spesa!).filter((v) => typeof v === 'number');
    for (const n of [1234, 56, 7, 890]) expect(numeri, `nei log della spesa manca il numero di token ${n}`).toContain(n);
    expect(spesa!.unita).toBe('token');
  });

  it('anche l\'avviso della risposta tagliata dice quanti token', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'a metà' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 10, output_tokens: 64, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    await runMessage({ feature: 'descrizione-prodotto', model: MODELS.fast, max_tokens: 64, messages: [] }).catch(() => undefined);
    const tagliata = righe(avvisi).find((r) => r.msg === 'ai_risposta_tagliata');
    expect(tagliata, 'l\'avviso della risposta tagliata non è uscito').toBeTruthy();
    expect(JSON.stringify(tagliata), 'i token dell\'avviso escono oscurati').not.toContain('[redacted]');
    expect(Object.values(tagliata!).filter((v) => v === 64).length).toBe(2);
  });
});
