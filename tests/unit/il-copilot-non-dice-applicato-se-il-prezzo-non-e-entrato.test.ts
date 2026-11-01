import { describe, it, expect, vi, beforeEach } from 'vitest';

const aggiornamenti: Array<Record<string, unknown>> = [];
const PRODOTTO = {
  id: 'p1', seller_id: 'venditore-1', name: 'Cesto di pane', description: 'Pane misto del giorno',
  price: 20, compare_at_price: null, unit: null, condition: null, stock: 5, status: 'draft',
  category_id: null, images: [], attributes: {}, tags: [], has_variants: false,
};
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })), getClientIp: () => '1.2.3.4' }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, classifyProductPolicy: async () => ({ allowed: true, reason: '' }) };
});
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) => h({ user: { id: 'venditore-1' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'products') {
        return {
          select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [PRODOTTO], error: null }) }) }),
          update: (valori: Record<string, unknown>) => {
            aggiornamenti.push(valori);
            const passo: Record<string, unknown> = { eq: () => passo, then: (r: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
            return passo;
          },
        };
      }
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
  }),
}));

beforeEach(() => { aggiornamenti.length = 0; vi.resetModules(); });

describe('Copilot: prezzo +50% rifiutato insieme a un altro campo', () => {
  it('il negoziante non legge «Applicato» col prezzo vecchio', async () => {
    const { POST } = await import('@/app/api/ai/catalog-apply-bulk/route');
    const { avvisoDopoLApplicazione } = await import('@/lib/ai/esitoCopilot');
    const res = await (POST as unknown as (req: Request) => Promise<Response>)(new Request('http://localhost/api/ai/catalog-apply-bulk', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: [{ productId: 'p1', patch: { price: 30, unit: 'kg' } }] }),
    }));
    const json = await res.json();
    expect(aggiornamenti.filter((u) => 'price' in u)).toEqual([]);
    expect(aggiornamenti.length).toBe(1);
    const avviso = avvisoDopoLApplicazione(json, [{ product_id: 'p1', name: 'Cesto di pane' }]);
    console.log('AVVISO', JSON.stringify(avviso));
    expect(avviso.tipo).toBe('avviso');
    expect(avviso.testo).toContain('prezzo NON applicato');
  });
});
