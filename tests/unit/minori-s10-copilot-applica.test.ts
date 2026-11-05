import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * S10 (5/11/2026) — «Applica tutte» del Copilot: una lettura caduta non apre
 * il controllo (1702), due voci sullo stesso prodotto non passano insieme (1703).
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const CATEGORIE = [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }];
const PRODOTTO = {
  id: 'p1', seller_id: 'seller-1', name: 'Lampada', description: 'x', price: 100, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'el',
  images: [], attributes: {}, tags: [], has_variants: false,
};

const stato = { erroreCategorie: null as null | { message: string }, erroreProdotti: null as null | { message: string } };
const scritture: { id: string; update: Record<string, unknown> }[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'categories') {
        return {
          select: () => ({
            order: () =>
              Promise.resolve(stato.erroreCategorie ? { data: null, error: stato.erroreCategorie } : { data: CATEGORIE, error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            in: () =>
              Promise.resolve(stato.erroreProdotti ? { data: null, error: stato.erroreProdotti } : { data: [PRODOTTO], error: null }),
          }),
        }),
        update: (update: Record<string, unknown>) => ({
          eq: (_c1: string, id: string) => ({
            eq: () => {
              scritture.push({ id, update });
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
  }),
}));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, classifyProductPolicy: async () => ({ allowed: true }) };
});
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() } }));

import { POST } from '@/app/api/ai/catalog-apply-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const req = (changes: unknown) =>
  new Request('http://localhost/api/ai/catalog-apply-bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  }) as never;

beforeEach(() => {
  __resetRateLimitBuckets();
  scritture.length = 0;
  stato.erroreCategorie = null;
  stato.erroreProdotti = null;
});

describe('una lettura caduta non scrive niente (1702)', () => {
  it('categorie illeggibili → 503 e nessuna scrittura', async () => {
    stato.erroreCategorie = { message: 'timeout' };
    const res = await POST(req([{ productId: 'p1', patch: { name: 'Lampada LED' } }]));
    expect(res.status).toBe(503);
    expect(scritture).toHaveLength(0);
  });
  it('prodotti illeggibili → 503, non «non è un tuo prodotto»', async () => {
    stato.erroreProdotti = { message: 'timeout' };
    const res = await POST(req([{ productId: 'p1', patch: { name: 'Lampada LED' } }]));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/tuo prodotto/);
  });
});

describe('una sola modifica per prodotto (1703)', () => {
  it('la seconda voce sullo stesso prodotto si scarta e si dice perché', async () => {
    const res = await POST(
      req([
        { productId: 'p1', patch: { name: 'Lampada LED' } },
        { productId: 'p1', patch: { description: 'Descrizione nuova' } },
      ]),
    );
    const json = await res.json();
    expect(scritture).toHaveLength(1);
    expect(scritture[0].update).not.toHaveProperty('description');
    expect(JSON.stringify(json)).toMatch(/una sola modifica per prodotto/);
  });
});
