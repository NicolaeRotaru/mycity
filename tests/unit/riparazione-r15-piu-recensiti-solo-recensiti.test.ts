/**
 * R15-009 — «I più recensiti» non può presentare come «scelti dai clienti» prodotti senza recensioni.
 * La lettura sa già tagliare sugli id col voto (`idsColVoto`): qui si prova che, con quel taglio,
 * un prodotto a zero recensioni non esce nemmeno se è fra i più recenti; e, in modo leggero, che la
 * pagina lo chiede e che la griglia, senza voto minimo, interroga `prodotti_con_voto_almeno(0)`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fintoDb } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const leggi = (f: string) => readFileSync(join(process.cwd(), ...f.split('/')), 'utf8');

describe('R15-009 più recensiti', () => {
  it('con il taglio sugli id recensiti, i prodotti a zero recensioni non escono anche se più recenti', async () => {
    const riga = (id: string, creato: string) => ({
      id, name: id, price: 3, compare_at_price: null, images: [], stock: 1, has_variants: false,
      created_at: creato, seller_id: 's', category_id: null, status: 'available',
    });
    const db = fintoDb({
      seller_public_profiles: [{ id: 's', store_name: 'N', store_hours: null, is_approved: true }],
      products: [riga('vecchio-recensito', '2026-01-01T00:00:00Z'), riga('nuovo-1', '2026-11-10T00:00:00Z'), riga('nuovo-2', '2026-11-11T00:00:00Z')],
    });
    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'rating', tetto: 40, idsColVoto: ['vecchio-recensito'],
    });
    expect(righe.map((r) => r.id)).toEqual(['vecchio-recensito']);
  });

  it('la pagina chiede solo i recensiti e la griglia li legge dal database anche senza voto minimo', () => {
    expect(leggi('app/piu-venduti/page.tsx')).toMatch(/<ProductGrid[^>]*\bsoloRecensiti\b/);
    const griglia = leggi('components/ProductGrid.tsx');
    expect(griglia).toMatch(/p_min: minRating \?\? 0/);
    expect(griglia).toMatch(/vistaPerVoto \? idsColVoto \?\? \[\] : undefined/);
  });
});
