/**
 * 27/8/2026 (R069) — LA GRIGLIA CHIEDEVA PRIMA L'ELENCO DI TUTTI I NEGOZI APPROVATI.
 *
 * Prima di leggere i prodotti, ogni griglia del sito faceva un viaggio in più: si portava a casa
 * l'identificativo di OGNI negozio approvato e poi lo rispediva indietro dentro un `.in(...)`. Due
 * conseguenze, una che si vede oggi e una che si vede il giorno che le cose vanno bene:
 *
 *  · oggi, un viaggio di rete in più prima di ogni catalogo, per ogni visitatore;
 *  · domani, quando i negozi saranno qualche centinaio, quell'elenco non ci sta più
 *    nell'indirizzo (difetto #93 di casa: ~37 caratteri per identificativo contro un limite
 *    pratico intorno agli ottomila). Il server risponde 414 e il catalogo diventa vuoto mentre il
 *    sito continua a rispondere «va tutto bene». Nessuno se ne accorge finché non telefona un
 *    negoziante.
 *
 * Quel filtro era per giunta doppio: dalla migrazione 129 è la regola del database a nascondere i
 * prodotti dei negozi non approvati, sulla stessa query, senza secondo viaggio.
 *
 * La rete di sicurezza nel browser resta e questa prova la tiene: un prodotto di un negozio non
 * approvato non deve comparire lo stesso.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

function prodotto(n: number, sellerId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `11111111-1111-1111-1111-${String(n).padStart(12, '0')}`,
    name: `Prodotto ${n}`,
    price: 10 + n,
    compare_at_price: null,
    images: [],
    stock: 5,
    has_variants: false,
    created_at: `2026-08-${String(1 + (n % 27)).padStart(2, '0')}T10:00:00Z`,
    seller_id: sellerId,
    category_id: null,
    status: 'available',
    ...extra,
  };
}

function negozio(n: number, approvato = true) {
  return {
    id: `22222222-2222-2222-2222-${String(n).padStart(12, '0')}`,
    store_name: `Negozio ${n}`,
    store_hours: null,
    is_approved: approvato,
  };
}

function mondo(quantiNegozi: number, prodotti: Array<{ n: number; negozio: number }>): Tabelle {
  const negozi = Array.from({ length: quantiNegozi }, (_, i) => negozio(i));
  return {
    seller_public_profiles: negozi,
    products: prodotti.map((p) => prodotto(p.n, negozi[p.negozio].id)),
  };
}

describe('la griglia dei prodotti a cinquecento negozi', () => {
  it('mostra ancora i prodotti quando i negozi approvati sono cinquecento', async () => {
    const db = fintoDb(mondo(500, [{ n: 1, negozio: 0 }, { n: 2, negozio: 7 }, { n: 3, negozio: 499 }]));

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, { sort: 'newest', tetto: 96 });

    // Col giro vecchio qui arrivavano zero prodotti (o un errore): cinquecento identificativi
    // rispediti nell'indirizzo lo facevano sfondare. Il negoziante vedeva la sua vetrina vuota.
    expect(righe.map((r) => r.name).sort()).toEqual(['Prodotto 1', 'Prodotto 2', 'Prodotto 3']);
  });

  it('non si porta a casa l elenco dei negozi prima di leggere il catalogo', async () => {
    const db = fintoDb(mondo(12, [{ n: 1, negozio: 0 }, { n: 2, negozio: 1 }]));

    await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, { sort: 'newest', tetto: 96 });

    // Resta UNA sola lettura dei negozi: quella che prende il nome delle botteghe dei prodotti
    // trovati. La lettura «dammi tutti i negozi approvati», che veniva prima, non c'è più.
    const lettureNegozi = db.chiamate.filter((c) => c.tabella === 'seller_public_profiles');
    expect(lettureNegozi.length, 'un viaggio di rete in più prima di ogni griglia del sito').toBe(1);
    expect(db.chiamate[0].tabella, 'la prima cosa che si chiede deve essere il catalogo').toBe('products');
  });

  it('un prodotto di un negozio non approvato resta fuori', async () => {
    const tabelle = mondo(2, [{ n: 1, negozio: 0 }, { n: 2, negozio: 1 }]);
    (tabelle.seller_public_profiles[1] as { is_approved: boolean }).is_approved = false;
    const db = fintoDb(tabelle);

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, { sort: 'newest', tetto: 96 });

    expect(righe.map((r) => r.name), 'la rete di sicurezza nel browser è saltata insieme al filtro').toEqual(['Prodotto 1']);
  });

  it('i filtri di prezzo e disponibilità continuano a tagliare nel database', async () => {
    const tabelle = mondo(1, [{ n: 1, negozio: 0 }, { n: 2, negozio: 0 }, { n: 3, negozio: 0 }]);
    (tabelle.products[1] as { price: number }).price = 999;
    (tabelle.products[2] as { stock: number | null }).stock = 0;
    const db = fintoDb(tabelle);

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest', tetto: 96, maxPrice: 100, onlyInStock: true,
    });

    expect(righe.map((r) => r.name)).toEqual(['Prodotto 1']);
  });
});
