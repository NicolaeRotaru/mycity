/**
 * R02-012 — SE IL FILTRO FINALE SUI NEGOZI APPROVATI SCARTA RIGHE, «CARICA ALTRI» SI FERMA.
 *
 * La griglia chiede al database una pagina piena e poi, in fondo, toglie le righe dei negozi che la
 * vista pubblica non restituisce. Chi sfoglia (ProductGrid, con `pagineSuccessiva`) decideva «è
 * l'ultima» contando le righe tornate: una pagina piena con una riga scartata sembrava l'ultima e
 * «Carica altri» spariva. Qui la lettura vera gira contro il finto PostgREST: la pagina deve dire
 * quante righe ha letto (`righeLette`), e su quelle la decisione di sfogliare dice «ce ne sono altre».
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import { finestraDellaPagina, pagineSuccessiva } from '@/lib/paginazione';
import type { SupabaseClient } from '@supabase/supabase-js';

const APPROVATO = { id: '22222222-2222-2222-2222-000000000001', store_name: 'Forno', store_hours: null, is_approved: true };
const FUORI_VETRINA = '22222222-2222-2222-2222-000000000009';
const PAGINA = 4;

/** 10 prodotti, dal più nuovo al più vecchio; il secondo è di un negozio che la vista non restituisce. */
function catalogo(): Tabelle {
  return {
    seller_public_profiles: [APPROVATO],
    products: Array.from({ length: 10 }, (_, i) => ({
      id: `11111111-1111-1111-1111-${String(i).padStart(12, '0')}`,
      name: `Pane ${i}`, price: 3, compare_at_price: null, images: [], stock: 2, has_variants: false,
      created_at: `2026-11-${String(20 - i).padStart(2, '0')}T10:00:00Z`,
      seller_id: i === 1 ? FUORI_VETRINA : APPROVATO.id, category_id: null, status: 'available',
    })),
  };
}

/** Quello che fa chi sfoglia: la pagina successiva, se c'è. Le righe lette, se la pagina le dice. */
function prossima(pagina: unknown[], giaLette: number): number | undefined {
  const lette = (pagina as { righeLette?: unknown }).righeLette;
  return pagineSuccessiva(typeof lette === 'number' ? lette : pagina.length, giaLette, PAGINA);
}

describe('R02-012 · «Carica altri» non si ferma per una riga scartata in fondo', () => {
  it('pagina piena con una riga scartata: ce ne sono ancora', async () => {
    const db = fintoDb(catalogo());
    const prima = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest', tetto: PAGINA, finestra: finestraDellaPagina(0, PAGINA),
    });
    expect(prima, 'la riga del negozio fuori vetrina deve restare fuori').toHaveLength(3);
    expect(prossima(prima, 1), '«Carica altri» sparisce con altri prodotti ancora da vedere').toBe(1);
  });

  it('anche sul ramo della pertinenza', async () => {
    const tabelle = catalogo();
    const db = fintoDb(tabelle, {
      search_products_smart: () => ({ data: (tabelle.products as Array<{ id: string }>).map((p) => ({ id: p.id })), error: null }),
    });
    const prima = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'Pane', tetto: PAGINA, finestra: finestraDellaPagina(0, PAGINA),
    });
    expect(prima).toHaveLength(3);
    expect(prossima(prima, 1)).toBe(1);
  });

  it('l ultima pagina vera resta l ultima', async () => {
    const db = fintoDb(catalogo());
    const terza = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest', tetto: PAGINA, finestra: finestraDellaPagina(2, PAGINA),
    });
    expect(terza).toHaveLength(2);
    expect(prossima(terza, 3)).toBeUndefined();
  });

  it('il conto delle righe lette non entra nei confronti né nei cicli', async () => {
    const db = fintoDb(catalogo());
    const prima = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest', tetto: PAGINA, finestra: finestraDellaPagina(0, PAGINA),
    });
    expect(Object.keys(prima)).toEqual(['0', '1', '2']);
    expect(JSON.parse(JSON.stringify(prima))).toHaveLength(3);
  });
});
