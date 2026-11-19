import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * R03-003 — LA LETTURA DA FOTO AMMETTE UN PRODOTTO SOLO CON UN SÌ SCRITTO BENE.
 *
 * La lettura di più prodotti (extract-products) marcava ammesso ogni prodotto
 * con `policy_ok !== false`: un «"false"» scritto dal modello come testo, o il
 * campo mancante, diventavano policy_ok true e il prodotto vietato arrivava al
 * modulo come pubblicabile. Ora vale la regola di extract-product (R03-008
 * dell'onda 9): passa solo il booleano true. Qui si fissano tutte e due.
 */

const FAKE_USER = { id: 'seller-1', email: 's@x.com' };
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth: (handler: (ctx: { user: typeof FAKE_USER; req: Request }) => unknown) =>
    (req: Request) => handler({ user: FAKE_USER, req }),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), spesa: vi.fn(), debug: vi.fn() },
}));

const CATEGORIES = [{ id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null }];
vi.mock('@/lib/supabase/server', () => ({
  // extract-products: le categorie in una lettura sola.
  getAdminSupabase: () => ({
    from: () => ({ select: () => ({ order: () => Promise.resolve({ data: CATEGORIES, error: null }) }) }),
  }),
  // extract-product: la categoria di primo livello per slug.
  getServerSupabase: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ single: () => Promise.resolve({ data: { id: 'cat-1' }, error: null }) }) }) }),
    }),
  })),
}));

const runMessageMock = vi.fn();
vi.mock('@/lib/ai/run', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/ai/run')>();
  return { ...actual, runMessage: (...a: unknown[]) => runMessageMock(...a) };
});

import { POST as leggiPiuProdotti } from '@/app/api/vision/extract-products/route';
import { POST as leggiUnProdotto } from '@/app/api/vision/extract-product/route';
import { __resetRateLimitBuckets } from '@/lib/rate-limit';

const JPEG_VERO = '/9j/4AAQSkZJRgABAQAAAQABAAA=';
const IMG = { image_base64: JPEG_VERO, media_type: 'image/jpeg' as const };

function richiesta(url: string, corpo: unknown): never {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  }) as never;
}

const SENZA = Symbol('campo assente');

/** Cosa diventa policy_ok in uscita da extract-products per un valore del modello. */
async function policyInUscita(valore: unknown): Promise<unknown> {
  const prodotto: Record<string, unknown> = {
    image_indexes: [0, 1],
    name: 'Coltello a serramanico',
    category_slug: 'casa',
    suggested_price_eur: 25,
    policy_reason: 'arma bianca',
  };
  if (valore !== SENZA) prodotto.policy_ok = valore;
  runMessageMock.mockResolvedValue({ toolInput: { products: [prodotto] } });
  const res = await leggiPiuProdotti(richiesta('/api/vision/extract-products', { images: [IMG, IMG] }));
  expect(res.status).toBe(200);
  const json = (await res.json()) as { products: Array<{ policy_ok: unknown }> };
  expect(json.products).toHaveLength(1);
  return json.products[0].policy_ok;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimitBuckets();
  vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
});

describe('extract-products: policy_ok vero solo col booleano true', () => {
  const NON_AMMESSI: Array<[string, unknown]> = [
    ['"false"', 'false'],
    ['"False"', 'False'],
    ['" false "', ' false '],
    ['"no"', 'no'],
    ['"0"', '0'],
    ['0', 0],
    ['null', null],
    ['campo assente', SENZA],
    ['"true" scritto come testo', 'true'],
  ];

  for (const [nome, valore] of NON_AMMESSI) {
    it(`policy_ok ${nome} → il prodotto esce non ammesso`, async () => {
      expect(await policyInUscita(valore)).toBe(false);
    });
  }

  it('controprova: policy_ok true → ammesso', async () => {
    expect(await policyInUscita(true)).toBe(true);
  });

  it('controprova: policy_ok false (booleano) → non ammesso, col motivo', async () => {
    runMessageMock.mockResolvedValue({
      toolInput: {
        products: [
          { image_indexes: [0], name: 'Coltello', category_slug: 'casa', suggested_price_eur: 3, policy_ok: false, policy_reason: 'arma' },
        ],
      },
    });
    const res = await leggiPiuProdotti(richiesta('/api/vision/extract-products', { images: [IMG, IMG] }));
    const json = (await res.json()) as { products: Array<{ policy_ok: unknown; policy_reason: unknown }> };
    expect(json.products[0]).toMatchObject({ policy_ok: false, policy_reason: 'arma' });
  });
});

describe('extract-product: la regola dell\'onda 9 resta', () => {
  const LETTURA = {
    name: 'Coltello a serramanico', description: 'Lama 12 cm', category_slug: 'casa', suggested_price_eur: 25,
    image_quality: { score: 0.9, issues: [] }, alt_text: 'Coltello', confidence: 0.95,
  };

  for (const [nome, valore] of [['"False"', 'False'], ['"no"', 'no'], ['0', 0], ['null', null]] as Array<[string, unknown]>) {
    it(`policy_ok ${nome}: 400, il prodotto non passa`, async () => {
      runMessageMock.mockResolvedValue({ toolInput: { ...LETTURA, policy_ok: valore, policy_reason: 'arma bianca' } });
      const res = await leggiUnProdotto(richiesta('/api/vision/extract-product', IMG));
      expect(res.status).toBe(400);
    });
  }

  it('controprova: policy_ok true passa', async () => {
    runMessageMock.mockResolvedValue({ toolInput: { ...LETTURA, name: 'Sedia', policy_ok: true } });
    const res = await leggiUnProdotto(richiesta('/api/vision/extract-product', IMG));
    expect(res.status).toBe(200);
  });
});
