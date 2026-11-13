/**
 * R15-011 — «Novità» era il catalogo intero ordinato per data. La lettura ora sa tagliare sulla data
 * di pubblicazione (`creatiDal`): un prodotto di novanta giorni fa non esce. Orologio finto.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDb } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const NEGOZIO = '22222222-2222-2222-2222-000000000001';
const giorniFa = (adesso: number, g: number) => new Date(adesso - g * 86_400_000).toISOString();
const riga = (id: string, name: string, creato: string) => ({
  id, name, price: 4, compare_at_price: null, images: [], stock: 3, has_variants: false,
  created_at: creato, seller_id: NEGOZIO, category_id: null, status: 'available',
});

afterEach(() => vi.useRealTimers());

describe('R15-011 finestra novità', () => {
  it('con la finestra di 14 giorni il prodotto di tre mesi fa non compare', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T09:30:00Z'));
    const adesso = Date.now();
    const db = fintoDb({
      seller_public_profiles: [{ id: NEGOZIO, store_name: 'Forno', store_hours: null, is_approved: true }],
      products: [
        riga('p-1', 'Fresco di ieri', giorniFa(adesso, 1)),
        riga('p-2', 'Di due settimane scarse', giorniFa(adesso, 13)),
        riga('p-3', 'Salame vecchio', giorniFa(adesso, 90)),
      ],
    });
    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest', tetto: 96, creatiDal: giorniFa(adesso, 14),
    });
    expect(righe.map((r) => r.name)).toEqual(['Fresco di ieri', 'Di due settimane scarse']);
  });

  // Prova leggera: ProductGrid e la pagina sono componenti che qui non si montano.
  it('la pagina Novità chiede la finestra e la griglia la gira alla lettura e al conteggio', () => {
    const pagina = readFileSync(join(process.cwd(), 'app', 'novita', 'page.tsx'), 'utf8');
    const griglia = readFileSync(join(process.cwd(), 'components', 'ProductGrid.tsx'), 'utf8');
    expect(pagina).toMatch(/<ProductGrid[^>]*\bsoloNovita\b/);
    expect(griglia).toMatch(/creatiDal,\s*\n\s*tetto:/);
    expect(griglia).toMatch(/onCount\(totaleVero \?\? filtered\.length\)/);
  });
});
