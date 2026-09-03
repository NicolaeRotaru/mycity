/**
 * 3/9/2026 — CHI FILTRAVA «ALIMENTARI» NON VEDEVA IL PANE.
 *
 * ── Cosa succedeva ──────────────────────────────────────────────────────────────────────────────
 * Le categorie di MyCity sono a due piani: le madri («Alimentari», «Casa») e le figlie
 * («Panificio», «Salumeria»). Il filtro «Categoria» della pagina di ricerca le elenca tutte
 * insieme, quindi scegliere una madre è normale come scegliere una figlia.
 *
 * Ma la lettura che sta sotto ogni griglia riceveva UN identificativo e faceva
 * `category_id = quello` secco. Il pane di Pane Quotidiano è classificato in «Panificio», che è
 * figlia di «Alimentari»: chi il sabato apriva Cerca e filtrava «Alimentari» leggeva «nessun
 * risultato» su una categoria piena di roba da mangiare. Merce che esiste e non si trova — l'ordine
 * lo perde il negozio, e nessuno se ne accorge perché la pagina non è rotta: risponde «vuoto».
 *
 * ── Perché la cura sta nella lettura e non nella pagina ──────────────────────────────────────────
 * A passare una categoria a quella lettura sono sette punti diversi: il filtro della ricerca, la
 * griglia della pagina categoria, una vetrina per ogni sottocategoria, «Altri prodotti», «Ti
 * potrebbe interessare», i prodotti simili della scheda e i regali. Curata in un punto solo, la
 * malattia resterebbe possibile negli altri sei.
 *
 * ── Cosa prova questo file ──────────────────────────────────────────────────────────────────────
 * ESEGUE la lettura vera contro un finto PostgREST che i filtri li applica davvero, e pretende i
 * prodotti delle figlie. Prova anche il verso opposto, che è il modo in cui una cura così si rompe:
 * scegliendo una figlia non devono comparire i prodotti delle sorelle né di un'altra madre.
 *
 * ⚠️ Cosa NON prova: che nel database vero i prodotti stiano davvero nelle figlie (da qui non c'è
 * un catalogo pieno da guardare). Se un giorno stessero tutti sulle madri, questa cura non
 * servirebbe a nessuno — ma non farebbe danno.
 */
import { describe, it, expect } from 'vitest';
import { fintoDb, type Tabelle } from './aiuti/finto-postgrest';
import { leggiProdottiDellaGriglia } from '@/lib/queries/griglia-prodotti';
import type { SupabaseClient } from '@supabase/supabase-js';

const NEGOZIO = {
  id: '22222222-2222-2222-2222-000000000001',
  store_name: 'Pane Quotidiano',
  store_hours: null,
  is_approved: true,
};

const ALIMENTARI = '33333333-3333-3333-3333-000000000001';
const PANIFICIO = '33333333-3333-3333-3333-000000000002';
const SALUMERIA = '33333333-3333-3333-3333-000000000003';
/** Un'altra madre, che con il mangiare non c'entra niente: serve a vedere se il filtro allarga troppo. */
const CASA = '33333333-3333-3333-3333-000000000009';

function prodotto(n: number, nome: string, categoria: string) {
  return {
    id: `11111111-1111-1111-1111-${String(n).padStart(12, '0')}`,
    name: nome,
    price: 3 + n,
    compare_at_price: null,
    images: [],
    stock: 5,
    has_variants: false,
    created_at: `2026-09-0${n}T10:00:00Z`,
    seller_id: NEGOZIO.id,
    category_id: categoria,
    status: 'available',
  };
}

const PANE = prodotto(1, 'Pane comune', PANIFICIO);
const SALAME = prodotto(2, 'Salame piacentino', SALUMERIA);
const OLIO = prodotto(3, 'Olio', ALIMENTARI);
const SCOPA = prodotto(4, 'Scopa', CASA);

function mondo(): Tabelle {
  return {
    categories: [
      { id: ALIMENTARI, parent_id: null, name: 'Alimentari' },
      { id: PANIFICIO, parent_id: ALIMENTARI, name: 'Panificio' },
      { id: SALUMERIA, parent_id: ALIMENTARI, name: 'Salumeria' },
      { id: CASA, parent_id: null, name: 'Casa' },
    ],
    seller_public_profiles: [NEGOZIO],
    products: [PANE, SALAME, OLIO, SCOPA],
  };
}

const nomi = (righe: Array<{ name: string }>) => righe.map((r) => r.name).sort();

describe('il filtro per categoria della ricerca', () => {
  it('scegliendo la madre mostra anche i prodotti delle sue sottocategorie', async () => {
    const db = fintoDb(mondo());

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest',
      tetto: 96,
      categoryId: ALIMENTARI,
    });

    // Prima della cura qui usciva il solo «Olio», quello appeso direttamente alla madre: il pane e
    // il salame — cioè quasi tutta la gastronomia — restavano invisibili.
    expect(nomi(righe), 'il pane sta in «Panificio»: filtrando «Alimentari» deve uscire lo stesso')
      .toEqual(['Olio', 'Pane comune', 'Salame piacentino']);
  });

  it('e non tira dentro i prodotti di un altra madre', async () => {
    const db = fintoDb(mondo());

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest',
      tetto: 96,
      categoryId: ALIMENTARI,
    });

    // Il verso in cui una cura così si rompe: allargare troppo. Chi cerca da mangiare non deve
    // trovarsi una scopa.
    expect(righe.map((r) => r.name)).not.toContain('Scopa');
  });

  it('scegliendo una figlia resta dentro la figlia', async () => {
    const db = fintoDb(mondo());

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest',
      tetto: 96,
      categoryId: PANIFICIO,
    });

    expect(nomi(righe), 'chi filtra «Panificio» vuole il pane, non il salame della sorella')
      .toEqual(['Pane comune']);
  });

  it('una madre senza figlie continua a comportarsi come prima', async () => {
    const db = fintoDb(mondo());

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest',
      tetto: 96,
      categoryId: CASA,
    });

    expect(nomi(righe)).toEqual(['Scopa']);
  });

  it('vale anche cercando una parola, dove l ordine lo decide il database', async () => {
    const db = fintoDb(mondo(), {
      // È la funzione di pertinenza del database: qui risponde che il più pertinente è il pane.
      search_products_smart: () => ({ data: [{ id: PANE.id }], error: null }),
    });

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance',
      search: 'pane',
      tetto: 96,
      categoryId: ALIMENTARI,
    });

    expect(nomi(righe), 'cercare «pane» dentro «Alimentari» non deve dare zero risultati')
      .toEqual(['Pane comune']);
  });

  it('chi passa già l elenco delle categorie non paga nessuna lettura in più', async () => {
    const db = fintoDb(mondo());

    const righe = await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'newest',
      tetto: 96,
      categoryIds: [PANIFICIO, SALUMERIA],
    });

    expect(nomi(righe)).toEqual(['Pane comune', 'Salame piacentino']);
    expect(
      db.chiamate.filter((c) => c.tabella === 'categories').length,
      'la pagina dei regali risolve l’albero da sé: qui una seconda lettura sarebbe sprecata',
    ).toBe(0);
  });

  it('senza filtro categoria non si chiede niente in più, come prima', async () => {
    const db = fintoDb(mondo());

    await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, { sort: 'newest', tetto: 96 });

    expect(db.chiamate.filter((c) => c.tabella === 'categories').length).toBe(0);
    expect(db.chiamate[0].tabella, 'la prima cosa che si chiede resta il catalogo').toBe('products');
  });

  it('e l albero si chiede una volta sola, non per ogni blocco', async () => {
    const db = fintoDb(mondo(), {
      search_products_smart: () => ({ data: [{ id: PANE.id }, { id: SALAME.id }], error: null }),
    });

    await leggiProdottiDellaGriglia(db.client as unknown as SupabaseClient, {
      sort: 'relevance',
      search: 'piacentino',
      tetto: 96,
      categoryId: ALIMENTARI,
    });

    expect(
      db.chiamate.filter((c) => c.tabella === 'categories').length,
      'una lettura dentro il pezzo che si ripete sarebbe un viaggio di rete per blocco',
    ).toBe(1);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * E se la lettura delle sottocategorie non riesce? Si torna al comportamento di
 * prima — la madre da sola — invece di lasciare la griglia vuota. Una cura che
 * svuota il catalogo quando cade la rete sarebbe peggio della malattia.
 * ───────────────────────────────────────────────────────────────────────────── */

type QueryRotta = {
  select: () => QueryRotta;
  eq: () => QueryRotta;
  then: <T>(risolvi: (v: { data: null; error: { message: string } }) => T) => Promise<T>;
};

function letturaRotta(): QueryRotta {
  const q: QueryRotta = {
    select: () => q,
    eq: () => q,
    then: (risolvi) => Promise.resolve(risolvi({ data: null, error: { message: 'rete caduta' } })),
  };
  return q;
}

describe('quando la lettura delle sottocategorie non riesce', () => {
  it('la griglia non resta vuota: mostra almeno la categoria scelta', async () => {
    const db = fintoDb(mondo());
    const clienteConLeCategorieRotte = {
      ...db.client,
      from: (tabella: string) =>
        tabella === 'categories' ? letturaRotta() : db.client.from(tabella),
    };

    const righe = await leggiProdottiDellaGriglia(
      clienteConLeCategorieRotte as unknown as SupabaseClient,
      { sort: 'newest', tetto: 96, categoryId: ALIMENTARI },
    );

    expect(nomi(righe)).toEqual(['Olio']);
  });
});
