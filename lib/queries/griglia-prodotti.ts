import type { SupabaseClient } from '@supabase/supabase-js';
import { attachSellerProfiles, fetchSellerPublicMap, type SellerPublicProfile } from '@/lib/queries/seller-public-profiles';
import { leggiInBlocchi } from '@/lib/supabase/blocchi';

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

export async function leggiProdottiDellaGriglia(
  supabase: SupabaseClient,
  d: DomandaGriglia,
): Promise<RigaGriglia[]> {
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

    if (d.categoryIds && d.categoryIds.length > 0) q = q.in('category_id', d.categoryIds);
    else if (d.categoryId) q = q.eq('category_id', d.categoryId);
    if (d.sellerId) q = q.eq('seller_id', d.sellerId);
    // Col ramo pertinenza il filtro sul testo l'ha già fatto il database, meglio di così.
    if (termine && !perPertinenza) q = q.ilike('name', `%${termine}%`);
    if (d.maxPrice !== undefined) q = q.lte('price', d.maxPrice);
    if (d.minPrice !== undefined) q = q.gte('price', d.minPrice);
    // #91 — «Solo disponibili» lo decide il database. Attenzione: `stock` a NULL vuol dire
    // disponibilità illimitata.
    if (d.onlyInStock) q = q.or('stock.is.null,stock.gt.0');
    if (d.apertiOra !== undefined) q = q.in('seller_id', d.apertiOra);
    if (soloConVoto && !perPertinenza) q = q.in('id', d.idsColVoto!);
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
    // Sul ramo pertinenza l'ordine lo decide la funzione del database, quindi
    // la finestra si taglia qui: e' lo stesso elenco, preso dal punto giusto.
    rows = d.finestra
      ? ordinati.slice(d.finestra[0], d.finestra[1] + 1)
      : ordinati.slice(0, d.tetto);
  } else {
    const { data, error } = d.finestra
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
  return attachSellerProfiles(rows, sellerMap).filter((p) => p.profiles?.is_approved) as RigaGriglia[];
}
