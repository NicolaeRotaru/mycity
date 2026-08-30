import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * 27/8/2026 (R157) — LA FUNZIONE PROMETTEVA IL MASSIVO E CONSEGNAVA IL SERIALE.
 *
 * Il Catalog Copilot prepara fino a duecento modifiche in una volta. La rotta
 * che le applicava ne accettava sessanta all'ora, UNA per chiamata, e ogni
 * chiamata rileggeva il prodotto, rileggeva tutte le categorie e — se toccava
 * nome o descrizione — faceva partire una chiamata al modello per il controllo
 * di conformita'. Il pannello le mandava in fila.
 *
 * Per il negoziante: «abbassa del 10% l'elettronica» su un catalogo grande
 * diventava un lavoro in tre riprese a un'ora di distanza, con una barra che
 * avanza una chiamata alla volta e un messaggio finale che diceva «applicato a
 * 60 prodotti su 200».
 *
 * Adesso e' un POST solo. Quello che NON deve cambiare — e queste prove lo
 * tengono fermo — e' che si scrive solo sui propri prodotti, che il patch passa
 * dalla validazione, e che una modifica bocciata dal filtro non si scrive.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) => (req: Request) =>
      h({ user: FAKE_USER, req }),
}));

const CATEGORIE = [{ id: 'el', name: 'Elettronica', slug: 'elettronica', parent_id: null }];
const PRODOTTI = Array.from({ length: 100 }, (_, i) => ({
  id: `p${i}`,
  seller_id: 'seller-1',
  name: `Prodotto ${i}`, description: 'x', price: 100, compare_at_price: null,
  unit: 'pezzo', condition: null, stock: 5, status: 'available', category_id: 'el',
  images: [], attributes: {}, tags: [], has_variants: false,
}));

const lettureProdotti = { count: 0 };
const scritture: { id: string; update: Record<string, unknown> }[] = [];

vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (table: string) => {
      if (table === 'categories') {
        return { select: () => ({ order: () => Promise.resolve({ data: CATEGORIE, error: null }) }) };
      }
      return {
        select: () => ({
          eq: () => ({
            in: (_c: string, ids: string[]) => {
              lettureProdotti.count += 1;
              return Promise.resolve({ data: PRODOTTI.filter((p) => ids.includes(p.id)), error: null });
            },
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

const verdettoFiltro = { allowed: true as boolean, reason: 'contenuto vietato' };
const filtroChiamato = vi.fn();
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return {
    ...actual,
    classifyProductPolicy: async (...a: unknown[]) => {
      filtroChiamato(...a);
      return verdettoFiltro.allowed
        ? { allowed: true }
        : { allowed: false, reason: verdettoFiltro.reason };
    },
  };
});
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn() },
}));

import { POST } from '@/app/api/ai/catalog-apply-bulk/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

function richiesta(changes: unknown[]): never {
  return new Request('http://localhost/api/ai/catalog-apply-bulk', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ changes }),
  }) as never;
}

describe('il copilot applica tutte le modifiche con una richiesta sola', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitBuckets();
    lettureProdotti.count = 0;
    scritture.length = 0;
    verdettoFiltro.allowed = true;
  });

  it('cento modifiche passano in un colpo, e i prodotti si leggono una volta sola', async () => {
    const changes = PRODOTTI.map((p) => ({ productId: p.id, patch: { stock: 3 } }));
    const res = await POST(richiesta(changes));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { applied: number; total: number };
    expect(
      json.applied,
      'le modifiche oltre la sessantesima si perdevano: il venditore doveva tornare un ora dopo',
    ).toBe(100);
    expect(json.total).toBe(100);
    expect(scritture).toHaveLength(100);
    expect(
      lettureProdotti.count,
      'ogni modifica rileggeva il prodotto e tutte le categorie: cento modifiche, duecento letture',
    ).toBe(1);
  });

  it('un prodotto che non e del venditore non si tocca', async () => {
    const res = await POST(
      richiesta([
        { productId: 'p0', patch: { stock: 1 } },
        { productId: 'di-un-altro-negozio', patch: { stock: 1 } },
      ]),
    );
    const json = (await res.json()) as { applied: number; results: { productId: string; ok: boolean }[] };
    expect(json.applied).toBe(1);
    expect(scritture.map((s) => s.id)).toEqual(['p0']);
    expect(json.results.find((r) => r.productId === 'di-un-altro-negozio')?.ok).toBe(false);
  });

  it('una modifica bocciata dal filtro non si scrive', async () => {
    verdettoFiltro.allowed = false;
    const res = await POST(
      richiesta([{ productId: 'p0', patch: { name: 'coltello a serramanico da combattimento' } }]),
    );
    const json = (await res.json()) as { applied: number; results: { motivo?: string }[] };
    expect(filtroChiamato).toHaveBeenCalledTimes(1);
    expect(json.applied).toBe(0);
    expect(scritture, 'il filtro ha detto no e la modifica e finita in vetrina lo stesso').toHaveLength(0);
  });

  it('il filtro gira solo su chi tocca nome o descrizione', async () => {
    await POST(
      richiesta([
        { productId: 'p0', patch: { stock: 2 } },
        { productId: 'p1', patch: { description: 'una descrizione nuova' } },
      ]),
    );
    expect(filtroChiamato).toHaveBeenCalledTimes(1);
    expect(scritture).toHaveLength(2);
  });

  it('il freno sul prezzo resta acceso anche qui', async () => {
    // `resolveAiPatch` rifiuta un prezzo che si scosta di piu' del 30% da
    // quello attuale: il prodotto costa 100, il copilot propone 10.
    const res = await POST(richiesta([{ productId: 'p0', patch: { price: 10 } }]));
    const json = (await res.json()) as { applied: number };
    expect(json.applied, 'un prezzo assurdo e passato: il freno del 30% non ha guardato qui').toBe(0);
    expect(scritture).toHaveLength(0);
  });
});
