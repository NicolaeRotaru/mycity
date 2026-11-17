/**
 * R02-010 — IL TAGLIO SUI PRODOTTI RECENSITI NON USAVA LA LETTURA A BLOCCHI.
 *
 * «Più recensiti» e «voto minimo» passano alla griglia l'elenco degli id col voto, e la lettura lo
 * metteva tutto in un `.in('id', …)`: nell'indirizzo. Sopra circa 216 id il server risponde 414 e
 * la griglia va in errore. Qui la lettura vera gira contro il finto PostgREST, che risponde 414
 * come quello vero quando l'indirizzo sfonda: con 500 id nessuna domanda deve portarne più di un
 * blocco, e le righe devono essere le stesse (stesso ordine, stessa finestra) di una lettura sola.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, LIMITE_INDIRIZZO, type Tabelle } from './aiuti/finto-postgrest';
import { contaProdottiDellaGriglia, leggiProdottiDellaGriglia, type OrdineGriglia } from '@/lib/queries/griglia-prodotti';
import { DIMENSIONE_BLOCCO } from '@/lib/supabase/blocchi';
import type { SupabaseClient } from '@supabase/supabase-js';

const NEGOZI = [
  { id: '22222222-2222-2222-2222-000000000001', store_name: 'Forno', store_hours: null, is_approved: true },
  { id: '22222222-2222-2222-2222-000000000002', store_name: 'Orto', store_hours: null, is_approved: true },
];

type Prodotto = { id: string; name: string; price: number; created_at: string; seller_id: string };

const prodotti: Prodotto[] = Array.from({ length: 700 }, (_, i) => ({
  id: `11111111-1111-1111-1111-${String((i * 7919) % 1000).padStart(12, '0')}`,
  name: `Prodotto ${i}`,
  // Prezzi e date che si ripetono: l'ordine fra pari lo decide l'id, come nel database.
  price: (i % 23) + 1,
  created_at: `2026-11-${String((i % 15) + 1).padStart(2, '0')}T10:00:00Z`,
  seller_id: NEGOZI[i % 2].id,
}));

/** 500 prodotti col voto, sparsi nel catalogo. */
const recensiti = prodotti.filter((_, i) => i % 7 !== 3).slice(0, 500).map((p) => p.id);

function catalogo(): Tabelle {
  return {
    seller_public_profiles: NEGOZI,
    products: prodotti.map((p) => ({
      ...p, compare_at_price: null, images: [], stock: 3, has_variants: false, category_id: null, status: 'available',
    })),
  };
}

/** Il client finto, con una spia su quanti id porta ogni `.in('id', …)` sui prodotti. */
function conSpia(db: ReturnType<typeof fintoDb>) {
  const idsPerDomanda: number[] = [];
  const client = {
    ...db.client,
    from: (tabella: string) => {
      const q = db.client.from(tabella) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const vero = q.in.bind(q);
      q.in = (colonna: unknown, valori: unknown) => {
        if (tabella === 'products' && colonna === 'id') idsPerDomanda.push((valori as unknown[]).length);
        return vero(colonna, valori);
      };
      return q;
    },
  };
  return { client: client as unknown as SupabaseClient, idsPerDomanda };
}

/** Quello che darebbe una lettura sola: i recensiti, nell'ordine del database, tagliati alla finestra. */
function attese(sort: OrdineGriglia, da: number, a: number, soloIds: string[] = recensiti): string[] {
  const dentro = new Set(soloIds);
  const cmp = (x: string | number, y: string | number) => (x === y ? 0 : x < y ? -1 : 1);
  return prodotti
    .filter((p) => dentro.has(p.id))
    .sort((p, q) => {
      const primo = sort === 'price_asc' ? cmp(p.price, q.price)
        : sort === 'price_desc' ? -cmp(p.price, q.price)
          : -cmp(p.created_at, q.created_at);
      return primo !== 0 ? primo : -cmp(p.id, q.id);
    })
    .slice(da, a + 1)
    .map((p) => p.id);
}

describe('R02-010 · il taglio sui prodotti recensiti va a blocchi', () => {
  it('con 500 id col voto la griglia non sfonda l indirizzo e mostra le righe giuste (più recenti, prima pagina)', async () => {
    const db = fintoDb(catalogo());
    const { client, idsPerDomanda } = conSpia(db);
    const righe = await leggiProdottiDellaGriglia(client, { sort: 'newest', tetto: 96, finestra: [0, 95], idsColVoto: recensiti });
    expect(Math.max(...idsPerDomanda), 'un .in porta più id di un blocco').toBeLessThanOrEqual(DIMENSIONE_BLOCCO);
    expect(db.chiamate.every((c) => c.lunghezzaIndirizzo <= LIMITE_INDIRIZZO), 'una domanda sfonda l indirizzo (414)').toBe(true);
    expect(righe.map((r) => r.id)).toEqual(attese('newest', 0, 95));
  });

  it('seconda pagina, per prezzo crescente: la stessa finestra di una lettura sola', async () => {
    const db = fintoDb(catalogo());
    const { client, idsPerDomanda } = conSpia(db);
    const righe = await leggiProdottiDellaGriglia(client, { sort: 'price_asc', tetto: 96, finestra: [96, 191], idsColVoto: recensiti });
    expect(Math.max(...idsPerDomanda)).toBeLessThanOrEqual(DIMENSIONE_BLOCCO);
    expect(righe.map((r) => r.id)).toEqual(attese('price_asc', 96, 191));
  });

  it('senza finestra, per prezzo decrescente, col tetto', async () => {
    const db = fintoDb(catalogo());
    const { client } = conSpia(db);
    const righe = await leggiProdottiDellaGriglia(client, { sort: 'price_desc', tetto: 40, idsColVoto: recensiti });
    expect(righe.map((r) => r.id)).toEqual(attese('price_desc', 0, 39));
  });

  it('con pochi id la domanda resta una sola, come prima', async () => {
    const db = fintoDb(catalogo());
    const { client, idsPerDomanda } = conSpia(db);
    const pochi = recensiti.slice(0, 30);
    const righe = await leggiProdottiDellaGriglia(client, { sort: 'newest', tetto: 96, finestra: [0, 95], idsColVoto: pochi });
    expect(idsPerDomanda).toEqual([30]);
    expect(righe.map((r) => r.id)).toEqual(attese('newest', 0, 95, pochi));
  });

  it('ricerca dentro un negozio col voto minimo: anche il ripiego per nome va a blocchi', async () => {
    const db = fintoDb(catalogo(), {
      search_products_smart: () => ({ data: recensiti.slice(0, 5).map((id) => ({ id })), error: null }),
    });
    const { client, idsPerDomanda } = conSpia(db);
    const righe = await leggiProdottiDellaGriglia(client, {
      sort: 'relevance', search: 'Prodotto', sellerId: NEGOZI[0].id, tetto: 96, finestra: [0, 95], idsColVoto: recensiti,
    });
    expect(Math.max(...idsPerDomanda)).toBeLessThanOrEqual(DIMENSIONE_BLOCCO);
    expect(db.chiamate.every((c) => c.lunghezzaIndirizzo <= LIMITE_INDIRIZZO)).toBe(true);
    const delNegozio = new Set(prodotti.filter((p) => p.seller_id === NEGOZI[0].id).map((p) => p.id));
    expect(righe.length).toBeGreaterThan(5);
    expect(righe.every((r) => delNegozio.has(r.id) && recensiti.includes(r.id))).toBe(true);
  });

  it('il conteggio con 500 id col voto: un numero, non «non lo so»', async () => {
    const db = fintoDb(catalogo());
    const { client, idsPerDomanda } = conSpia(db);
    const n = await contaProdottiDellaGriglia(client, { idsColVoto: recensiti });
    expect(Math.max(...idsPerDomanda)).toBeLessThanOrEqual(DIMENSIONE_BLOCCO);
    expect(n).toBe(500);
  });
});
