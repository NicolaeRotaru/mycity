import { describe, it, expect, vi } from 'vitest';

/**
 * S10 (5/11/2026, scheda 247) — con l'AI per i negozi spenta ma la chiave
 * presente, l'importazione da link diceva «API key Anthropic non valida».
 */

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    handler({ user: { id: 'seller-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/products/externalSync', async () => {
  const { AiConfigError } = await import('@/lib/ai/client');
  return {
    fetchExternalSnapshot: async () => {
      throw new AiConfigError('Gli strumenti AI per i negozi non sono ancora attivi.');
    },
    resolveCategoryFromSlug: async () => ({ categoryId: null, subcategoryId: null }),
  };
});

import { POST } from '@/app/api/marketplace/import-fetch/route';

describe('import da link con l\'AI spenta (247)', () => {
  it('risponde 503 dicendo che gli strumenti non sono attivi, non «chiave non valida»', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
    const res = await POST(
      new Request('http://localhost/api/marketplace/import-fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'https://example.com/prodotto' }),
      }) as never,
    );
    expect(res.status).toBe(503);
    const testo = JSON.stringify(await res.json());
    expect(testo).toContain('non sono ancora attivi');
    expect(testo).not.toMatch(/non valida/);
  });
});
