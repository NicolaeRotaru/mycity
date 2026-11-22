import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * (Giro di correzione) Con 5 controlli in volo, 200 voci sono 40 giri: a 8 s l'uno sforavano i 120 s
 * delle rotte app/api/ai/** (504, niente scritto, controlli pagati). Ora la rotta finisce entro i
 * 120 s e dice quali voci sono rimaste fuori. Il testo che segue e' il vecchio commento.
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
const PRODOTTI = Array.from({ length: 200 }, (_, i) => ({
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
    // Un fornitore lento: 8 secondi a controllo (orologio finto).
    classifyProductPolicy: async () => {
      stato.inVolo += 1;
      stato.massimo = Math.max(stato.massimo, stato.inVolo);
      await new Promise((r) => setTimeout(r, 8_000));
      stato.inVolo -= 1;
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

describe('200 controlli lenti di conformita finiscono entro i 120 secondi della rotta', () => {
  beforeEach(() => {
    __resetRateLimitBuckets();
    scritture.length = 0;
    stato.inVolo = 0;
    stato.massimo = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('la rotta risponde prima dei 120 s, scrive chi ha passato il controllo e dice chi e rimasto fuori', async () => {
    const changes = PRODOTTI.map((p, i) => ({ productId: p.id, patch: { name: `Nuovo ${i}` } }));
    const partenza = Date.now();
    let json: {
      applied: number;
      rimaste?: string[];
      results: { productId: string; ok: boolean; motivo?: string }[];
    } | null = null;
    const p = POST(
      new Request('http://localhost/api/ai/catalog-apply-bulk', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ changes }),
      }) as never,
    ).then(async (res) => { json = await res.json(); });
    let fine = 0;
    void p.then(() => { fine = Date.now() - partenza; });
    await vi.advanceTimersByTimeAsync(400_000);
    await p;
    expect(json).not.toBeNull();
    expect(fine, 'prima: 40 giri da 8 s = 320 s, oltre i 120 della rotta').toBeLessThan(110_000);
    const r = json!;
    expect(r.rimaste && r.rimaste.length).toBeGreaterThan(0);
    expect(r.applied + r.rimaste!.length).toBe(200);
    for (const id of r.rimaste!) {
      expect(scritture).not.toContain(id);
      expect(r.results.find((x) => x.productId === id)?.ok).toBe(false);
    }
    expect(scritture).toHaveLength(r.applied);
    expect(stato.massimo).toBeLessThanOrEqual(5);
  });
});
