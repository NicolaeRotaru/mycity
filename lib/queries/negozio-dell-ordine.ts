import { logger } from '@/lib/logger';
import {
  fetchNomiPubblici,
  fetchSellerPublicMap,
  type LettoreVista,
  type SellerPublicProfile,
} from '@/lib/queries/seller-public-profiles';

/**
 * IL NEGOZIO DI UN ORDINE SI LEGGE DALLA VETRINA PUBBLICA, NON DA `profiles`.
 *
 * 18/10/2026 (seconda ondata, squadra ordini) — Le pagine degli ordini del
 * cliente («I miei ordini», il dettaglio, la recensione, il reclamo, la fascia
 * «Ordina di nuovo» in home) e quelle del fattorino agganciavano il negozio alla
 * tabella `profiles` dentro la lettura dell'ordine
 * (`seller:profiles!orders_seller_id_fkey ( … )`). Reggeva solo perche' in
 * produzione e' ancora viva la regola «chiunque legge i negozi approvati». Le
 * migrazioni 110, 112 e 161, in attesa di firma, la tolgono: da li' `profiles`
 * si legge solo per la propria riga. L'aggancio sarebbe tornato vuoto per il
 * cliente e per il fattorino: «Negozio» al posto del nome, niente telefono, e
 * per il fattorino nessun indirizzo dove andare a ritirare.
 *
 * Qui l'ordine porta solo il suo `seller_id`, e il negozio arriva dalla vista
 * `seller_public_profiles` (una domanda sola per tutte le righe), che risponde
 * uguale prima e dopo le migrazioni.
 *
 * Due cose diverse da `conNegozioApprovato` della vetrina:
 *  ① nessun ordine si perde: un ordine resta del cliente anche se il suo negozio
 *    nel frattempo e' stato sospeso. Il negozio che la vista non mostra torna
 *    `null`, e la pagina decide cosa dire;
 *  ② se la vista non risponde, l'errore sale: la pagina mostra il suo «Riprova»
 *    invece di disegnare un ordine senza negozio come se fosse la verita'.
 *
 * Le colonne chieste devono esistere anche nella vista di produzione, che non ha
 * le colonne d'impresa della migrazione 126: qui si chiedono solo insegna, logo,
 * telefono, indirizzo e coordinate.
 */

/** Il negozio come lo vedono le pagine degli ordini. */
export type NegozioDellOrdine = Pick<
  SellerPublicProfile,
  'id' | 'store_name' | 'store_logo' | 'store_phone' | 'store_address' | 'store_lat' | 'store_lng'
>;

/** Attacca a ogni riga il suo negozio, letto dalla vista pubblica. Nessuna riga si perde. */
export async function conNegozioDellOrdine<T extends { seller_id?: string | null }>(
  supa: LettoreVista,
  righe: T[],
  colonne: string,
): Promise<Array<T & { seller: NegozioDellOrdine | null }>> {
  if (righe.length === 0) return [];
  const negozi = await fetchSellerPublicMap(supa, righe.map((r) => r.seller_id), colonne);
  return righe.map((r) => ({ ...r, seller: (r.seller_id ? negozi.get(r.seller_id) : undefined) ?? null }));
}

/**
 * Come `conNegozioDellOrdine`, ma se la vista non risponde le righe restano, col negozio `null`.
 *
 * 18/10/2026 (riesame del lotto) — Per la bacheca del fattorino il negozio e' un dettaglio: la
 * bacheca porta anche l'interruttore online, gli incassi da confermare e gli ordini liberi, che
 * arrivano da altre letture. Se la sola vista cadeva, la bacheca intera passava allo stato
 * d'errore. Qui si tiene tutto il resto e si scrive l'avviso nei registri. Toccando la consegna,
 * la sua pagina rilegge e, se la vista e' ancora giu', dice «Non riesco a leggere la consegna» con
 * «Riprova». Le pagine dove il negozio e' il cuore (la consegna da ritirare, le pagine dell'ordine
 * del cliente) restano su `conNegozioDellOrdine`, che fa salire l'errore.
 */
export async function conNegozioSePossibile<T extends { seller_id?: string | null }>(
  supa: LettoreVista,
  righe: T[],
  colonne: string,
): Promise<Array<T & { seller: NegozioDellOrdine | null }>> {
  try {
    return await conNegozioDellOrdine(supa, righe, colonne);
  } catch (e) {
    logger.warn('[ordini] negozi non letti dalla vetrina: righe mostrate senza negozio', e);
    return righe.map((r) => ({ ...r, seller: null }));
  }
}

/**
 * Attacca a ogni riga il suo fattorino, col nome letto dalla vista `nomi_pubblici` (migrazione 164).
 *
 * 31/10/2026 (ondata 1) — Il nome si agganciava a `profiles` dentro la lettura dell'ordine
 * (`rider:profiles!orders_rider_id_fkey ( full_name )`): dopo le migrazioni 110, 112 e 161 il cliente
 * e il negozio leggevano «Il tuo rider» / «Rider assegnato», senza un errore. La forma resta
 * `{ full_name }` perche' le pagine la leggono gia' cosi'; dentro c'e' solo il nome di battesimo.
 * Nessuna riga si perde: un nome che non arriva e' `null`, e la pagina scrive la sua frase generica.
 */
export async function conFattorinoDellOrdine<T extends { rider_id?: string | null }>(
  supa: LettoreVista,
  righe: T[],
): Promise<Array<T & { rider: { full_name: string | null } | null }>> {
  if (righe.length === 0) return [];
  const nomi = await fetchNomiPubblici(supa, righe.map((r) => r.rider_id));
  return righe.map((r) => ({
    ...r,
    rider: r.rider_id ? { full_name: nomi.get(r.rider_id) ?? null } : null,
  }));
}
