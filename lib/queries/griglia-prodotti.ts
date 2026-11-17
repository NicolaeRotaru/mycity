import type { SupabaseClient } from '@supabase/supabase-js';
import { attachSellerProfiles, fetchSellerPublicMap, type SellerPublicProfile } from '@/lib/queries/seller-public-profiles';
import { DIMENSIONE_BLOCCO, inBlocchi, leggiInBlocchi } from '@/lib/supabase/blocchi';
import { NEW_PRODUCT_DAYS } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * LA LETTURA CHE STA SOTTO OGNI GRIGLIA DI PRODOTTI DEL SITO.
 *
 * Sta qui, e non dentro il componente, per due motivi. Il primo: è la lettura più calda del sito —
 * home, categorie, vetrina del negozio, pagina dei risultati — e due difetti seri ci sono passati
 * senza che nessuna prova potesse accorgersene. Il secondo: in questa repo un componente React non
 * si può montare in una prova, quindi finché la lettura viveva dentro il componente non era
 * verificabile da nessuno.
 *
 * 27/8/2026 (R069) — prima si chiedeva l'elenco di TUTTI i negozi approvati e lo si rispediva
 * indietro dentro un `.in(...)`: un viaggio di rete in più prima di ogni griglia, e — passate le
 * poche centinaia di negozi — un indirizzo troppo lungo, un 414, e il catalogo vuoto mentre il sito
 * risponde «va tutto bene». Dalla migrazione 129 quel filtro lo fa già la regola del database sulla
 * stessa query. La rete di sicurezza nel browser (il controllo su `is_approved` in fondo) resta.
 *
 * 27/8/2026 (R073) — «ordina per pertinenza» ordinava per data, e cercava solo dentro il nome. Ora
 * la pertinenza la calcola il database con `search_products_smart`, la stessa funzione che usa il
 * suggeritore sotto la barra di ricerca; `ilike` resta come ripiego per le parole tagliate a metà
 * («pomo» per «Pomodori»), che la ricerca italiana non riconosce.
 */

export type OrdineGriglia = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating' | 'discount_desc';

export type RigaGriglia = {
  id: string;
  name: string;
  price: string | number;
  compare_at_price: string | number | null;
  images: string[] | null;
  stock: number | null;
  has_variants?: boolean | null;
  created_at: string;
  seller_id: string | null;
  category_id: string | null;
  profiles?: SellerPublicProfile | null;
};

export interface DomandaGriglia {
  categoryId?: string;
  categoryIds?: string[];
  sellerId?: string;
  search?: string;
  sort: OrdineGriglia;
  maxPrice?: number;
  minPrice?: number;
  onlyInStock?: boolean;
  /** Negozi aperti adesso (già risolti dal chiamante) — assente = filtro spento. */
  apertiOra?: string[];
  /** Prodotti con voto almeno N (già risolti dal chiamante) — assente = filtro spento. */
  idsColVoto?: string[];
  /** Solo i prodotti pubblicati da questo istante in poi (ISO) — assente = filtro spento. */
  creatiDal?: string;
  /** Quante righe chiedere al database. */
  tetto: number;
  /**
   * 30/8/2026 (R080) — LA FINESTRA CHE SI SPOSTA, INVECE DEL TETTO CHE SI
   * ALLARGA.
   *
   * «Carica altri» rifaceva la stessa lettura con un tetto piu' alto: 96, poi
   * 192, poi 288, poi 384 — e buttava via il risultato di prima. Alla quarta
   * pressione erano state scaricate 960 righe, con le loro foto, per mostrarne
   * 384: traffico e attesa crescono col QUADRATO delle pressioni, sulla
   * connessione di chi guarda, e ogni pressione e' piu' lenta della precedente.
   *
   * Con la finestra ogni pressione chiede le sue righe e basta. Estremi
   * inclusi, come `.range()` di PostgREST.
   *
   * Nota che non va saltata: una finestra con un ordinamento non deterministico
   * puo' saltare o ripetere righe fra una pagina e l'altra — per questo
   * l'identificativo e' sempre il secondo criterio d'ordine, qui sotto.
   */
  finestra?: readonly [number, number];
}

const COLONNE = 'id, name, price, compare_at_price, images, stock, has_variants, created_at, seller_id, category_id';

/**
 * 17/11/2026 (R02-012) — «CARICA ALTRI» SI FERMAVA SE IL FILTRO IN FONDO SCARTAVA RIGHE.
 *
 * La pagina si chiede al database piena (la `finestra`), poi in fondo a `leggiProdottiDellaGriglia`
 * si tolgono le righe dei negozi fuori vetrina. Chi sfoglia decideva «è l'ultima» contando le righe
 * tornate: una pagina piena con una riga scartata sembrava l'ultima, e «Carica altri» spariva con
 * altri prodotti ancora da vedere. Ora le righe LETTE viaggiano attaccate alla pagina
 * (`righeLette`, non enumerabile: non entra nei confronti, nei cicli né nel JSON) e chi sfoglia
 * decide su quelle. Dove manca (una pagina ricopiata da altri) vale la lunghezza, come prima.
 */
export type PaginaGriglia = RigaGriglia[] & { readonly righeLette?: number };

/**
 * 13/11/2026 (R15-011) — LA FINESTRA DELLE NOVITÀ.
 *
 * «Novità» era il catalogo intero ordinato per data. Una novità è un prodotto «Nuovo» come lo
 * dice la scheda (`NEW_PRODUCT_DAYS`, 14 giorni): l'inizio della finestra si arrotonda all'ora
 * perché finisce nella chiave della cache e non deve cambiare a ogni render.
 */
export function inizioFinestraNovita(adesso: Date = new Date(), giorni: number = NEW_PRODUCT_DAYS): string {
  const dal = new Date(adesso.getTime() - giorni * 86_400_000);
  dal.setUTCMinutes(0, 0, 0);
  return dal.toISOString();
}

/** Quanti risultati chiedere alla ricerca del database: mai più della finestra a schermo. */
const TETTO_PERTINENZA = 200;

/**
 * Gli id dei prodotti più pertinenti, in ordine di pertinenza. Lista vuota = «non lo so»: chi
 * chiama ripiega su `ilike`, che è meno bravo ma non lascia nessuno a mani vuote.
 */
async function idsPiuPertinenti(supabase: SupabaseClient, termine: string, tetto: number): Promise<string[]> {
  const { data, error } = await supabase.rpc('search_products_smart', {
    q: termine,
    lim: Math.min(tetto, TETTO_PERTINENZA),
  });
  // Se la funzione non c'è (migrazione non applicata) o la rete cade, non si lascia la pagina
  // vuota: si torna al ripiego di prima.
  if (error) return [];
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
}

/** I filtri che la lettura e il conteggio devono applicare uguali. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applicaFiltriComuni<Q extends { in: any; eq: any; lte: any; gte: any; or: any }>(
  q: Q,
  d: Pick<DomandaGriglia, 'sellerId' | 'maxPrice' | 'minPrice' | 'onlyInStock' | 'apertiOra' | 'creatiDal'>,
  categorie: string[] | null,
): Q {
  if (categorie) q = q.in('category_id', categorie);
  if (d.sellerId) q = q.eq('seller_id', d.sellerId);
  if (d.maxPrice !== undefined) q = q.lte('price', d.maxPrice);
  if (d.minPrice !== undefined) q = q.gte('price', d.minPrice);
  // #91 — «Solo disponibili» lo decide il database. Attenzione: `stock` a NULL vuol dire
  // disponibilità illimitata.
  if (d.onlyInStock) q = q.or('stock.is.null,stock.gt.0');
  if (d.apertiOra !== undefined) q = q.in('seller_id', d.apertiOra);
  if (d.creatiDal) q = q.gte('created_at', d.creatiDal);
  return q;
}

/**
 * 3/9/2026 — SCEGLIERE «ALIMENTARI» NASCONDEVA IL PANE.
 *
 * Le categorie sono a due piani: nove madri e sessantatré figlie, e la parentela sta SOLO nella
 * tabella `categories` (`parent_id`). Chi filtrava per una madre — dal filtro della ricerca, dalla
 * pagina di una categoria — arrivava qui con un identificativo solo, e la lettura faceva
 * `category_id = quella madre` secco: il pane classificato in «Panificio» non usciva, e la pagina
 * diceva «nessun risultato» su una categoria piena. Merce che c'è e non si trova: l'ordine lo perde
 * il negozio, e nessuno se ne accorge.
 *
 * La cura sta QUI e non in chi chiama, perché a chiamare sono sette punti diversi (il filtro della
 * ricerca, la griglia della categoria, le vetrine per sottocategoria, «Altri prodotti», «Ti
 * potrebbe interessare», i prodotti simili della scheda, i regali): messa in uno solo, la malattia
 * resterebbe possibile negli altri sei.
 *
 * Costa una lettura in più, piccola e solo quando il filtro categoria è acceso: si chiedono gli
 * identificativi delle figlie di UNA categoria, non l'albero intero. Se quella lettura fallisce si
 * resta al comportamento di prima — la madre da sola — invece di lasciare la griglia vuota.
 */
async function conLeSueSottocategorie(supabase: SupabaseClient, id: string): Promise<string[]> {
  const { data, error } = await supabase.from('categories').select('id').eq('parent_id', id);
  if (error) return [id];
  const figlie = ((data ?? []) as Array<{ id: string }>).map((r) => r.id).filter(Boolean);
  return [id, ...figlie];
}

/**
 * 17/11/2026 (R02-010) — IL TAGLIO SUI PRODOTTI RECENSITI, A BLOCCHI.
 *
 * «Più recensiti» e il filtro «voto minimo» arrivano qui con l'elenco degli id che hanno il voto
 * (`idsColVoto`), e quell'elenco finiva in UN `.in('id', …)`: nell'indirizzo, come dice
 * `lib/supabase/blocchi.ts`. Sopra un paio di centinaia di prodotti recensiti l'indirizzo sfonda,
 * il server risponde 414 e la griglia va in errore. Fino a un blocco la domanda resta quella di
 * sempre; oltre, ogni blocco chiede le prime righe fino alla fine della finestra, le righe si
 * riuniscono, si rimettono nello stesso ordine che darebbe il database (lo stesso di `base()` qui
 * sotto: prezzo o data, poi l'id) e si taglia la finestra chiesta.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DomandaOrdinata = any;
type RispostaRighe = { data: RigaGriglia[] | null; error: { message?: string } | null };

function nellOrdineDelDatabase(sort: OrdineGriglia): (a: RigaGriglia, b: RigaGriglia) => number {
  const perPrezzo = sort === 'price_asc' || sort === 'price_desc';
  const crescente = sort === 'price_asc';
  const confronta = (x: string | number, y: string | number) => (x === y ? 0 : x < y ? -1 : 1);
  return (a, b) => {
    const primo = perPrezzo ? confronta(Number(a.price), Number(b.price)) : confronta(a.created_at, b.created_at);
    if (primo !== 0) return crescente ? primo : -primo;
    return -confronta(a.id, b.id);
  };
}

async function leggiFraGliIdsColVoto(
  domanda: () => DomandaOrdinata,
  ids: readonly string[],
  sort: OrdineGriglia,
  da: number,
  a: number,
  conFinestra: boolean,
): Promise<RispostaRighe> {
  if (ids.length <= DIMENSIONE_BLOCCO) {
    const q = domanda().in('id', ids);
    return conFinestra ? q.range(da, a) : q.limit(a + 1);
  }
  const unici = [...new Set(ids)];
  const { data, error } = await leggiInBlocchi<RigaGriglia>(
    unici,
    (blocco) => domanda().in('id', blocco).limit(a + 1) as PromiseLike<RispostaRighe>,
  );
  if (error) return { data: null, error };
  return { data: data.sort(nellOrdineDelDatabase(sort)).slice(da, a + 1), error: null };
}

export async function leggiProdottiDellaGriglia(
  supabase: SupabaseClient,
  d: DomandaGriglia,
): Promise<PaginaGriglia> {
  const termine = d.search ? d.search.replace(/[%_]/g, '\\$&').slice(0, 100) : undefined;

  // La pertinenza la sa solo il database: la si chiede prima, e poi si vanno a prendere le righe
  // intere (la funzione non restituisce giacenza, varianti e prezzo barrato, che servono alla scheda).
  let perPertinenza: string[] | null = null;
  if (termine && d.sort === 'relevance' && d.search) {
    // Con la finestra servono abbastanza identificativi da coprirla: chiederne
    // quanti ne sta in una pagina sola lascerebbe vuota la seconda.
    const quanti = d.finestra ? d.finestra[1] + 1 : d.tetto;
    const ids = await idsPiuPertinenti(supabase, d.search.slice(0, 100), quanti);
    perPertinenza = ids.length > 0 ? ids : null;
  }

  // Se il chiamante ha già risolto un insieme vuoto, la risposta è vuota senza chiedere niente.
  if (d.apertiOra !== undefined && d.apertiOra.length === 0) return [];
  if (d.idsColVoto !== undefined && d.idsColVoto.length === 0) return [];

  const soloConVoto = d.idsColVoto !== undefined ? new Set(d.idsColVoto) : null;
  if (perPertinenza && soloConVoto) {
    perPertinenza = perPertinenza.filter((id) => soloConVoto.has(id));
    if (perPertinenza.length === 0) return [];
  }

  /**
   * Le categorie da leggere, risolte UNA volta: `base()` viene richiamata per ogni blocco di
   * identificativi sul ramo pertinenza, e una lettura dentro di lei sarebbe un viaggio di rete per
   * blocco. `categoryIds` ha la precedenza su `categoryId` e NON allarga alle figlie: chi lo passa
   * decide lui l'elenco esatto. Lo fanno due pagine, per due motivi opposti: Regali (già con le
   * figlie delle categorie regalabili dentro) e «Altri prodotti» della pagina categoria (solo la
   * madre, apposta, perché le figlie hanno già la loro fila e ogni prodotto uscirebbe due volte).
   */
  const categorieDaLeggere =
    d.categoryIds && d.categoryIds.length > 0
      ? d.categoryIds
      : d.categoryId
        ? await conLeSueSottocategorie(supabase, d.categoryId)
        : null;

  const base = () => {
    let q = supabase.from('products').select(COLONNE).eq('status', 'available');

    switch (d.sort) {
      case 'price_asc':  q = q.order('price', { ascending: true }); break;
      case 'price_desc': q = q.order('price', { ascending: false }); break;
      default:           q = q.order('created_at', { ascending: false });
    }
    // 30/8/2026 (R080) — Il secondo criterio d'ordine non e' un dettaglio: con
    // due prodotti allo stesso prezzo (o pubblicati nello stesso istante)
    // l'ordine fra loro lo decide il database come gli pare, e puo' deciderlo
    // in modo diverso a ogni lettura. Su una finestra che si sposta vuol dire
    // una riga saltata o una riga vista due volte fra una pagina e l'altra.
    q = q.order('id', { ascending: false });

    q = applicaFiltriComuni(q, d, categorieDaLeggere);
    // Col ramo pertinenza il filtro sul testo l'ha già fatto il database, meglio di così.
    if (termine && !perPertinenza) q = q.ilike('name', `%${termine}%`);
    // Il taglio sugli id col voto NON sta qui: lo mette `leggiFraGliIdsColVoto`, a blocchi (R02-010).
    return q;
  };

  let rows: RigaGriglia[];
  if (perPertinenza) {
    // A blocchi da cento: duecento identificativi in un indirizzo solo lo farebbero sfondare (#93).
    const { data, error } = await leggiInBlocchi<RigaGriglia>(
      perPertinenza,
      (blocco) => base().in('id', blocco) as unknown as PromiseLike<{ data: RigaGriglia[] | null; error: { message?: string } | null }>,
    );
    if (error) throw error;
    const rango = new Map(perPertinenza.map((id, i) => [id, i]));
    const ordinati = data.sort(
      (a, b) => (rango.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rango.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
    /**
     * 5/11/2026 — LA PERTINENZA SI CHIEDE SU TUTTO IL SITO, I FILTRI SI APPLICANO DOPO.
     * `search_products_smart` non conosce negozio, categoria e prezzo: restituisce i primi 200 di
     * tutto il catalogo, e dentro la vetrina di un negozio (o con una categoria) quelli del negozio
     * potevano restare fuori dal taglio — «nessun risultato» con il prodotto lì. Quando c'è un
     * filtro che stringe, sotto i pertinenti si aggiungono quelli che hanno la parola nel nome
     * (la vecchia strada), senza doppioni.
     */
    const filtroCheStringe =
      !!d.sellerId || !!categorieDaLeggere || d.minPrice !== undefined || d.maxPrice !== undefined || d.apertiOra !== undefined;
    if (termine && filtroCheStringe) {
      const perNome = () => base().ilike('name', `%${termine}%`);
      // Fino alla fine della finestra chiesta, non una pagina sola: «Carica altri» deve arrivarci.
      const fine = d.finestra ? d.finestra[1] + 1 : d.tetto;
      const { data: altri, error: errNome } = soloConVoto
        ? await leggiFraGliIdsColVoto(perNome, d.idsColVoto!, d.sort, 0, fine - 1, false)
        : await perNome().limit(fine);
      if (errNome) throw errNome;
      const gia = new Set(ordinati.map((r) => r.id));
      for (const r of (altri ?? []) as unknown as RigaGriglia[]) if (!gia.has(r.id)) ordinati.push(r);
    }
    // Sul ramo pertinenza l'ordine lo decide la funzione del database, quindi
    // la finestra si taglia qui: e' lo stesso elenco, preso dal punto giusto.
    rows = d.finestra
      ? ordinati.slice(d.finestra[0], d.finestra[1] + 1)
      : ordinati.slice(0, d.tetto);
  } else {
    const { data, error } = soloConVoto
      ? await leggiFraGliIdsColVoto(base, d.idsColVoto!, d.sort, d.finestra ? d.finestra[0] : 0, d.finestra ? d.finestra[1] : d.tetto - 1, !!d.finestra)
      : d.finestra
        ? await base().range(d.finestra[0], d.finestra[1])
        : await base().limit(d.tetto);
    if (error) throw error;
    rows = (data ?? []) as unknown as RigaGriglia[];
  }

  const sellerMap = await fetchSellerPublicMap(
    supabase,
    rows.map((p) => p.seller_id as string),
    'id, store_name, store_hours, is_approved',
  );
  const tenute = attachSellerProfiles(rows, sellerMap).filter((p) => p.profiles?.is_approved) as RigaGriglia[];
  // R02-012 — Quante ne ha date il database, prima del filtro: è su queste che si sa se ce ne sono altre.
  Object.defineProperty(tenute, 'righeLette', { value: rows.length, enumerable: false });
  return tenute;
}

/**
 * 13/11/2026 (R15-011) — QUANTI SONO DAVVERO, NON QUANTI NE SONO ARRIVATI.
 *
 * Il numero sopra la griglia contava le schede già caricate (96, poi 192…): su 345 prodotti
 * diceva «96». Qui il database conta tutti quelli che passano gli stessi filtri della lettura
 * (senza la pertinenza: con un testo si conta per nome). `null` = non lo so: chi chiama ripiega
 * sulle schede caricate invece di scrivere «0».
 *
 * 17/11/2026 (R02-011) — E SOLO QUELLI CHE LA GRIGLIA PUÒ MOSTRARE. La lettura tiene solo i
 * prodotti dei negozi che la vista pubblica restituisce (il filtro su `is_approved` in fondo a
 * `leggiProdottiDellaGriglia`); il conteggio no, e sopra «Novità» il numero poteva superare le
 * schede che si vedono. Qui il prodotto si aggancia con `!inner` alla stessa vista, come le storie
 * in home (R16-019): il database conta solo quelli col negozio in vetrina. Se il servizio dati non
 * conosce l'aggancio (PGRST200/PGRST201) si conta come prima, invece di dire «non lo so».
 */
const COLONNE_CONTEGGIO_COL_NEGOZIO = 'id, negozio:seller_public_profiles!inner(id)';

export async function contaProdottiDellaGriglia(
  supabase: SupabaseClient,
  d: Omit<DomandaGriglia, 'sort' | 'tetto' | 'finestra'>,
): Promise<number | null> {
  if (d.apertiOra !== undefined && d.apertiOra.length === 0) return 0;
  if (d.idsColVoto !== undefined && d.idsColVoto.length === 0) return 0;
  const categorie =
    d.categoryIds && d.categoryIds.length > 0
      ? d.categoryIds
      : d.categoryId
        ? await conLeSueSottocategorie(supabase, d.categoryId)
        : null;
  const termine = d.search ? d.search.replace(/[%_]/g, '\\$&').slice(0, 100) : undefined;
  const conta = (colonne: string, blocco?: string[]) => {
    let q = supabase.from('products').select(colonne, { count: 'exact', head: true }).eq('status', 'available');
    q = applicaFiltriComuni(q, d, categorie);
    if (termine) q = q.ilike('name', `%${termine}%`);
    if (blocco) q = q.in('id', blocco);
    return q;
  };
  // R02-010 — Il taglio sugli id col voto a blocchi anche qui: i blocchi non si sovrappongono
  // (id unici), quindi i conti si sommano.
  const blocchi = d.idsColVoto !== undefined ? inBlocchi([...new Set(d.idsColVoto)]) : [undefined];
  const contaTutti = async (colonne: string): Promise<{ totale: number | null; codice?: string }> => {
    let totale = 0;
    for (const blocco of blocchi) {
      const { count, error } = await conta(colonne, blocco);
      if (error) return { totale: null, codice: (error as { code?: string }).code };
      if (count == null) return { totale: null };
      totale += count;
    }
    return { totale };
  };
  const colNegozio = await contaTutti(COLONNE_CONTEGGIO_COL_NEGOZIO);
  if (colNegozio.codice === 'PGRST200' || colNegozio.codice === 'PGRST201') {
    logger.warn('[griglia] aggancio alla vista dei negozi non riconosciuto: conteggio senza il filtro sul negozio', { codice: colNegozio.codice });
    return (await contaTutti('id')).totale;
  }
  return colNegozio.totale;
}
