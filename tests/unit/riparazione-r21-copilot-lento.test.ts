import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R21-002 — Con un fornitore lento (40 token al secondo) la risposta lunga del
 * Copilot deve poter arrivare in UN tentativo, e un tentativo che scade non si
 * ripete: l'errore chiaro arriva prima che Vercel spenga la rotta (120 s).
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

// Un catalogo grande: il tetto di token è quello pieno.
const PRODUCTS = Array.from({ length: 150 }, (_, i) => ({
  id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
  name: `Prodotto ${i}`, description: '', price: 10, compare_at_price: null, unit: 'pezzo', condition: null,
  stock: 1, status: 'available', category_id: 'el', images: [], attributes: {}, tags: [], has_variants: false,
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) },
  }),
}));

vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, assertSafeText: async () => undefined };
});

const createMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/ai/copilot/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

describe('R21-002 · il Copilot con un fornitore lento', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', id: 't', name: 'bulk_edit', input: { reply: 'ok', changes: [] } }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
  });

  it('la risposta più lunga che si chiede arriva in un tentativo a 40 token al secondo', async () => {
    await POST(makeReq({ instruction: 'abbassa del 10% tutto' }));
    const [corpo, opzioni] = createMock.mock.calls[0] as [{ max_tokens: number }, { timeout?: number }];
    const secondiNecessari = corpo.max_tokens / 40;
    // Prima: 6000 token = 150 s, contro un tentativo da 60 s (o da 40 s).
    expect(secondiNecessari * 1000).toBeLessThanOrEqual(opzioni?.timeout ?? 60_000);
  });

  it('un tentativo che scade non si ripete, e il filtro più il tentativo restano sotto i 120 s', async () => {
    await POST(makeReq({ instruction: 'abbassa del 10% tutto' }));
    const opzioni = createMock.mock.calls[0][1] as { timeout?: number; maxRetries?: number } | undefined;
    const tentativi = (opzioni?.maxRetries ?? 1) + 1; // l'SDK ritenta una volta se non glielo si vieta
    const tempo = opzioni?.timeout ?? 60_000;
    const filtroPeggiore = 33_100; // due tentativi da 16,3 s + la pausa (lib/ai/run.ts)
    expect(filtroPeggiore + tentativi * tempo + 500).toBeLessThan(120_000);
  });
});
