/**
 * 22/8/2026 — IL LAVORO MASSIVO SCRIVEVA NOME E DESCRIZIONE SENZA FILTRO.
 *
 * La rotta che applica UNA modifica passa dal filtro dei prodotti vietati, e lo
 * dice con parole sue: «un filtro che si puo' aggirare cambiando strada non e'
 * un filtro». La rotta che ne applica cinquanta insieme, no.
 *
 * Onesta' sulla portata: questa NON e' copertura piena. Il venditore modifica i
 * propri prodotti anche dal browser, scrivendo dritto sul database, e quella
 * strada non passa da nessuna rotta. Qui si chiude una scorciatoia, non la
 * porta grande.
 *
 * Queste prove diventano rosse se il lotto torna a scrivere senza chiedere.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

type ArgFiltro = { name?: string; description?: string };
type EsitoFiltro = { allowed: boolean; reason?: string };
const policyMock = vi.fn(async (_arg: ArgFiltro): Promise<EsitoFiltro> => ({ allowed: true }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: (...a: unknown[]) => policyMock(...(a as [ArgFiltro])),
}));

const PRODOTTI = [
  {
    id: 'p1', name: 'Lampada', description: 'Una lampada.', price: 10, compare_at_price: null,
    unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'casa-top',
    images: [], attributes: {}, tags: [], has_variants: false, seller_id: 'seller-1',
  },
  {
    id: 'p2', name: 'Sedia', description: 'Una sedia.', price: 20, compare_at_price: null,
    unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'casa-top',
    images: [], attributes: {}, tags: [], has_variants: false, seller_id: 'seller-1',
  },
];

const JOB = {
  id: 'job-1',
  seller_id: 'seller-1',
  operation: 'improve',
  status: 'ready',
  results: [
    { product_id: 'p1', patch: { name: 'Lampada di design' } },
    { product_id: 'p2', patch: { name: 'Sedia impagliata' } },
  ],
};

const scritture: Array<{ id: string; update: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'catalog_ai_jobs') {
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: JOB, error: null }) }) }),
          // A fine giro il job viene segnato come applicato.
          update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
        };
      }
      if (table === 'categories') {
        return {
          select: () => ({
            order: async () => ({
              data: [{ id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null }],
              error: null,
            }),
          }),
        };
      }
      // products
      return {
        select: () => ({ eq: () => ({ in: async () => ({ data: PRODOTTI, error: null }) }) }),
        update: (update: Record<string, unknown>) => ({
          eq: (_c1: string, id: string) => ({
            eq: async () => {
              scritture.push({ id, update });
              return { error: null };
            },
          }),
        }),
      };
    },
  }),
}));

import { POST } from '@/app/api/ai/catalog-batch/apply/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(): never {
  return new Request('http://localhost/api/ai/catalog-batch/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-1' }),
  }) as never;
}

describe('POST /api/ai/catalog-batch/apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    scritture.length = 0;
    policyMock.mockResolvedValue({ allowed: true });
  });

  it('chi tocca nome o descrizione passa dal filtro, uno per prodotto', async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(policyMock).toHaveBeenCalledTimes(2);
    expect(scritture.map((s) => s.id).sort()).toEqual(['p1', 'p2']);
  });

  it('il prodotto che il filtro nega non viene scritto, l\'altro sì', async () => {
    policyMock.mockImplementation(async (arg) =>
      arg?.name === 'Sedia impagliata'
        ? { allowed: false, reason: 'contenuto non ammesso' }
        : { allowed: true },
    );
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(scritture.map((s) => s.id)).toEqual(['p1']);
  });

  it('se il filtro cade, nel dubbio non si scrive', async () => {
    policyMock.mockRejectedValue(new Error('modello giu'));
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(scritture).toHaveLength(0);
  });
});
