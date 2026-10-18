import {
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
