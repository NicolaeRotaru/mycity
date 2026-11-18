import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * R03-010 — Quando Anthropic non risponde, Vercel spegneva la funzione AI prima che il negozio
 * leggesse un errore chiaro. Il client aveva 60 s e un ritentativo (l'SDK ritenta anche dopo un
 * timeout): 120,5 s per una chiamata, contro i 120 s delle rotte app/api/ai/** (vercel.json). La
 * lettura da foto fa due chiamate in fila e non aveva un tempo dichiarato.
 */

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'cat-1' }, error: null }) }) }) }),
    }),
  })),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { getAnthropic, __resetAnthropicClient } from '@/lib/ai/client';
import { POST } from '@/app/api/vision/extract-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions: Record<string, { maxDuration?: number }>;
};
/** Il filtro che alcune rotte chiamano prima del modello, e il margine per rispondere l'errore. */
const FILTRO_MS = 10_000;
const MARGINE_MS = 10_000;

describe('R03-010 · il tempo del client sta sotto quello della rotta', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    __resetAnthropicClient();
  });

  it('una chiamata col tempo del client, più il filtro e il margine, sta nei 120 s delle rotte AI', () => {
    const client = getAnthropic();
    const rottaMs = (vercel.functions['app/api/ai/**/route.ts']?.maxDuration ?? 0) * 1000;
    // L'SDK ritenta anche dopo un timeout, con una pausa di circa mezzo secondo.
    const peggioreMs = (client.maxRetries + 1) * client.timeout + client.maxRetries * 500;
    expect(peggioreMs + FILTRO_MS + MARGINE_MS).toBeLessThanOrEqual(rottaMs);
  });

  it('un tentativo resta di 60 s: le risposte lunghe che arrivavano al primo tentativo arrivano ancora', () => {
    expect(getAnthropic().timeout).toBeGreaterThanOrEqual(60_000);
  });

  it('la lettura da foto ha un tempo dichiarato in vercel.json', () => {
    expect(vercel.functions['app/api/vision/extract-product/route.ts']?.maxDuration).toBe(120);
  });
});

const JPEG_VERO = '/9j/4AAQSkZJRgABAQAAAQABAAA=';
const POCO_SICURO = {
  name: 'Sedia', description: 'Sedia in legno', category_slug: 'casa', suggested_price_eur: 29.9,
  image_quality: { score: 0.9, issues: [] }, alt_text: 'Sedia in legno chiaro', policy_ok: true, confidence: 0.4,
};

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/vision/extract-product', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

describe('R03-010 · la verifica sul web ha solo il tempo che resta alla rotta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('la prima chiamata ha preso 59 s: la verifica parte con il tempo che resta, senza ritentativi', async () => {
    runMessageMock
      .mockImplementationOnce(async () => {
        vi.setSystemTime(Date.now() + 59_000);
        return { toolInput: POCO_SICURO };
      })
      .mockImplementationOnce(async () => ({ toolInput: { ...POCO_SICURO, confidence: 0.9 } }));
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    expect(runMessageMock).toHaveBeenCalledTimes(2);
    const verifica = runMessageMock.mock.calls[1][0] as { timeoutMs?: number; senzaRitentativi?: boolean };
    expect(verifica.senzaRitentativi).toBe(true);
    expect(verifica.timeoutMs).toBeGreaterThan(0);
    // 59 s già passati + il tempo della verifica + il margine stanno nei 120 s della rotta.
    expect(59_000 + (verifica.timeoutMs ?? Infinity) + MARGINE_MS).toBeLessThanOrEqual(120_000);
  });

  it('se alla rotta non resta tempo la verifica non parte, e il negozio riceve la prima lettura', async () => {
    runMessageMock.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 100_000);
      return { toolInput: POCO_SICURO };
    });
    const res = await POST(makeReq({ image_base64: JPEG_VERO, media_type: 'image/jpeg' }));
    expect(res.status).toBe(200);
    expect(runMessageMock).toHaveBeenCalledTimes(1);
    expect(((await res.json()) as { name?: string }).name).toBe('Sedia');
  });
});
