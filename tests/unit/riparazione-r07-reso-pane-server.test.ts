import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * R07-002 (12/11/2026, dopo il controllo qa) — il pane segnato esaurito la sera non si vede
 * più col client del cliente: la pagina lo contava come recedibile e offriva «Ho cambiato
 * idea», che returns/create rifiutava. /api/returns/ripensamento legge i prodotti come
 * returns/create, col client di servizio, e dà la stessa risposta.
 */
const db = vi.hoisted(() => ({
  ordine: { id: 'o1', user_id: 'buyer-1' } as unknown,
  righe: [] as unknown[],
  prodottiServizio: [] as unknown[],
}));
vi.mock('@/lib/api/middleware', () => ({
  withAuthRateLimit: (_o: unknown, h: (c: { user: { id: string }; req: Request }) => unknown) => (req: Request) => h({ user: { id: 'buyer-1' }, req }),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({
    from: (t: string) => ({
      select: () => ({
        eq: () =>
          t === 'orders'
            ? { maybeSingle: async () => ({ data: db.ordine, error: null }) }
            : Promise.resolve({ data: db.righe, error: null }),
      }),
    }),
  }),
  getAdminSupabase: () => ({
    from: () => ({ select: () => ({ in: async () => ({ data: db.prodottiServizio, error: null }) }) }),
  }),
}));

import { GET } from '@/app/api/returns/ripensamento/route';

const chiedi = (orderId = '11111111-1111-4111-8111-111111111111') =>
  (GET as unknown as (r: Request) => Promise<Response>)(new Request(`http://x/api/returns/ripensamento?orderId=${orderId}`));

beforeEach(() => {
  db.ordine = { id: 'o1', user_id: 'buyer-1' };
  db.righe = [{ product_id: 'p1', product_name: 'Pane casereccio' }];
  db.prodottiServizio = [{ id: 'p1', name: 'Pane casereccio', non_recedibile: true, status: 'out_of_stock' }];
});

describe('R07-002 · il server dice se il ripensamento si può chiedere', () => {
  it('pane escluso, segnato esaurito dopo l ordine: rifiuto (art. 59)', async () => {
    const res = await chiedi();
    expect(res.status).toBe(200);
    expect((await res.json()).rifiuto).toMatch(/art\. 59/);
  });

  it('ordine misto: nessun rifiuto', async () => {
    db.righe = [{ product_id: 'p1', product_name: 'Pane' }, { product_id: 'p2', product_name: 'Miele' }];
    db.prodottiServizio = [{ id: 'p1', name: 'Pane', non_recedibile: true }, { id: 'p2', name: 'Miele', non_recedibile: false }];
    expect((await (await chiedi()).json()).rifiuto).toBeNull();
  });

  it('l ordine di un altro: 403', async () => {
    db.ordine = { id: 'o1', user_id: 'altro' };
    expect((await chiedi()).status).toBe(403);
  });

  it('id non valido: 400', async () => {
    expect((await chiedi('non-un-id')).status).toBe(400);
  });
});
