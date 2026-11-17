import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R02-002 — Il freno degli strumenti AI per i negozi sta sulla rotta, non solo nella pagina.
 *
 * `AI_NEGOZI_ACCESA` è spento al lancio (carta #209). La pagina non mostra il pulsante, ma chi
 * chiamava a mano /api/ai/catalog-create consumava il limite, faceva leggere il corpo e passava
 * dal filtro prima di cadere su «Servizio AI non configurato». Adesso la rotta lo dice subito,
 * come catalog-batch/start: 503 «non sono ancora attivi», niente limite, niente filtro, niente
 * database.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
const interruttore = vi.hoisted(() => ({ acceso: false }));
const chiamate = vi.hoisted(() => ({ limite: 0, filtro: 0, database: 0 }));

vi.mock('@/lib/funzioni-al-lancio', async (o) => {
  const veri = (await o()) as Record<string, unknown>;
  return {
    ...veri,
    get AI_NEGOZI_ACCESA() {
      return interruttore.acceso;
    },
  };
});
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/rate-limit', async (o) => ({
  ...((await o()) as Record<string, unknown>),
  rateLimitAsync: async () => {
    chiamate.limite++;
    return { allowed: true, retryAfterSec: 0 };
  },
}));
vi.mock('@/lib/ai/moderation', async (o) => ({
  ...((await o()) as Record<string, unknown>),
  classifyProductPolicy: async () => {
    chiamate.filtro++;
    return { allowed: true };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => {
    chiamate.database++;
    return {
      from: (tabella: string) =>
        tabella === 'categories'
          ? { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }
          : {
              insert: () => ({
                select: () => ({ single: () => Promise.resolve({ data: { id: 'p-1', name: 'Vaso' }, error: null }) }),
              }),
            },
    };
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));

import { POST as creaDalleFoto } from '@/app/api/ai/catalog-create/route';

const richiesta = () =>
  new Request('http://localhost/api/ai/catalog-create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageUrls: ['https://abcdefgh.supabase.co/storage/v1/object/public/products/a.jpg'],
      draft: { name: 'Vaso di ceramica', description: 'Fatto a mano.' },
    }),
  }) as never;

describe('R02-002 — con gli strumenti AI spenti la rotta delle bozze dalle foto rifiuta subito', () => {
  beforeEach(() => {
    interruttore.acceso = false;
    chiamate.limite = 0;
    chiamate.filtro = 0;
    chiamate.database = 0;
  });

  it('spento: 503 «non sono ancora attivi», e nessun limite, filtro o database toccato', async () => {
    const res = await creaDalleFoto(richiesta());
    expect(res.status).toBe(503);
    const corpo = await res.json();
    expect(JSON.stringify(corpo)).toContain('Gli strumenti AI per i negozi non sono ancora attivi.');
    expect(chiamate).toEqual({ limite: 0, filtro: 0, database: 0 });
  });

  it('acceso (controprova): la rotta passa il freno e lavora come prima', async () => {
    interruttore.acceso = true;
    const res = await creaDalleFoto(richiesta());
    expect(res.status).not.toBe(503);
    expect(chiamate.limite).toBe(1);
    expect(chiamate.filtro).toBe(1);
  });
});
