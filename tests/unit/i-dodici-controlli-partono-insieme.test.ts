/**
 * 22/8/2026 — I CONTROLLI DI CONFORMITA' PARTIVANO IN FILA INDIANA.
 *
 * Quando il venditore carica piu' prodotti in un colpo, ognuno passa dal filtro
 * dei prodotti vietati, e ogni filtro e' un'andata e ritorno verso il modello.
 * Partivano in fila: il secondo quando il primo era tornato. Con dodici
 * prodotti — il massimo che la richiesta accetta — sono dodici attese sommate,
 * e nel caso peggiore la richiesta scade prima di scrivere qualsiasi cosa.
 *
 * Questa prova conta quanti controlli sono in volo nello stesso momento. Se
 * qualcuno rimette il ciclo in fila, il massimo torna a uno e la prova diventa
 * rossa.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));

const CATEGORIES = [{ id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null }];
const insertSelectMock = vi.fn();
const insertMock = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) =>
      table === 'categories'
        ? { select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) }
        : { insert: insertMock },
  }),
}));

let inVolo = 0;
let massimoInVolo = 0;
type ArgFiltro = { name?: string; description?: string; categorySlug?: string };
type EsitoFiltro = { allowed: boolean; reason?: string };
const policyMock = vi.fn(async (_arg: ArgFiltro): Promise<EsitoFiltro> => {
  inVolo += 1;
  massimoInVolo = Math.max(massimoInVolo, inVolo);
  await new Promise((r) => setTimeout(r, 5));
  inVolo -= 1;
  return { allowed: true } as { allowed: boolean; reason?: string };
});
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: (...a: unknown[]) => policyMock(...(a as [ArgFiltro])),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

import { POST } from '@/app/api/ai/catalog-create-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function makeReq(body: unknown): never {
  return new Request('http://localhost/api/ai/catalog-create-bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function item(n: number) {
  return {
    imageUrls: [`https://abcdefgh.supabase.co/storage/v1/object/public/products/${n}.jpg`],
    draft: { name: `Lampada ${n}`, category_slug: 'casa', suggested_price: 9.9 },
  };
}

describe('POST /api/ai/catalog-create-bulk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    inVolo = 0;
    massimoInVolo = 0;
    insertMock.mockReturnValue({ select: insertSelectMock });
    insertSelectMock.mockResolvedValue({
      data: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}` })),
      error: null,
    });
  });

  it('i dodici controlli sono in volo insieme, non uno dopo l\'altro', async () => {
    const items = Array.from({ length: 12 }, (_, i) => item(i));
    const res = await POST(makeReq({ items }));
    expect(res.status).toBe(200);
    expect(policyMock).toHaveBeenCalledTimes(12);
    expect(massimoInVolo).toBe(12);
  });

  it('l\'ordine dei verdetti resta quello dei prodotti: si scarta il secondo, non un altro', async () => {
    policyMock.mockImplementation(async (arg) =>
      arg?.name === 'Lampada 1'
        ? { allowed: false, reason: 'prodotto non ammesso' }
        : { allowed: true },
    );
    insertSelectMock.mockResolvedValue({ data: [{ id: 'p0' }, { id: 'p2' }], error: null });
    const res = await POST(makeReq({ items: [item(0), item(1), item(2)] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scartati).toEqual([{ nome: 'Lampada 1', motivo: 'prodotto non ammesso' }]);
    const scritti = insertMock.mock.calls[0][0] as Array<{ name: string }>;
    expect(scritti.map((p) => p.name)).toEqual(['Lampada 0', 'Lampada 2']);
  });

  it('se il filtro cade su uno, gli altri entrano lo stesso e quello no', async () => {
    policyMock.mockImplementation(async (arg) => {
      if (arg?.name === 'Lampada 1') throw new Error('modello giu');
      return { allowed: true };
    });
    insertSelectMock.mockResolvedValue({ data: [{ id: 'p0' }, { id: 'p2' }], error: null });
    const res = await POST(makeReq({ items: [item(0), item(1), item(2)] }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scartati).toHaveLength(1);
    expect(json.scartati[0].nome).toBe('Lampada 1');
    expect((insertMock.mock.calls[0][0] as unknown[]).length).toBe(2);
  });
});
