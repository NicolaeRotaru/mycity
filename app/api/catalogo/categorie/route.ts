import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { domandaCategorie, type ClientDiLettura } from '@/lib/queries/catalogo';
import { rispostaCatalogoNonRiuscita, rispostaCatalogoPubblico } from '@/lib/queries/cache-pubblica';
import { logger } from '@/lib/logger';

/**
 * LE CATEGORIE DELLA HOME, LETTE UNA VOLTA PER TUTTI.
 *
 * 3/9/2026 — la stessa domanda («dammi le categorie principali») la rifaceva
 * ogni singolo browser che apriva il sito, e la risposta era identica per tutti:
 * dieci righe che cambiano una volta al mese. Qui la lettura passa dal server e
 * la risposta se ne va con l'intestazione che dice «vale sessanta secondi»:
 * chiunque stia in mezzo — la rete di consegna davanti al sito, il browser — la
 * riusa invece di rifarla.
 *
 * Non c'è niente di personale qui dentro: nessun cookie, nessuna sessione,
 * nessun nome. È la condizione per poterla mettere in una cache condivisa, e va
 * riletta ogni volta che si aggiunge una colonna a questa risposta.
 *
 * La domanda è la STESSA che fanno la pagina e il precarico del server — vive in
 * `lib/queries/catalogo.ts` — perché se la forma della risposta differisse anche
 * di poco il browser non riconoscerebbe quello che ha già in mano e rileggerebbe
 * tutto lo stesso.
 */
export async function GET(): Promise<Response> {
  try {
    const supa = creaClientAnonimo() as unknown as ClientDiLettura;
    const categorie = await domandaCategorie(supa).queryFn();
    return rispostaCatalogoPubblico(categorie);
  } catch (e) {
    // Chi chiama sa cadere sulla lettura diretta: qui si dice solo che non è
    // andata, e soprattutto non si mette in cache il guasto.
    logger.warn('[api/catalogo/categorie] lettura non riuscita', e);
    return rispostaCatalogoNonRiuscita();
  }
}
