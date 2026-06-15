import { describe, it, expect } from 'vitest';
import {
  buildCatalogBatchRequests,
  parseCatalogBatchEntry,
  isCatalogOperation,
  isSupportedLang,
  type CatalogOperation,
} from '@/lib/ai/catalogBatch';
import { MODELS } from '@/lib/ai/client';
import type { ProductRow } from '@/lib/products/aiSnapshot';
import type { CategoryRow } from '@/lib/products/aiPatch';
import type { BatchResultEntry } from '@/lib/ai/batch';

const CATEGORIES: CategoryRow[] = [{ id: 'casa-top', name: 'Casa', slug: 'casa', parent_id: null }];
const PRODUCTS: ProductRow[] = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Lampada', description: 'x', price: 10, compare_at_price: null, unit: 'pezzo', condition: null, stock: 1, status: 'available', category_id: 'casa-top', images: [], attributes: {}, tags: [], has_variants: false },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Sedia', description: 'y', price: 20, compare_at_price: null, unit: 'pezzo', condition: null, stock: 1, status: 'draft', category_id: 'casa-top', images: [], attributes: {}, tags: [], has_variants: false },
];

describe('buildCatalogBatchRequests', () => {
  it('una richiesta per prodotto, custom_id = id, modello fast', () => {
    const reqs = buildCatalogBatchRequests({ operation: 'improve', products: PRODUCTS, categories: CATEGORIES });
    expect(reqs).toHaveLength(2);
    expect(reqs.map((r) => r.custom_id)).toEqual([PRODUCTS[0].id, PRODUCTS[1].id]);
    expect(reqs[0].model).toBe(MODELS.fast);
    expect(reqs[0].tools?.[0].name).toBe('improve_one');
    expect(reqs[0].tool_choice).toMatchObject({ type: 'tool', name: 'improve_one' });
    // improve include lo schema categorie/attributi nel messaggio.
    expect(JSON.stringify(reqs[0].messages)).toContain('Categorie di primo livello');
  });

  it('translate: tool translate_one e lingua nel system', () => {
    const reqs = buildCatalogBatchRequests({ operation: 'translate', products: PRODUCTS, categories: CATEGORIES, targetLang: 'fr' });
    expect(reqs[0].tools?.[0].name).toBe('translate_one');
    expect(reqs[0].system).toContain('francese');
  });

  it('moderate: tool moderate_one', () => {
    const reqs = buildCatalogBatchRequests({ operation: 'moderate', products: PRODUCTS, categories: CATEGORIES });
    expect(reqs[0].tools?.[0].name).toBe('moderate_one');
  });
});

describe('parseCatalogBatchEntry', () => {
  const entry = (over: Partial<BatchResultEntry>): BatchResultEntry => ({
    customId: '11111111-1111-1111-1111-111111111111',
    status: 'succeeded',
    ...over,
  });

  it('improve riuscito → patch + summary', () => {
    const r = parseCatalogBatchEntry('improve', entry({ toolInput: { patch: { name: 'Lampada LED' }, summary: 'ok' } }));
    expect(r).toMatchObject({ product_id: '11111111-1111-1111-1111-111111111111', summary: 'ok' });
    expect(r.patch).toEqual({ name: 'Lampada LED' });
  });

  it('moderate riuscito → flagged + reason', () => {
    const r = parseCatalogBatchEntry('moderate', entry({ toolInput: { flagged: true, reason: 'arma' } }));
    expect(r).toMatchObject({ flagged: true, reason: 'arma' });
    expect(r.patch).toBeUndefined();
  });

  it('entry fallita → error', () => {
    const r = parseCatalogBatchEntry('improve', entry({ status: 'errored', errorType: 'overloaded_error' }));
    expect(r.error).toBe('overloaded_error');
    expect(r.patch).toBeUndefined();
  });
});

describe('guard', () => {
  it('isCatalogOperation', () => {
    expect(isCatalogOperation('improve')).toBe(true);
    expect(isCatalogOperation('nope')).toBe(false);
    (['improve', 'redescribe', 'moderate', 'translate'] satisfies CatalogOperation[]).forEach((o) =>
      expect(isCatalogOperation(o)).toBe(true),
    );
  });
  it('isSupportedLang', () => {
    expect(isSupportedLang('fr')).toBe(true);
    expect(isSupportedLang('xx')).toBe(false);
  });
});
