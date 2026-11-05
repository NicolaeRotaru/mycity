/**
 * S09 — 144: cercando dentro la vetrina di un negozio, i suoi prodotti non restano fuori dal taglio
 * della pertinenza calcolata su tutto il sito.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const FORNO = '22222222-2222-2222-2222-000000000001';
const ALTRO = '22222222-2222-2222-2222-000000000002';
const riga = (id: string, name: string, seller: string) => ({
  id, name, price: 3, compare_at_price: null, images: [], stock: 3, has_variants: false,
  created_at: '2026-10-01T10:00:00Z', seller_id: seller, category_id: null, status: 'available',
});
const PANE_DEL_FORNO = '11111111-1111-1111-1111-000000000009';

const TABELLE = {
  seller_public_profiles: [
    { id: FORNO, store_name: 'Pane Quotidiano', store_hours: null, is_approved: true },
    { id: ALTRO, store_name: 'Altro', store_hours: null, is_approved: true },
  ],
  products: [
    riga('11111111-1111-1111-1111-000000000001', 'Panettone', ALTRO),
    riga('11111111-1111-1111-1111-000000000002', 'Panna', ALTRO),
    riga(PANE_DEL_FORNO, 'Panino al latte', FORNO),
  ],
};

describe('144 — una parola a metà dentro la vetrina', () => {
  it('se la pertinenza del sito tiene solo prodotti di altri negozi, quello del negozio si trova lo stesso', async () => {
    const db = fintoDb(TABELLE, {
      // La pertinenza calcolata su tutto il sito: i primi posti sono di un altro negozio.
      search_products_smart: () => ({
        data: [{ id: '11111111-1111-1111-1111-000000000001' }, { id: '11111111-1111-1111-1111-000000000002' }],
        error: null,
      }),
    });
    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'pan', sellerId: FORNO, tetto: 96,
    });
    expect(righe.map((r) => r.id)).toEqual([PANE_DEL_FORNO]);
  });
});
