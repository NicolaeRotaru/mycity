import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R10-008 — La traccia «chi ha cambiato il prezzo» usciva in due forme diverse
 * a seconda della porta. Il modulo del prodotto scrive la voce con
 * `tracciaDellaModifica`: solo i campi cambiati, con `daAi`. La chat dell'AI
 * (catalog-apply) la scriveva a mano: tutte le chiavi mandate, anche quelle
 * rimaste uguali, e nessun `daAi`. Qui si fa girare la rotta VERA della chat.
 */

const stato = vi.hoisted(() => ({ audit: [] as Array<Record<string, any>> }));

const PRODOTTO = {
  id: 'p1', seller_id: 'venditore-1', name: 'Cesto di pane', description: 'Pane misto del giorno',
  price: 20, compare_at_price: null, unit: null, condition: null, stock: 5, status: 'draft',
  category_id: null, images: [], attributes: {}, tags: [], has_variants: false,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async (v: Record<string, any>) => { stato.audit.push(v); }) }));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, classifyProductPolicy: async () => ({ allowed: true, reason: '' }) };
});
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (h: (ctx: { user: { id: string }; req: Request }) => unknown) => (req: Request) =>
    h({ user: { id: 'venditore-1' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'products') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: PRODOTTO, error: null }) }) }),
          update: (valori: Record<string, unknown>) => {
            const esito = { data: { ...PRODOTTO, ...valori }, error: null };
            const passo: Record<string, unknown> = {
              eq: () => passo, select: () => passo, single: () => Promise.resolve(esito),
              then: (r: (x: unknown) => unknown) => Promise.resolve(esito).then(r),
            };
            return passo;
          },
        };
      }
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
  }),
}));

async function applica(patch: Record<string, unknown>) {
  const { POST } = await import('@/app/api/ai/catalog-apply/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/ai/catalog-apply', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'p1', patch }),
    }),
  );
  return res.status;
}

beforeEach(() => { stato.audit = []; });

describe('R10-008 — una forma sola per la traccia', () => {
  it('dalla chat: la voce dice che il campo l’ha proposto l’AI, come dal modulo', async () => {
    expect(await applica({ price: 22 })).toBe(200);
    expect(stato.audit).toHaveLength(1);
    const m = stato.audit[0].metadata;
    expect(m.origine).toBe('ai-copilot');
    expect(m.daAi, 'la traccia della chat non ha daAi').toEqual(['price']);
    expect(m.campi).toEqual(['price']);
    expect(m.prima).toEqual({ price: 20 });
    expect(m.dopo).toEqual({ price: 22 });
  });

  it('un campo mandato ma rimasto uguale non finisce nel registro', async () => {
    expect(await applica({ price: 22, name: 'Cesto di pane' })).toBe(200);
    const m = stato.audit[0].metadata;
    expect(m.campi, 'il nome non è cambiato ma risulta modificato').toEqual(['price']);
    expect(Object.keys(m.prima)).toEqual(['price']);
  });
});
