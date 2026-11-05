import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * S10 (5/11/2026) — la chat del prodotto: il filtro anti-contenuti guarda
 * tutta la conversazione e la scheda, e con l'AI spenta lo dice.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

const assertSafeTextMock = vi.fn(async (_t: string, _f?: string) => undefined as unknown);
vi.mock('@/lib/ai/moderation', () => ({
  assertSafeText: (...a: [string, string]) => assertSafeTextMock(...a),
  UnsafeContentError: class UnsafeContentError extends Error {
    verdict = { allowed: false, reason: 'vietato' };
  },
}));

import { POST } from '@/app/api/ai/product-chat/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { AiConfigError } from '@/lib/ai/client';
import { PRODUCT_PATCH_PROPERTIES } from '@/lib/ai/patchSchema';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/product-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  runMessageMock.mockResolvedValue({ text: 'ok', toolInput: { reply: 'ok', patch: {} } });
});

describe('la chat del prodotto filtra tutta la conversazione e la scheda (1684)', () => {
  it('un messaggio vecchio della storia passa dal filtro', async () => {
    await POST(
      makeReq({
        product: { name: 'Lampada', description: 'Descrizione del negozio' },
        history: [
          { role: 'user', content: 'MESSAGGIO-RIFIUTATO-PRIMA' },
          { role: 'assistant', content: 'Ops' },
          { role: 'user', content: 'e adesso?' },
        ],
      }),
    );
    const testi = assertSafeTextMock.mock.calls.map((c) => c[0]).join('\n');
    expect(testi).toContain('MESSAGGIO-RIFIUTATO-PRIMA');
    expect(testi).toContain('Descrizione del negozio');
  });
});

describe('con l\'AI spenta la chat del prodotto non risponde «Errore AI» (249)', () => {
  it('AiConfigError dal filtro diventa 503 col suo messaggio', async () => {
    assertSafeTextMock.mockRejectedValueOnce(new AiConfigError('Gli strumenti AI per i negozi non sono ancora attivi.'));
    const res = await POST(makeReq({ product: {}, history: [{ role: 'user', content: 'ciao' }] }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toContain('non sono ancora attivi');
  });
});

describe('la condizione del prodotto ha una fonte sola, senza «usato» (2262, 2267)', () => {
  it('le due chat usano PRODUCT_PATCH_PROPERTIES.condition', () => {
    for (const f of ['app/api/ai/product-chat/route.ts', 'app/api/ai/catalog-chat/route.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toContain('condition: PRODUCT_PATCH_PROPERTIES.condition');
      expect(src.match(/'usato'/g) ?? [], f).toHaveLength(0);
    }
  });
  it('lo schema mandato dalla chat del prodotto non offre «usato» e dice di omettere il campo', async () => {
    await POST(makeReq({ product: {}, history: [{ role: 'user', content: 'ciao' }] }));
    const tools = runMessageMock.mock.calls[0][0].tools as { name?: string; input_schema?: { properties?: Record<string, { properties?: Record<string, { enum?: unknown[] }> }> } }[];
    const edit = tools.find((t) => t.input_schema);
    const condizione = edit!.input_schema!.properties!.patch.properties!.condition as { enum: unknown[]; description: string };
    expect(condizione.enum).not.toContain('usato');
    expect(condizione.description).toMatch(/Ometti/);
    expect(PRODUCT_PATCH_PROPERTIES.condition).toBe(condizione);
  });
});

describe('un messaggio rifiutato non blocca la chat per sempre (revisione 1684)', () => {
  it('se il rifiuto viene da un messaggio vecchio, l\'ultimo passa e al modello va solo lui', async () => {
    const { UnsafeContentError } = await import('@/lib/ai/moderation');
    assertSafeTextMock.mockImplementation(async (t: string) => {
      if (t.includes('VIETATO')) throw new (UnsafeContentError as unknown as new () => Error)();
      return undefined;
    });
    const res = await POST(
      makeReq({
        product: {},
        history: [
          { role: 'user', content: 'VIETATO' },
          { role: 'assistant', content: 'Ops' },
          { role: 'user', content: 'migliora il titolo' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(JSON.stringify(runMessageMock.mock.calls[0][0].messages)).not.toContain('VIETATO');
  });
  it('se è l\'ultimo a essere vietato, resta 400', async () => {
    const { UnsafeContentError } = await import('@/lib/ai/moderation');
    assertSafeTextMock.mockImplementation(async (t: string) => {
      if (t.includes('VIETATO')) throw new (UnsafeContentError as unknown as new () => Error)();
      return undefined;
    });
    const res = await POST(makeReq({ product: {}, history: [{ role: 'user', content: 'ciao' }, { role: 'assistant', content: 'ok' }, { role: 'user', content: 'VIETATO' }] }));
    expect(res.status).toBe(400);
    expect(runMessageMock).not.toHaveBeenCalled();
  });
});
