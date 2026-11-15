/**
 * R15-011 — il numero sopra «Novità» è quello vero, e la finestra è quella del badge «Nuovo».
 * Orologio finto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDb } from './aiuti/finto-postgrest';
import { contaProdottiDellaGriglia, inizioFinestraNovita } from '@/lib/queries/griglia-prodotti';
import { NEW_PRODUCT_DAYS } from '@/lib/constants';
import type { SupabaseClient } from '@supabase/supabase-js';

afterEach(() => vi.useRealTimers());

const riga = (i: number, creato: string) => ({
  id: `p-${i}`, name: `P${i}`, price: 4, compare_at_price: null, images: [], stock: 3, has_variants: false,
  created_at: creato, seller_id: 's', category_id: null, status: 'available',
});

describe('R15-011 conteggio e finestra', () => {
  it('la finestra parte NEW_PRODUCT_DAYS giorni fa, arrotondata all ora', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T09:30:45Z'));
    expect(NEW_PRODUCT_DAYS).toBe(14);
    expect(inizioFinestraNovita()).toBe('2026-10-30T09:00:00.000Z');
  });

  it('il numero conta tutti i nuovi, non solo le 96 schede caricate', async () => {
    const prodotti = [
      ...Array.from({ length: 150 }, (_, i) => riga(i, '2026-11-10T10:00:00Z')),
      ...Array.from({ length: 195 }, (_, i) => riga(1000 + i, '2026-08-09T10:00:00Z')),
    ];
    const db = fintoDb({ products: prodotti });
    const n = await contaProdottiDellaGriglia(db.client as unknown as SupabaseClient, { creatiDal: '2026-10-30T09:00:00.000Z' });
    expect(n).toBe(150);
  });

  it('la pagina Novità chiede la finestra', () => {
    const src = readFileSync(join(process.cwd(), 'app', 'novita', 'page.tsx'), 'utf8');
    expect(src).toMatch(/<ProductGrid[^>]*\bsoloNovita\b/);
  });
});
