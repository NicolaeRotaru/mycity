/**
 * 27/8/2026 (R073) — «ORDINA PER PERTINENZA» ORDINAVA PER DATA.
 *
 * Nel sito c'erano due ricerche diverse. Il suggeritore sotto la barra chiamava
 * `search_products_smart`, la ricerca vera del database: capisce l'italiano, guarda anche la
 * descrizione, e mette in cima quello che c'entra di più. La pagina dei risultati — quella dove uno
 * arriva quando ha deciso di comprare — faceva invece `ilike` sul solo NOME e, sotto la voce
 * «pertinenza» (che è la prima dell'elenco, quindi quella che vede quasi tutti), ordinava per data
 * di pubblicazione.
 *
 * Chi cercava «pane» riceveva i prodotti più recenti col nome che contiene «pane», e NON vedeva
 * affatto quelli in cui «pane» sta nella descrizione. La colonna full-text si ricalcola a ogni
 * scrittura di prodotto e il suo indice si mantiene da mesi: la pagina che ne aveva più bisogno
 * pagava il costo e non incassava il beneficio.
 *
 * Il ripiego con `ilike` resta, e questa prova lo tiene: la ricerca italiana non capisce i termini
 * tagliati a metà («pomo» per «Pomodori»), e senza ripiego quella persona non troverebbe niente.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const NEGOZIO = '22222222-2222-2222-2222-000000000001';
const FOCACCIA = '11111111-1111-1111-1111-000000000001';
const CIABATTA = '11111111-1111-1111-1111-000000000002';
const POMODORI = '11111111-1111-1111-1111-000000000003';

function riga(id: string, name: string, creato: string, price = 5) {
  return {
    id, name, price, compare_at_price: null, images: [], stock: 3, has_variants: false,
    created_at: creato, seller_id: NEGOZIO, category_id: null, status: 'available',
  };
}

const TABELLE = {
  seller_public_profiles: [{ id: NEGOZIO, store_name: 'Forno del Corso', store_hours: null, is_approved: true }],
  products: [
    // «pane» sta solo nella descrizione: il nome non lo contiene.
    riga(FOCACCIA, 'Focaccia dei Colli', '2026-08-01T10:00:00Z', 4),
    riga(CIABATTA, 'Ciabatta di pane comune', '2026-08-20T10:00:00Z', 3),
    riga(POMODORI, 'Pomodori di Piacenza', '2026-08-10T10:00:00Z', 2),
  ],
};

/** La ricerca del database: capisce l'italiano e ordina per quanto c'entra. */
function ricercaIntelligente(risultati: Array<{ id: string; rank: number }>) {
  return {
    search_products_smart: () => ({ data: risultati.map((r) => ({ id: r.id, rank: r.rank })), error: null }),
  };
}

describe('la pagina dei risultati quando si ordina per pertinenza', () => {
  it('trova il prodotto che ha la parola cercata solo nella descrizione', async () => {
    // La focaccia si chiama «Focaccia dei Colli»: `ilike` sul nome non la trova mai. La ricerca del
    // database sì, perché legge anche la descrizione. È il negoziante che perde la vendita.
    const db = fintoDb(TABELLE, ricercaIntelligente([{ id: FOCACCIA, rank: 0.9 }]));

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'pane', tetto: 96,
    });

    expect(righe.map((r) => r.name)).toEqual(['Focaccia dei Colli']);
  });

  it('mette in cima il più pertinente, non il più recente', async () => {
    // La ciabatta è più recente della focaccia. Per pertinenza vince la focaccia.
    const db = fintoDb(TABELLE, ricercaIntelligente([
      { id: FOCACCIA, rank: 0.91 },
      { id: CIABATTA, rank: 0.42 },
    ]));

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'pane', tetto: 96,
    });

    expect(righe.map((r) => r.name), 'chi sceglie «pertinenza» riceve «più recenti» senza saperlo').toEqual([
      'Focaccia dei Colli',
      'Ciabatta di pane comune',
    ]);
  });

  it('se la ricerca italiana non trova niente resta il ripiego per le parole tagliate a metà', async () => {
    // «pomo» non è una parola italiana: la ricerca full-text non restituisce niente e senza ripiego
    // chi cerca «pomo» non troverebbe i pomodori.
    const db = fintoDb(TABELLE, ricercaIntelligente([]));

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'pomo', tetto: 96,
    });

    expect(righe.map((r) => r.name)).toEqual(['Pomodori di Piacenza']);
  });

  it('i filtri restano validi anche sui risultati della ricerca intelligente', async () => {
    const db = fintoDb(TABELLE, ricercaIntelligente([
      { id: FOCACCIA, rank: 0.9 },
      { id: CIABATTA, rank: 0.8 },
    ]));

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance', search: 'pane', tetto: 96, maxPrice: 3.5,
    });

    expect(righe.map((r) => r.name), 'un filtro di prezzo ignorato mostra roba fuori budget').toEqual([
      'Ciabatta di pane comune',
    ]);
  });

  it('quando si ordina per prezzo la ricerca intelligente non c entra', async () => {
    const db = fintoDb(TABELLE, ricercaIntelligente([{ id: FOCACCIA, rank: 0.9 }]));

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'price_asc', search: 'pane', tetto: 96,
    });

    // Ordinamento esplicito = l'ordine lo decide la colonna scelta, e il filtro resta quello sul nome.
    expect(db.rpc.length, 'una chiamata alla ricerca intelligente sprecata su un ordinamento esplicito').toBe(0);
    expect(righe.map((r) => r.name)).toEqual(['Ciabatta di pane comune']);
  });
});
