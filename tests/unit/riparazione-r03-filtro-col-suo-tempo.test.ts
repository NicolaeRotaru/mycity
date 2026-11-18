import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R03-011 — Il filtro di moderazione prima del Copilot non aveva un tempo suo: usava quello del
 * client (60 s, e allora anche un ritentativo). Con un fornitore che non risponde affatto, filtro
 * più Copilot (80 s) passavano i 120 s della rotta e Vercel la spegneva prima dell'errore chiaro.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) => h({ user: FAKE_USER, req }),
}));

const PRODUCTS = [{
  id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Vaso', description: '', price: 10, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'c1', images: [], attributes: {},
  tags: [], has_variants: false,
}];
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'products'
        ? { select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: PRODUCTS, error: null }) }) }) }) }
        : { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) },
  }),
}));

const createMock = vi.fn();
vi.mock('@/lib/ai/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/client')>();
  return { ...actual, getAnthropic: () => ({ messages: { create: createMock } }) };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), spesa: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from '@/app/api/ai/copilot/route';
import { assertSafeText } from '@/lib/ai/moderation';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

type Opzioni = { timeout?: number; maxRetries?: number } | undefined;
const USO = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null };
const VIA_LIBERA = { content: [{ type: 'tool_use', id: 'f', name: 'flag', input: { allowed: true } }], stop_reason: 'tool_use', usage: USO };
const PIANO = { content: [{ type: 'tool_use', id: 't', name: 'bulk_edit', input: { reply: 'ok', changes: [] } }], stop_reason: 'tool_use', usage: USO };

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/copilot', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never;
}

describe('R03-011 · il filtro prima del Copilot ha un tempo suo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
  });

  it('il filtro dichiara il suo tempo, breve, e niente ritentativi', async () => {
    createMock.mockResolvedValue(VIA_LIBERA);
    await assertSafeText('un testo qualsiasi', 'prova-filtro');
    const opzioni = createMock.mock.calls[0][1] as Opzioni;
    expect(opzioni?.timeout).toBeGreaterThan(0);
    expect(opzioni?.timeout).toBeLessThanOrEqual(15_000);
    expect(opzioni?.maxRetries).toBe(0);
  });

  it('filtro più Copilot, col fornitore che non risponde, stanno nei 120 s della rotta con il margine', async () => {
    createMock.mockResolvedValueOnce(VIA_LIBERA).mockResolvedValueOnce(PIANO);
    const res = await POST(makeReq({ instruction: 'metti in bozza gli esauriti' }));
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2);
    const tempoPeggiore = (o: Opzioni) => {
      // Senza un tempo dichiarato la chiamata non ha un tetto suo: vale quanto il client, cioè
      // non si può contare. La si conta come la rotta intera.
      if (o?.timeout === undefined) return 120_000;
      const tentativi = (o.maxRetries ?? 1) + 1;
      return tentativi * o.timeout + (tentativi - 1) * 500;
    };
    const filtro = createMock.mock.calls[0][1] as Opzioni;
    const copilot = createMock.mock.calls[1][1] as Opzioni;
    expect(tempoPeggiore(filtro) + tempoPeggiore(copilot) + 10_000).toBeLessThanOrEqual(120_000);
  });
});
