import { describe, it, expect } from 'vitest';
import {
  CATEGORY_ATTRIBUTES,
  findLabelForKey,
  formatAttributeValue,
  getAttributesForCategory,
} from '@/lib/category-attributes';

describe('CATEGORY_ATTRIBUTES schema', () => {
  it('has 8 top-level categories', () => {
    expect(Object.keys(CATEGORY_ATTRIBUTES)).toEqual(
      expect.arrayContaining(['alimentari', 'abbigliamento', 'casa', 'elettronica', 'libri', 'giardino', 'bellezza', 'sport']),
    );
  });

  it('each category has at least 3 fields', () => {
    for (const [slug, fields] of Object.entries(CATEGORY_ATTRIBUTES)) {
      expect(fields.length).toBeGreaterThanOrEqual(3);
      expect(fields[0]).toHaveProperty('key');
      expect(fields[0]).toHaveProperty('label');
      expect(fields[0]).toHaveProperty('type');
      // Verifica slug usato
      expect(slug).toBeTruthy();
    }
  });

  it('each field has valid type', () => {
    const validTypes = ['text', 'textarea', 'number', 'select', 'checkbox', 'date'];
    for (const fields of Object.values(CATEGORY_ATTRIBUTES)) {
      for (const f of fields) {
        expect(validTypes).toContain(f.type);
      }
    }
  });

  it('select fields have options array', () => {
    for (const fields of Object.values(CATEGORY_ATTRIBUTES)) {
      for (const f of fields) {
        if (f.type === 'select') {
          expect(Array.isArray(f.options)).toBe(true);
          expect(f.options!.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('findLabelForKey', () => {
  it('finds label for known key in alimentari', () => {
    expect(findLabelForKey('peso')).toBe('Peso / Quantità');
  });

  it('finds label for boolean key', () => {
    expect(findLabelForKey('bio')).toBe('Biologico');
  });

  it('falls back to capitalized key for unknown', () => {
    expect(findLabelForKey('unknown_field')).toBe('Unknown field');
  });

  it('handles empty key', () => {
    expect(findLabelForKey('')).toBe('');
  });
});

describe('formatAttributeValue', () => {
  it('returns dash for null/undefined/empty', () => {
    expect(formatAttributeValue(null)).toBe('—');
    expect(formatAttributeValue(undefined)).toBe('—');
    expect(formatAttributeValue('')).toBe('—');
  });

  it('formats boolean as Sì/No', () => {
    expect(formatAttributeValue(true)).toBe('Sì');
    expect(formatAttributeValue(false)).toBe('No');
  });

  it('formats number as string', () => {
    expect(formatAttributeValue(42)).toBe('42');
    expect(formatAttributeValue(3.14)).toBe('3.14');
    expect(formatAttributeValue(0)).toBe('0');
  });

  it('formats ISO date YYYY-MM-DD as DD/MM/YYYY', () => {
    expect(formatAttributeValue('2026-05-27')).toBe('27/05/2026');
    expect(formatAttributeValue('2026-01-01')).toBe('01/01/2026');
  });

  it('passes through other strings unchanged', () => {
    expect(formatAttributeValue('Made in Italy')).toBe('Made in Italy');
    expect(formatAttributeValue('500g')).toBe('500g');
  });

  it('serializes objects as JSON', () => {
    expect(formatAttributeValue({ a: 1 })).toBe('{"a":1}');
    expect(formatAttributeValue(['x', 'y'])).toBe('["x","y"]');
  });
});

describe('getAttributesForCategory', () => {
  const categories = [
    { id: 'cat-1', slug: 'alimentari', parent_id: null },
    { id: 'cat-2', slug: 'frutta', parent_id: 'cat-1' },
    { id: 'cat-3', slug: 'mele', parent_id: 'cat-2' },
    { id: 'cat-4', slug: 'unknown-top', parent_id: null },
  ];

  it('returns empty for null categoryId', () => {
    const result = getAttributesForCategory(categories, null);
    expect(result.fields).toEqual([]);
    expect(result.topSlug).toBeNull();
  });

  it('returns top-level fields directly', () => {
    const result = getAttributesForCategory(categories, 'cat-1');
    expect(result.topSlug).toBe('alimentari');
    expect(result.fields.length).toBeGreaterThan(0);
  });

  it('walks up parent chain to find top', () => {
    // mele → frutta → alimentari
    const result = getAttributesForCategory(categories, 'cat-3');
    expect(result.topSlug).toBe('alimentari');
  });

  it('returns empty fields if topSlug has no schema', () => {
    const result = getAttributesForCategory(categories, 'cat-4');
    expect(result.topSlug).toBe('unknown-top');
    expect(result.fields).toEqual([]);
  });

  it('returns empty for non-existent categoryId', () => {
    const result = getAttributesForCategory(categories, 'fake-id');
    expect(result.fields).toEqual([]);
    expect(result.topSlug).toBeNull();
  });
});
