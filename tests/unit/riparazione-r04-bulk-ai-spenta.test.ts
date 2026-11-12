import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R04-006 — Con l'intelligenza artificiale spenta, la creazione di prodotti in
 * blocco rispondeva «riprova fra poco» per ogni bozza, come un guasto
 * passeggero. Adesso dice che il servizio e' spento (503), e un AiConfigError
 * dal filtro vale per tutta la richiesta.
 */

const stato = { accesa: false };
vi.mock('@/lib/funzioni-al-lancio', async (originale) => {
  const vero = (await originale()) as Record<string, unknown>;
  return {
    ...vero,
    get AI_NEGOZI_ACCESA() {
      return stato.accesa;
    },
  };
});
const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));
const insertMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'categories'
        ? { select: () => ({ order: () => Promise.resolve({ data: [{ id: 'c', name: 'Casa', slug: 'casa', parent_id: null }], error: null }) }) }
        : { insert: insertMock },
  }),
}));
const policyMock = vi.fn();
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: (...a: unknown[]) => policyMock(...a),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

import { POST } from '@/app/api/ai/catalog-create-bulk/route';
import { AiConfigError } from '@/lib/ai/client';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-create-bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [1, 2].map((n) => ({
        imageUrls: [`https://abcdefgh.supabase.co/storage/v1/object/public/products/${n}.jpg`],
        draft: { name: `Bozza ${n}`, category_slug: 'casa', suggested_price: 9.9 },
      })),
    }),
  }) as never;

describe('creazione in blocco con l\'AI spenta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
  });

  it('interruttore spento: 503 «non ancora attivi», nessun filtro chiamato', async () => {
    stato.accesa = false;
    const res = await POST(richiesta());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).toMatch(/non sono ancora attivi/);
    expect(policyMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('servizio non configurato dentro il filtro: 503 per la richiesta, non «riprova fra poco»', async () => {
    stato.accesa = true;
    policyMock.mockRejectedValue(new AiConfigError());
    const res = await POST(richiesta());
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/riprova fra poco/);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
