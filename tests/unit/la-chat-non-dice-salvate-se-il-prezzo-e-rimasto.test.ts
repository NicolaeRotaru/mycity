import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 1/11/2026 — «MODIFICHE SALVATE», E IL PREZZO ERA QUELLO VECCHIO.
 *
 * Il negoziante chiede in chat di portare il cesto da 20 a 30 euro (+50%). Il
 * freno del 30% non lo scrive, giustamente. Ma la rotta rispondeva «nessuna
 * modifica valida» (se era l'unica modifica) o `ok: true` con il motivo
 * affogato in `changed`, e la chat diceva «Modifiche salvate sul prodotto».
 * Ora la rotta restituisce a parte i campi rifiutati, e la chat lo dice.
 */

const aggiornamenti: Array<Record<string, unknown>> = [];

const PRODOTTO = {
  id: 'p1',
  seller_id: 'venditore-1',
  name: 'Cesto di pane',
  description: 'Pane misto del giorno',
  price: 20,
  compare_at_price: null,
  unit: null,
  condition: null,
  stock: 5,
  status: 'draft',
  category_id: null,
  images: [],
  attributes: {},
  tags: [],
  has_variants: false,
};

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai/moderation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/moderation')>();
  return { ...actual, classifyProductPolicy: async () => ({ allowed: true, reason: '' }) };
});
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'venditore-1' }, req }),
}));
vi.mock('@/lib/supabase/server', () => ({
  getAdminSupabase: () => ({
    from: (tabella: string) => {
      if (tabella === 'products') {
        return {
          select: () => ({
            eq: () => ({
              single: () => Promise.resolve({ data: PRODOTTO, error: null }),
            }),
          }),
          update: (valori: Record<string, unknown>) => {
            aggiornamenti.push(valori);
            const esito = { data: { ...PRODOTTO, ...valori }, error: null };
            const passo: Record<string, unknown> = {
              eq: () => passo,
              select: () => passo,
              single: () => Promise.resolve(esito),
              then: (r: (x: unknown) => unknown) => Promise.resolve(esito).then(r),
            };
            return passo;
          },
        };
      }
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
  }),
}));

async function applica(patch: Record<string, unknown>) {
  const { POST } = await import('@/app/api/ai/catalog-apply/route');
  const res = await (POST as unknown as (req: Request) => Promise<Response>)(
    new Request('http://localhost/api/ai/catalog-apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ productId: 'p1', patch }),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

function campiRifiutati(x: unknown): string[] {
  return (Array.isArray(x) ? x : []).map((r) => String((r as { campo?: unknown }).campo));
}

beforeEach(() => {
  aggiornamenti.length = 0;
  vi.resetModules();
});

describe('un prezzo rifiutato dal freno si dice, non si dichiara salvato', () => {
  it('solo il prezzo +50%: niente scritto, e la risposta dice perche con rifiutati: price', async () => {
    const { status, json } = await applica({ price: 30 });
    expect(aggiornamenti.filter((u) => 'price' in u)).toEqual([]);
    expect(status).toBe(400);
    const errore = json.error as { message: string; details?: { rifiutati?: unknown } };
    expect(errore.message).toContain('prezzo NON applicato');
    expect(campiRifiutati(errore.details?.rifiutati)).toContain('price');
  });

  it('prezzo +50% insieme a un nome nuovo: il nome entra, il prezzo torna in rifiutati e la chat non dice «salvate»', async () => {
    const { status, json } = await applica({ price: 30, name: 'Cesto di pane misto' });
    expect(status).toBe(200);
    expect(campiRifiutati(json.rifiutati)).toEqual(['price']);
    expect(aggiornamenti.at(-1)).toEqual({ name: 'Cesto di pane misto' });
  });

  it('tutto dentro la banda: rifiutati vuoto e la chat dice «salvate»', async () => {
    const { json } = await applica({ price: 22 });
    expect(json.rifiutati).toEqual([]);
  });
});
