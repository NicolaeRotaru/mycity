import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Il copilot in blocco manda al filtro di conformita' fino a 200 prodotti: prima
 * partivano tutti insieme (un 429 era probabile e i prodotti restavano fermi).
 * Ora i controlli in volo sono pochi, e il risultato per prodotto non cambia.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({ ...((await originale()) as Record<string, unknown>), AI_NEGOZI_ACCESA: true }));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const CATEGORIE = [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }];
const PRODOTTI = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i}`,
  seller_id: 'seller-1',
  name: `Prodotto ${i}`, description: 'x', price: 100, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'el',
  images: [], attributes: {}, tags: [], has_variants: false,
}));
const scritture: string[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'categories') {
        return { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            in: (_c: string, ids: string[]) =>
              Promise.resolve({ data: PRODOTTI.filter((p) => ids.includes(p.id)), error: null }),
          }),
        }),
        update: () => ({
          eq: (_c1: string, id: string) => ({
            eq: () => {
              scritture.push(id);
              return Promise.resolve({ error: null });
            },
          }),
        }),
      };
    },
  }),
}));

const stato = { inVolo: 0, massimo: 0 };
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return {
    ...actual,
    // Un moderatore finto: conta le chiamate in volo e risponde dopo un attimo.
    classifyProductPolicy: async (p: { name: string }) => {
      stato.inVolo += 1;
      stato.massimo = Math.max(stato.massimo, stato.inVolo);
      await new Promise((r) => setTimeout(r, 1));
      stato.inVolo -= 1;
      if (p.name === 'Nuovo 7') return { allowed: false, reason: 'vietato' };
      if (p.name === 'Nuovo 9') throw new Error('429');
      return { allowed: true };
    },
  };
});
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() },
}));

import { POST } from '@/app/api/ai/catalog-apply-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

describe('i controlli di conformita del copilot in blocco hanno un tetto', () => {
  beforeEach(() => {
    __resetRateLimitBuckets();
    scritture.length = 0;
    stato.inVolo = 0;
    stato.massimo = 0;
  });

  it('con 60 nomi cambiati ne partono al massimo 5 insieme, e ogni verdetto va al suo prodotto', async () => {
    const changes = PRODOTTI.map((p, i) => ({ productId: p.id, patch: { name: `Nuovo ${i}` } }));
    const res = await POST(
      new Request('http://localhost/api/ai/catalog-apply-bulk', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes }),
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      applied: number;
      results: { productId: string; ok: boolean; motivo?: string }[];
    };
    // Giro di correzione (22/11): il tetto e' 5, non «al massimo 8». Con 60 voci il gruppo
    // si riempie: in volo ce ne sono esattamente 5, ne' 6 ne' 8 (prima partivano tutti e 60).
    expect(changes.length).toBeGreaterThan(5);
    expect(stato.massimo, 'prima partivano tutti e 60 insieme').toBe(5);
    expect(json.applied).toBe(58);
    expect(scritture).not.toContain('p7');
    expect(scritture).not.toContain('p9');
    expect(json.results.find((r) => r.productId === 'p7')?.motivo).toBe('vietato');
    expect(json.results.find((r) => r.productId === 'p9')?.motivo).toBe(
      'controllo di conformita non riuscito',
    );
  });
});
