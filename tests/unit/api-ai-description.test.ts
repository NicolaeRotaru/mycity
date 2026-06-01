import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Test route AI description: comportamento invariato dopo il refactor su runMessage.
 * Auth mockata; runMessage mockato; rate limit reale (reset per test).
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(() => ({
    from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { store_name: 'Bottega' }, error: null }) }) }) }),
  })),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST } from '@/app/api/ai/description/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';
import { MODELS, AiConfigError } from '@/lib/ai/client';
import { AiCallError } from '@/lib/ai/run';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/description', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

describe('POST /api/ai/description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    runMessageMock.mockResolvedValue({ text: 'Una descrizione calda e onesta del prodotto locale.' });
  });

  it('400 su JSON non valido', async () => {
    const res = await POST(makeReq('non-json'));
    expect(res.status).toBe(400);
  });

  it('400 se manca il nome', async () => {
    const res = await POST(makeReq({ name: 'a' }));
    expect(res.status).toBe(400);
  });

  it('503 se la chiave AI non è configurata', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const res = await POST(makeReq({ name: 'Pomodori' }));
    expect(res.status).toBe(503);
  });

  it('200 con descrizione; chiama runMessage con model fast, system e il nome nei messages', async () => {
    const res = await POST(makeReq({ name: 'Pomodori ciliegino', category: 'alimentari' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.description).toMatch(/descrizione/i);
    const arg = runMessageMock.mock.calls[0][0];
    expect(arg.model).toBe(MODELS.fast);
    expect(typeof arg.system).toBe('string');
    expect(JSON.stringify(arg.messages)).toContain('Pomodori ciliegino');
  });

  it('500 se il modello non restituisce testo', async () => {
    runMessageMock.mockResolvedValue({ text: '' });
    const res = await POST(makeReq({ name: 'Pomodori' }));
    expect(res.status).toBe(500);
  });

  it('429 quando runMessage segnala rate limit upstream (AiCallError 429)', async () => {
    runMessageMock.mockRejectedValue(new AiCallError('ai-description', 429));
    const res = await POST(makeReq({ name: 'Pomodori' }));
    expect(res.status).toBe(429);
  });

  it('503 quando la config AI è assente a runtime (AiConfigError)', async () => {
    runMessageMock.mockRejectedValue(new AiConfigError());
    const res = await POST(makeReq({ name: 'Pomodori' }));
    expect(res.status).toBe(503);
  });

  it('429 dopo 20 chiamate/giorno (rate limit per utente)', async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await POST(makeReq({ name: 'Pomodori' }));
      expect(ok.status).toBe(200);
    }
    const res = await POST(makeReq({ name: 'Pomodori' }));
    expect(res.status).toBe(429);
  });
});
