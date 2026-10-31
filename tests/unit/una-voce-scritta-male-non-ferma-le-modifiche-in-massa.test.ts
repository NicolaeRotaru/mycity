import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 16/10/2026 — UNA VOCE SCRITTA MALE FACEVA CADERE LE ROTTE CHE APPLICANO IN MASSA.
 *
 * `{"toString": null}` e' JSON valido. Messo in un tag, fra le voci da togliere
 * o come valore di un allergene, `String(...)` lancia «Cannot convert object to
 * primitive value». La chat Assistenza era protetta (la sua rotta legge la
 * proposta con `propostaPerLaChat`), le altre strade no:
 *  - il Copilot in blocco (`catalog-apply-bulk`) rispondeva 500 per tutte le
 *    modifiche, anche quelle buone;
 *  - il lavoro massivo (`catalog-batch/apply`) scriveva i prodotti prima di
 *    quello rotto e poi cadeva: il lavoro non risultava mai applicato, e ogni
 *    nuovo tentativo cadeva sullo stesso prodotto;
 *  - la lettura dei risultati del lavoro (`parseCatalogBatchEntry`) cadeva,
 *    e il lavoro restava «in corso» per sempre.
 *
 * Adesso la proposta si legge in un modo solo, da tutte le strade: una voce
 * che non si sa scrivere come testo sparisce, e non fa cadere niente.
 */

const db = vi.hoisted(() => ({
  prodotti: [] as Record<string, unknown>[],
  categorie: [
    { id: 'alim', name: 'Alimentari', slug: 'alimentari', parent_id: null },
    { id: 'pane', name: 'Pane e forno', slug: 'pane-e-forno', parent_id: 'alim' },
    { id: 'casa', name: 'Casa', slug: 'casa', parent_id: null },
  ] as Record<string, unknown>[],
  lavoro: null as Record<string, unknown> | null,
  lavoroApplicato: 0,
  scritture: [] as { id: unknown; valori: Record<string, unknown> }[],
}));

// 31/10/2026 — La rotta ora legge l'interruttore spento al lancio: qui si
// prova la funzione accesa, come prima.
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
vi.mock('@/lib/audit', () => ({ writeAudit: async () => undefined }));
vi.mock('@/lib/ai/moderation', () => ({ classifyProductPolicy: async () => ({ allowed: true }) }));
vi.mock('@/lib/supabase/server', async () => {
  const { fintoCatalogo } = await import('./aiuti/finto-catalogo');
  return fintoCatalogo(db);
});

import { pianoPatchPerIlModulo, resolveAiPatch, type AiProductPatch, type CategoryRow } from '@/lib/products/aiPatch';
import { parseCatalogBatchEntry, senzaCampiEconomici } from '@/lib/ai/catalogBatch';
import { avvisoSullaPubblicazione } from '@/lib/products/prontoPerLaVendita';

const CATEGORIE = db.categorie as unknown as CategoryRow[];

/** Una voce come arriva da un JSON: un oggetto col suo `toString` rotto. */
const rotta = (): unknown => JSON.parse('{"toString":null}');

/** Dove una voce scritta male puo' stare in una proposta. */
const PROPOSTE_ROTTE: { dove: string; patch: () => AiProductPatch }[] = [
  { dove: 'un tag', patch: () => ({ tags: [rotta()] }) as unknown as AiProductPatch },
  { dove: 'una voce da togliere', patch: () => ({ attributes_remove: [rotta()] }) as unknown as AiProductPatch },
  { dove: 'il valore di un allergene', patch: () => ({ attributes: { allergeni: rotta() } }) as unknown as AiProductPatch },
  { dove: 'il valore della marca', patch: () => ({ attributes: { marca: rotta() } }) as unknown as AiProductPatch },
  { dove: 'la condizione', patch: () => ({ condition: rotta() }) as unknown as AiProductPatch },
  {
    dove: 'la sottocategoria',
    patch: () => ({ category_slug: 'alimentari', subcategory_name: rotta() }) as unknown as AiProductPatch,
  },
];

const RIGA = {
  seller_id: 'negozio-1',
  description: 'Una descrizione lunga abbastanza.',
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
  attributes: { allergeni: 'Glutine', ingredienti: 'farina' },
};

describe('le funzioni che leggono la proposta non cadono', () => {
  it.each(PROPOSTE_ROTTE)('$dove: il server non cade e non scrive la voce rotta', ({ patch }) => {
    const r = resolveAiPatch({
      patch: { name: 'Focaccia alta', ...patch() },
      current: { attributes: RIGA.attributes, category_id: 'pane', has_variants: false, price: 3.5 },
      categories: CATEGORIE,
    });
    expect(r.update.name).toBe('Focaccia alta');
    // Una voce illeggibile non svuota i tag e non cancella la condizione.
    expect(r.update).not.toHaveProperty('tags');
    expect(r.update).not.toHaveProperty('condition');
  });

  it.each(PROPOSTE_ROTTE)('$dove: il modulo non cade', ({ patch }) => {
    const p = pianoPatchPerIlModulo(
      { name: 'Focaccia alta', ...patch() },
      { prezzoAttuale: 3.5, categorie: CATEGORIE, categoriaAttuale: 'pane', modo: 'edit' },
    );
    expect(p.cambiati).toContain('nome');
    expect(p.scritture.map((s) => s.campo)).not.toContain('tags');
    expect(p.scritture.map((s) => s.campo)).not.toContain('condition');
  });

  it('una voce rotta in mezzo a voci buone: le buone restano', () => {
    const r = resolveAiPatch({
      patch: { tags: ['Forno', rotta(), 'focaccia'], attributes_remove: [rotta(), 'confezione'] } as unknown as AiProductPatch,
      current: { attributes: { ...RIGA.attributes, confezione: 'busta' }, category_id: 'pane', has_variants: false, price: 3.5 },
      categories: CATEGORIE,
    });
    expect(r.update.tags).toEqual(['forno', 'focaccia']);
    expect(r.update.attributes).toEqual(RIGA.attributes);
  });

  it('la sottocategoria scritta male non ferma lo spostamento nella categoria', () => {
    const r = resolveAiPatch({
      patch: { category_slug: 'alimentari', subcategory_name: rotta() } as unknown as AiProductPatch,
      current: { attributes: {}, category_id: 'casa', has_variants: false, price: 3.5 },
      categories: CATEGORIE,
    });
    expect(r.update.category_id).toBe('alim');
  });

  it.each(PROPOSTE_ROTTE)('$dove: la scheda della proposta nella chat non cade', ({ patch }) => {
    const prodotto = {
      name: 'Focaccia',
      description: RIGA.description,
      price: 3.5,
      categorySlug: 'alimentari',
      attributes: RIGA.attributes,
      image: 'https://mycity.test/foto.jpg',
      status: 'available',
    };
    expect(() => avvisoSullaPubblicazione(prodotto, patch())).not.toThrow();
    // Una categoria scritta male non sposta niente: la scheda tace, come il server.
    expect(avvisoSullaPubblicazione(prodotto, { category_slug: rotta() } as unknown as AiProductPatch)).toBeNull();
  });

  it.each(PROPOSTE_ROTTE)('$dove: la lettura dei risultati del lavoro massivo non cade', ({ patch }) => {
    expect(() => senzaCampiEconomici(patch() as Record<string, unknown>)).not.toThrow();
    const letto = parseCatalogBatchEntry('improve', {
      customId: 'p1',
      status: 'succeeded',
      toolInput: { patch: patch(), summary: 'ok' },
    });
    expect(letto.product_id).toBe('p1');
  });
});

async function chiama(rotta: string, url: string, corpo: unknown) {
  const { POST } = (await import(rotta)) as unknown as { POST: (r: Request) => Promise<Response> };
  const res = await POST(
    new Request(`http://localhost${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    }),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('le rotte vere che applicano in massa', () => {
  beforeEach(() => {
    db.prodotti = ['p1', 'p2', 'p3'].map((id) => ({ ...RIGA, id, name: `Prodotto ${id}` }));
    db.scritture = [];
    db.lavoroApplicato = 0;
  });

  it('il Copilot in blocco: le modifiche buone si applicano, quella con la voce rotta scrive solo il resto', async () => {
    const { status, json } = await chiama('@/app/api/ai/catalog-apply-bulk/route', '/api/ai/catalog-apply-bulk', {
      changes: [
        { productId: 'p1', patch: { name: 'Focaccia alta' } },
        { productId: 'p2', patch: { name: 'Focaccia bassa', tags: [rotta()], attributes: { allergeni: rotta() } } },
        { productId: 'p3', patch: { name: 'Focaccia al sale', attributes_remove: [rotta()], condition: rotta() } },
      ],
    });
    expect(status).toBe(200);
    expect(json.applied).toBe(3);
    expect(db.scritture.map((s) => s.id)).toEqual(['p1', 'p2', 'p3']);
    expect(db.scritture[1].valori).toEqual({ name: 'Focaccia bassa' });
    expect(db.scritture[2].valori).toEqual({ name: 'Focaccia al sale' });
  });

  it('il lavoro massivo: scrive tutti i prodotti e si segna applicato, anche con una voce rotta in mezzo', async () => {
    db.lavoro = {
      id: 'lavoro-1',
      seller_id: 'negozio-1',
      operation: 'improve',
      status: 'ready',
      results: [
        { product_id: 'p1', patch: { name: 'Focaccia alta' } },
        { product_id: 'p2', patch: { name: 'Focaccia bassa', tags: [rotta()] } },
        { product_id: 'p3', patch: { name: 'Focaccia al sale', condition: rotta() } },
      ],
    };
    const { status, json } = await chiama('@/app/api/ai/catalog-batch/apply/route', '/api/ai/catalog-batch/apply', {
      jobId: 'lavoro-1',
    });
    expect(status).toBe(200);
    expect(json.applied).toBe(3);
    expect(db.scritture.map((s) => s.id)).toEqual(['p1', 'p2', 'p3']);
    expect(db.lavoroApplicato, 'il lavoro resta «non applicato» e si ritenta all infinito').toBe(1);
  });
});
