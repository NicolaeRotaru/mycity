import { domandaCategorie, type CategoriaDiTesta, type ClientDiLettura } from '@/lib/queries/catalogo';
import { logger } from '@/lib/logger';
import { SECONDI_CATALOGO_FRESCO, SECONDI_CATALOGO_RIPIEGO } from '@/lib/queries/cache-pubblica';

/** Dove il browser chiede le categorie: una rotta pubblica, con la sua scadenza. */
export const PERCORSO_CATEGORIE_PUBBLICHE = '/api/catalogo/categorie';

/**
 * LE CATEGORIE, CHIESTE UNA VOLTA PER TUTTI.
 *
 * 3/9/2026 — la stessa domanda la faceva ogni browser che apriva il sito, e la
 * risposta era identica per chiunque: le categorie principali cambiano forse una
 * volta al mese. Cento visite nello stesso minuto erano cento letture al
 * database per ottenere cento volte le stesse dieci righe.
 *
 * Adesso passa da `/api/catalogo/categorie`, che risponde con l'intestazione
 * «vale sessanta secondi»: chi sta in mezzo — la rete di consegna davanti al
 * sito, il browser stesso — la riusa invece di rifarla.
 *
 * LA CHIAVE NON CAMBIA. È la stessa di `domandaCategorie`, perché il server
 * precarica le categorie dentro la pagina: se la chiave fosse diversa il browser
 * non riconoscerebbe quello che ha già in mano e rileggerebbe tutto lo stesso —
 * un viaggio in più invece di uno in meno, e nessuno se ne accorgerebbe.
 *
 * SE LA ROTTA NON RISPONDE si legge come si leggeva prima, dal database. Una
 * cache è un'ottimizzazione: il giorno che si rompe deve tornare lenta, non
 * rotta.
 */
export function domandaCategoriePubbliche(supa: ClientDiLettura) {
  const diretta = domandaCategorie(supa);
  return {
    queryKey: diretta.queryKey,
    /**
     * 5/11/2026 — Il precarico della home vive in memoria sul server fino a 60 secondi più 300 di
     * ripiego, e arriva col suo orario di lettura; il browser considerava vecchio un dato oltre i
     * 30 secondi e lo richiedeva appena partito, buttando via il lavoro del server. Le categorie
     * cambiano forse una volta al mese: valgono quanto la memoria del server.
     */
    staleTime: (SECONDI_CATALOGO_FRESCO + SECONDI_CATALOGO_RIPIEGO) * 1000,
    queryFn: async (): Promise<CategoriaDiTesta[]> => {
      try {
        const risposta = await fetch(PERCORSO_CATEGORIE_PUBBLICHE);
        if (risposta.ok) return (await risposta.json()) as CategoriaDiTesta[];
        logger.warn('[categorie] la rotta in cache ha risposto', risposta.status);
      } catch (e) {
        logger.warn('[categorie] la rotta in cache non risponde: leggo dal database', e);
      }
      return diretta.queryFn();
    },
  };
}
