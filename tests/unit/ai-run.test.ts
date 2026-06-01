import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Test di runMessage: parsing (testo/tool_use), prompt caching, telemetria,
 * coercizione campi cache nulli, mapping errori.
 */

const createMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();

vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return {
    ...actual,
    getAnthropic: () => ({ messages: { create: createMock } }),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: (...a: unknown[]) => infoMock(...a), warn: vi.fn(), error: (...a: unknown[]) => errorMock(...a) },
}));

import { runMessage, AiCallError, mapAiError } from '@/lib/ai/run';
import { MODELS } from '@/lib/ai/client';

function fakeMessage(over: Record<string, unknown>) {
  return {
    content: [],
    stop_reason: 'end_turn',
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    ...over,
  };
}

describe('lib/ai/run · runMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unisce i blocchi text (trim)', async () => {
    createMock.mockResolvedValue(
      fakeMessage({
        content: [
          { type: 'text', text: 'Ciao' },
          { type: 'text', text: 'mondo' },
        ],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: null, cache_read_input_tokens: null },
      }),
    );
    const r = await runMessage({ feature: 'f', model: MODELS.fast, max_tokens: 50, messages: [{ role: 'user', content: 'x' }] });
    expect(r.text).toBe('Ciao mondo');
    expect(r.toolInput).toBeUndefined();
    // campi cache nulli → 0 (trappola strict-mode)
    expect(r.usage.cacheWriteTokens).toBe(0);
    expect(r.usage.cacheReadTokens).toBe(0);
  });

  it('estrae il tool_use input', async () => {
    createMock.mockResolvedValue(
      fakeMessage({ content: [{ type: 'tool_use', id: 't', name: 'x', input: { a: 1 } }] }),
    );
    const r = await runMessage<{ a: number }>({ feature: 'f', model: MODELS.vision, max_tokens: 50, messages: [] });
    expect(r.toolInput).toEqual({ a: 1 });
    expect(r.text).toBe('');
  });

  it('mette cache_control sull ultimo blocco system e sull ultimo tool', async () => {
    createMock.mockResolvedValue(fakeMessage({}));
    await runMessage({
      feature: 'f',
      model: MODELS.fast,
      max_tokens: 50,
      system: 'Istruzioni',
      tools: [{ name: 'a', description: 'd', input_schema: { type: 'object', properties: {} } }],
      messages: [{ role: 'user', content: 'x' }],
    });
    const arg = createMock.mock.calls[0][0];
    expect(Array.isArray(arg.system)).toBe(true);
    expect(arg.system[arg.system.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(arg.tools[arg.tools.length - 1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('omette system/tools/tool_choice quando assenti (richiesta byte-identica al path testo)', async () => {
    createMock.mockResolvedValue(fakeMessage({}));
    await runMessage({ feature: 'f', model: MODELS.fast, max_tokens: 50, messages: [{ role: 'user', content: 'x' }] });
    const arg = createMock.mock.calls[0][0];
    expect('system' in arg).toBe(false);
    expect('tools' in arg).toBe(false);
    expect('tool_choice' in arg).toBe(false);
  });

  it('logga la telemetria ai_usage con feature/model/estCostEur', async () => {
    createMock.mockResolvedValue(
      fakeMessage({ usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    );
    await runMessage({ feature: 'vision-extract', model: MODELS.vision, max_tokens: 50, messages: [] });
    expect(infoMock).toHaveBeenCalledWith('ai_usage', expect.objectContaining({
      feature: 'vision-extract',
      model: MODELS.vision,
      estCostEur: expect.any(Number),
    }));
  });

  it('su errore SDK lancia AiCallError con lo status', async () => {
    createMock.mockRejectedValue(Object.assign(new Error('boom'), { status: 429 }));
    await expect(
      runMessage({ feature: 'f', model: MODELS.fast, max_tokens: 50, messages: [] }),
    ).rejects.toMatchObject({ name: 'AiCallError', status: 429 });
  });
});

describe('lib/ai/run · mapAiError', () => {
  it('401 → 503, 429 → 429 con Retry-After, altro → 502; mai logga il raw', () => {
    const r401 = mapAiError(new AiCallError('f', 401), 'f');
    expect(r401.status).toBe(503);
    const r429 = mapAiError(new AiCallError('f', 429), 'f');
    expect(r429.status).toBe(429);
    expect(r429.headers.get('Retry-After')).toBe('60');
    const r500 = mapAiError(new AiCallError('f', 500), 'f');
    expect(r500.status).toBe(502);
    // log: solo {feature, status}, mai il messaggio raw
    expect(errorMock).toHaveBeenCalledWith('AI call failed', { feature: 'f', status: 401 });
  });
});
