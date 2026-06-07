import { describe, it, expect } from 'vitest';
import {
  createProductSchema,
  buildProductPayload,
  normalizeCondition,
  type ProductFormValues,
} from '@/lib/products/schema';

describe('createProductSchema', () => {
  const schema = createProductSchema({ minDescription: 10 });
  const base = {
    name: 'Prodotto X',
    description: 'Descrizione lunga a sufficienza',
    price: 10,
    category_id: 'cat-1',
  };

  it('accetta un payload valido senza compareAtPrice', () => {
    expect(schema.safeParse({ ...base }).success).toBe(true);
  });

  it('rifiuta compareAtPrice minore o uguale al prezzo', () => {
    expect(schema.safeParse({ ...base, compareAtPrice: 10 }).success).toBe(false);
    expect(schema.safeParse({ ...base, compareAtPrice: 8 }).success).toBe(false);
  });

  it('accetta compareAtPrice maggiore del prezzo', () => {
    expect(schema.safeParse({ ...base, compareAtPrice: 15 }).success).toBe(true);
  });

  it('tratta compareAtPrice vuoto come assente', () => {
    const r = schema.safeParse({ ...base, compareAtPrice: '' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.compareAtPrice).toBeUndefined();
  });

  it('fa il coerce di price e stock da stringhe', () => {
    const r = schema.safeParse({ ...base, price: '12.50', stock: '3' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.price).toBe(12.5);
      expect(r.data.stock).toBe(3);
    }
  });

  it('rifiuta nome corto, descrizione corta, categoria mancante', () => {
    expect(schema.safeParse({ ...base, name: 'ab' }).success).toBe(false);
    expect(schema.safeParse({ ...base, description: 'corta' }).success).toBe(false);
    expect(schema.safeParse({ ...base, category_id: '' }).success).toBe(false);
  });

  it('applica il gate descrizione 30 in creazione', () => {
    const create = createProductSchema({ minDescription: 30 });
    expect(create.safeParse({ ...base, description: 'meno di trenta caratteri' }).success).toBe(false);
  });
});

describe('buildProductPayload', () => {
  const values: ProductFormValues = {
    name: '  X  ',
    description: '  descrizione lunga  ',
    price: 10,
    compareAtPrice: 15,
    stock: 4,
    category_id: 'c1',
  };

  it('mappa i campi e ripulisce nome/descrizione', () => {
    const p = buildProductPayload({
      values,
      imageUrls: ['u'],
      attributes: { a: 1 },
      unit: 'kg',
      condition: 'nuovo',
      tags: ['t'],
      expressEnabled: true,
      unlimitedStock: false,
      status: 'available',
    });
    expect(p.name).toBe('X');
    expect(p.description).toBe('descrizione lunga');
    expect(p.compare_at_price).toBe(15);
    expect(p.unit).toBe('kg');
    expect(p.condition).toBe('nuovo');
    expect(p.stock).toBe(4);
    expect(p.tags).toEqual(['t']);
    expect(p.express_enabled).toBe(true);
    expect(p.status).toBe('available');
  });

  it('stock illimitato → null; condizione vuota → null; express null', () => {
    const p = buildProductPayload({
      values,
      imageUrls: [],
      attributes: {},
      unit: 'pezzo',
      condition: '',
      tags: [],
      expressEnabled: null,
      unlimitedStock: true,
      status: 'draft',
    });
    expect(p.stock).toBeNull();
    expect(p.condition).toBeNull();
    expect(p.express_enabled).toBeNull();
    expect(p.status).toBe('draft');
  });

  it('compareAtPrice assente → null', () => {
    const p = buildProductPayload({
      values: { ...values, compareAtPrice: undefined },
      imageUrls: [],
      attributes: {},
      unit: 'pezzo',
      condition: '',
      tags: [],
      expressEnabled: null,
      unlimitedStock: false,
      status: 'available',
    });
    expect(p.compare_at_price).toBeNull();
  });
});

describe('normalizeCondition', () => {
  it('riconosce le condizioni note', () => {
    expect(normalizeCondition('Nuovo con etichetta')).toBe('nuovo');
    expect(normalizeCondition('Usato come nuovo')).toBe('usato');
    expect(normalizeCondition('Ricondizionato')).toBe('ricondizionato');
  });
  it('ritorna stringa vuota se non riconosciuta', () => {
    expect(normalizeCondition('boh')).toBe('');
    expect(normalizeCondition('')).toBe('');
  });
});
