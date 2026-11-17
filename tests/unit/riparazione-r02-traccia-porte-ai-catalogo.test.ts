import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * La traccia «chi ha cambiato cosa» delle altre due porte dell'AI sul catalogo
 * (il Copilot in blocco e il lavoro massivo) si scriveva a mano nella forma
 * vecchia: tutte le chiavi mandate, anche quelle rimaste uguali, e nessun
 * `daAi`. La chat (catalog-apply) e il modulo del prodotto usano
 * `tracciaDellaModifica`: solo i campi cambiati, con `daAi`. Qui girano le
 * rotte VERE con un database finto, e si guarda la voce mandata al registro.
 */

const db = vi.hoisted(() => ({
  prodotti: [] as Record<string, unknown>[],
  categorie: [{ id: 'pane', name: 'Pane', slug: 'pane', parent_id: null }] as Record<string, unknown>[],
  lavoro: null as Record<string, unknown> | null,
  lavoroApplicato: 0,
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
  audit: [] as Array<{ action?: string; metadata: Record<string, unknown> }>,
}));

vi.mock('@/lib/funzioni-al-lancio', async (originale) => ({
  ...((await originale()) as Record<string, unknown>),
  AI_NEGOZI_ACCESA: true,
}));
vi.mock('@/lib/api/middleware', () => ({
  withSellerAuth:
    (h: (ctx: { user: { id: string }; req: Request }) => unknown) =>
    (req: Request) =>
      h({ user: { id: 'negozio-1' }, req }),
}));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), spesa: vi.fn() } }));
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (v: { action?: string; metadata: Record<string, unknown> }) => {
    db.audit.push(v);
  }),
}));
vi.mock('@/lib/ai/moderation', () => ({ classifyProductPolicy: async () => ({ allowed: true }) }));
vi.mock('@/lib/supabase/server', async () => {
  const { fintoCatalogo } = await import('./aiuti/finto-catalogo');
  return fintoCatalogo(db);
});

const DESCRIZIONE = 'Focaccia del forno, cotta ogni mattina.';
const RIGA = {
  id: 'p1',
  seller_id: 'negozio-1',
  name: 'Focaccia',
  description: DESCRIZIONE,
  price: 3.5,
  compare_at_price: null,
  unit: 'pezzo',
  condition: 'nuovo',
  stock: 3,
  status: 'available',
  images: ['https://mycity.test/foto.jpg'],
  tags: ['forno'],
  has_variants: false,
  category_id: 'pane',
  attributes: {},
};

async function chiama(rotta: string, url: string, corpo: unknown) {
  const { POST } = (await import(rotta)) as unknown as { POST: (r: Request) => Promise<Response> };
  const res = await POST(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  return res.status;
}

/** Aspetta che le scritture del registro, lanciate senza await, siano partite. */
const unGiro = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  db.prodotti = [{ ...RIGA }];
  db.scritture = [];
  db.audit = [];
  db.lavoro = null;
  db.lavoroApplicato = 0;
});

describe('le altre due porte dell’AI sul catalogo scrivono la traccia nella forma nuova', () => {
  it('il Copilot in blocco: solo i campi cambiati, e daAi', async () => {
    const status = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [{ productId: 'p1', patch: { name: 'Focaccia alta', description: DESCRIZIONE } }],
    });
    expect(status).toBe(200);
    await unGiro();
    expect(db.audit).toHaveLength(1);
    const m = db.audit[0].metadata;
    expect(m.origine).toBe('ai-copilot-bulk');
    expect(m.daAi, 'la traccia del Copilot in blocco non dice cosa ha proposto l’AI').toEqual(['name']);
    expect(m.campi, 'la descrizione non è cambiata ma risulta modificata').toEqual(['name']);
    expect(m.prima).toEqual({ name: 'Focaccia' });
    expect(m.dopo).toEqual({ name: 'Focaccia alta' });
  });

  it('il lavoro massivo: solo i campi cambiati, e daAi', async () => {
    db.lavoro = {
      id: 'lavoro-1',
      seller_id: 'negozio-1',
      operation: 'improve',
      status: 'ready',
      results: [{ product_id: 'p1', patch: { name: 'Focaccia alta', description: DESCRIZIONE } }],
    };
    const status = await chiama('@/app/api/ai/catalog-batch/apply/route', '/api/ai/catalog-batch/apply', {
      jobId: 'lavoro-1',
      productIds: ['p1'],
    });
    expect(status).toBe(200);
    await unGiro();
    const voci = db.audit.filter((v) => v.action === 'product.update');
    expect(voci).toHaveLength(1);
    const m = voci[0].metadata;
    expect(m.origine).toBe('ai-batch:improve');
    expect(m.daAi, 'la traccia del lavoro massivo non dice cosa ha proposto l’AI').toEqual(['name']);
    expect(m.campi, 'la descrizione non è cambiata ma risulta modificata').toEqual(['name']);
    expect(m.prima).toEqual({ name: 'Focaccia' });
    expect(m.dopo).toEqual({ name: 'Focaccia alta' });
  });
});
