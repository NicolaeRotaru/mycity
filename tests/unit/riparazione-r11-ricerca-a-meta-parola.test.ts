/**
 * R11-009 — Cercando una parola a metà («pomo») la pertinenza del database trova solo una parte dei
 * prodotti: gli altri, che hanno la parola nel nome, devono comparire lo stesso; e con il voto
 * minimo, se nessun pertinente è recensito, non si dice «nessun risultato».
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';

const NEGOZIO = { id: 's1', store_name: 'Orto', store_hours: null, is_approved: true };
const prodotto = (id: string, name: string, giorno: number) => ({
  id, name, price: 2, compare_at_price: null, images: [], stock: 3, has_variants: false,
  created_at: `2026-11-${String(giorno).padStart(2, '0')}T10:00:00Z`, seller_id: 's1', category_id: null, status: 'available',
});
function tabelle(): Tabelle {
  return {
    seller_public_profiles: [NEGOZIO],
    products: [
      prodotto('p1', 'Pomodori', 20),
      prodotto('p2', 'Pomodorini', 19),
      prodotto('p3', 'Pomo d oro', 18),
      prodotto('p4', 'Pane', 17),
    ],
  };
}
// La funzione di ricerca italiana riconosce solo «Pomodori».
const rpcs = { search_products_smart: () => ({ data: [{ id: 'p1' }], error: null }) };

describe('R11-009 · ricerca a metà parola', () => {
  it('trova anche i prodotti che la pertinenza non riconosce', async () => {
    const db = fintoDb(tabelle(), rpcs);
    const r = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, { sort: 'relevance', search: 'pomo', tetto: 10 });
    expect(r.map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(r[0].id, 'il pertinente resta in testa').toBe('p1');
  });
  it('col voto minimo, se il pertinente non è recensito, non dice «nessun risultato»', async () => {
    const db = fintoDb(tabelle(), rpcs);
    const r = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'pomo', tetto: 10, idsColVoto: ['p2'],
    });
    expect(r.map((x) => x.id)).toEqual(['p2']);
  });
});
