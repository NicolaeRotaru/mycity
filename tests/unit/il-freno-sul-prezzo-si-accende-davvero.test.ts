import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 22/8/2026 — IL FRENO SUL PREZZO ESISTEVA, ERA PROVATO, E NON SI ACCENDEVA MAI.
 *
 * `resolveAiPatch` rifiuta un prezzo proposto dall'AI che si scosta di piu' del
 * 30% da quello attuale: una scheda da 20 euro non diventa da 2 perche' il
 * modello ha capito male l'unita' di misura.
 *
 * Solo che il prezzo attuale non arrivava fin li'. La rotta costruiva l'oggetto
 * `current` con attributi, categoria e varianti — e senza `price`. Dentro la
 * funzione quel valore era zero, e con zero il confronto «scostamento oltre il
 * 30%» non scatta mai: qualunque prezzo passava.
 *
 * LA PROVA CHE C'ERA NON POTEVA ACCORGERSENE. Chiamava la libreria passandole
 * il prezzo, cioe' provava una cosa che nella realta' non succedeva. Questa
 * chiama la ROTTA, che e' il punto in cui il difetto viveva: e' rossa sul
 * codice di ieri e verde su quello di oggi.
 */

const aggiornamenti: Array<Record<string, unknown>> = [];

const PRODOTTO = {
  id: 'p1',
  seller_id: 'venditore-1',
  name: 'Cesto di pane',
  description: 'Pane misto',
  price: 20,
  compare_at_price: null,
  unit: null,
  condition: null,
  stock: 5,
  status: 'available',
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
      // categorie
      return { select: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) };
    },
  }),
}));

function richiesta(patch: Record<string, unknown>): Request {
  return new Request('http://localhost/api/ai/catalog-apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: 'p1', patch }),
  });
}

async function applica(patch: Record<string, unknown>) {
  const { POST } = await import('@/app/api/ai/catalog-apply/route');
  return (POST as unknown as (req: Request) => Promise<Response>)(richiesta(patch));
}

beforeEach(() => {
  aggiornamenti.length = 0;
  vi.resetModules();
});

describe('il freno sul prezzo, dalla rotta', () => {
  it('un prezzo che crolla da 20 a 2 euro NON viene scritto', async () => {
    await applica({ price: 2 });
    const conPrezzo = aggiornamenti.filter((u) => 'price' in u);
    expect(conPrezzo, 'il prezzo assurdo e stato scritto sul prodotto').toEqual([]);
  });

  it('un ritocco dentro il 30% passa: il freno non blocca il lavoro normale', async () => {
    await applica({ price: 22 });
    const scritto = aggiornamenti.find((u) => 'price' in u);
    expect(scritto?.price).toBe(22);
  });

  it('un prezzo che raddoppia NON viene scritto', async () => {
    await applica({ price: 40 });
    expect(aggiornamenti.filter((u) => 'price' in u)).toEqual([]);
  });
});
