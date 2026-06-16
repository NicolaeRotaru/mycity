import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Route motore "Migliora tutto": auth mockata; runMessage mockato; rate limit
 * reale (reset per test). Verifica normalizzazione output (clamp punteggi),
 * ricalcolo server-side del netto venditore, passthrough del patch e mapping
 * errori.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/improve-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { AiCallError } from '@/lib/ai/run';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/improve-product', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

const PRODUCT = { name: 'Maglietta', price: 20, description: 'corta' };

function okToolInput(over: Record<string, unknown> = {}) {
  return {
    toolInput: {
      summary: 'Ho migliorato titolo e descrizione.',
      quality: {
        before: 40,
        after: 82,
        dimensions: [
          { key: 'titolo', label: 'Titolo', score: 90, max: 100, note: 'chiaro' },
          { key: 'foto', label: 'Foto', score: 30, max: 100, note: 'poche' },
        ],
        missing: ['Aggiungi una foto del retro'],
      },
      pricing: { suggested: 24.9, net_to_seller: 999, rationale: 'Allineato al mercato.' },
      field_notes: [{ field: 'name', note: 'Aggiunto il tipo di capo.' }],
      patch: { name: 'Maglietta di cotone', tags: ['cotone', 'estate'] },
      ...over,
    },
  };
}

describe('POST /api/ai/improve-product', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue(okToolInput());
  });

  it('400 su JSON non valido', async () => {
    const res = await POST(makeReq('non-json'));
    expect(res.status).toBe(400);
  });

  it('400 se manca la scheda prodotto', async () => {
    const res = await POST(makeReq({ product: {} }));
    expect(res.status).toBe(400);
  });

  it('503 se la chiave AI non è configurata', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await POST(makeReq({ product: PRODUCT }));
    expect(res.status).toBe(503);
  });

  it('200: chiama runMessage con model smart, system, prodotto nei messages e tool improve_product', async () => {
    const res = await POST(makeReq({ product: PRODUCT, imageUrls: ['https://x/a.jpg'] }));
    expect(res.status).toBe(200);
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.smart);
    expect(typeof arg.system).toBe('string');
    expect(JSON.stringify(arg.messages)).toContain('Maglietta');
    const toolNames = arg.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain('improve_product');
    expect(toolNames).toContain('web_search');
  });

  it('200: ricalcola il netto venditore dal prezzo suggerito (non si fida del valore AI)', async () => {
    const res = await POST(makeReq({ product: PRODUCT }));
    const json = await res.json();
    expect(json.pricing.suggested).toBe(24.9);
    // 24.90 - 10% = 22.41, NON 999 proposto dal modello.
    expect(json.pricing.netToSeller).toBe(22.41);
  });

  it('200: clampa i punteggi fuori range in 0-100', async () => {
    runMessageMock.mockResolvedValue(
      okToolInput({
        quality: {
          before: -5,
          after: 150,
          dimensions: [{ key: 'foto', score: 200, max: 100, note: 'x' }],
          missing: [],
        },
      }),
    );
    const res = await POST(makeReq({ product: PRODUCT }));
    const json = await res.json();
    expect(json.quality.before).toBe(0);
    expect(json.quality.after).toBe(100);
    expect(json.quality.dimensions[0].score).toBe(100);
  });

  it('200: restituisce il patch così com\'è (validato a valle dal form/apply)', async () => {
    const res = await POST(makeReq({ product: PRODUCT }));
    const json = await res.json();
    expect(json.patch).toEqual({ name: 'Maglietta di cotone', tags: ['cotone', 'estate'] });
  });

  it('502 se il modello non chiama il tool (toolInput assente)', async () => {
    runMessageMock.mockResolvedValue({ text: 'blah' });
    const res = await POST(makeReq({ product: PRODUCT }));
    expect(res.status).toBe(502);
  });

  it('429 quando runMessage segnala rate limit upstream (AiCallError 429)', async () => {
    runMessageMock.mockRejectedValue(new AiCallError('ai-improve-product', 429));
    const res = await POST(makeReq({ product: PRODUCT }));
    expect(res.status).toBe(429);
  });

  it('503 quando la config AI è assente a runtime (AiConfigError)', async () => {
    runMessageMock.mockRejectedValue(new AiConfigError());
    const res = await POST(makeReq({ product: PRODUCT }));
    expect(res.status).toBe(503);
  });

  it('429 dopo 20 chiamate/ora (rate limit per utente)', async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await POST(makeReq({ product: PRODUCT }));
      expect(ok.status).toBe(200);
    }
    const res = await POST(makeReq({ product: PRODUCT }));
    expect(res.status).toBe(429);
  });
});
