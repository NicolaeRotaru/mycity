/**
 * IL LOTTO SUL CATALOGO SENZA L'ELENCO DEI PRODOTTI NON APPLICA TUTTO.
 *
 * La rotta che applica un lavoro massivo dell'AI riceve l'elenco dei prodotti che il negoziante
 * ha scelto dopo averli rivisti. Senza elenco valeva «tutti»: una chiamata con il solo jobId
 * (un vecchio client, uno script, un clic partito prima della scelta) scriveva ogni risultato
 * del lavoro, anche quelli che il negoziante non aveva visto. Adesso senza elenco la rotta dice
 * di scegliere (400) e non scrive niente; con l'elenco scrive solo quelli.
 *
 * Queste prove diventano rosse se la rotta torna ad applicare tutto quando l'elenco manca.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
// La rotta legge l'interruttore spento al lancio: qui si prova la funzione accesa.
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));

vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/ai/moderation', () => ({
  classifyProductPolicy: vi.fn(async () => ({ allowed: true })),
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

// Il database finto: il lavoro (con il suo stato) e ogni scrittura, su qualunque tabella.
const db = vi.hoisted(() => ({
  lavoro: { status: 'ready' },
  scritture: [] as Array<{ tabella: string; tipo: 'update' | 'insert' | 'upsert' | 'delete'; id?: string; valori?: unknown }>,
}));

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      const scrivi = (tipo: 'insert' | 'upsert' | 'delete') => (valori?: unknown) => {
        db.scritture.push({ tabella, tipo, valori });
        const c: Record<string, unknown> = {};
        c.eq = () => c;
        c.select = async () => ({ data: [], error: null });
        c.then = (ok: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
        return c;
      };
      if (tabella === 'catalog_ai_jobs') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'job-1',
                  seller_id: 'seller-1',
                  operation: 'improve',
                  status: db.lavoro.status,
                  results: [
                    { product_id: 'p1', patch: { name: 'Lampada di design' } },
                    { product_id: 'p2', patch: { name: 'Sedia impagliata' } },
                  ],
                },
                error: null,
              }),
            }),
          }),
          // La prenotazione (ready → applied) e il «rimetti pronto»: update condizionati.
          update: (valori: { status?: string }) => {
            db.scritture.push({ tabella, tipo: 'update', valori });
            if (valori.status) db.lavoro.status = valori.status;
            const c: Record<string, unknown> = {};
            c.eq = () => c;
            c.select = async () => ({ data: [{ id: 'job-1' }], error: null });
            c.then = (ok: (x: unknown) => unknown) => Promise.resolve({ error: null }).then(ok);
            return c;
          },
          insert: scrivi('insert'),
          upsert: scrivi('upsert'),
          delete: scrivi('delete'),
        };
      }
      if (tabella === 'categories') {
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
        select: () => ({
          eq: () => ({
            in: async (_c: string, ids: string[]) => ({ data: PRODOTTI.filter((p) => ids.includes(p.id)), error: null }),
          }),
        }),
        update: (valori: Record<string, unknown>) => ({
          eq: (_c1: string, id: string) => ({
            eq: async () => {
              db.scritture.push({ tabella, tipo: 'update', id, valori });
              return { error: null };
            },
          }),
        }),
        insert: scrivi('insert'),
        upsert: scrivi('upsert'),
        delete: scrivi('delete'),
      };
    },
  }),
}));

import { POST } from '@/app/api/ai/catalog-batch/apply/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(corpo: Record<string, unknown>): never {
  return new Request('http://localhost/api/ai/catalog-batch/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

describe('POST /api/ai/catalog-batch/apply senza l\'elenco dei prodotti', () => {
  beforeEach(() => {
    __resetRateLimitBuckets();
    db.lavoro.status = 'ready';
    db.scritture.length = 0;
  });

  it('con il solo jobId: 400, nessuna scrittura, il lavoro resta «pronto»', async () => {
    const res = await POST(richiesta({ jobId: 'job-1' }));
    expect(res.status, 'senza elenco il lotto si applica lo stesso').toBe(400);
    expect(db.scritture, 'senza elenco il lotto ha scritto sul database').toEqual([]);
    expect(db.lavoro.status, 'senza elenco il lavoro non è più «pronto»').toBe('ready');
  });

  it('con productIds [p1], su un lavoro con p1 e p2: scrive solo p1', async () => {
    const res = await POST(richiesta({ jobId: 'job-1', productIds: ['p1'] }));
    expect(res.status).toBe(200);
    const prodotti = db.scritture.filter((s) => s.tabella === 'products');
    expect(prodotti.map((s) => s.id), 'il lotto ha scritto un prodotto che il negoziante non ha scelto').toEqual(['p1']);
    expect(prodotti.every((s) => s.tipo === 'update')).toBe(true);
  });
});
