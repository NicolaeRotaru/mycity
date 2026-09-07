/**
 * IL SEGNAPOSTO DELLE FOTO CHE MANCANO — servito da noi, non da un sito esterno.
 *
 * 6/9/2026 — Ogni prodotto senza foto faceva partire una richiesta vera a `placehold.co`, un
 * dominio di terzi che non era né preconnesso né nel nostro dominio: la prima immagine pagava una
 * risoluzione DNS più una stretta di mano TLS, e se quel servizio era lento o giù la griglia
 * restava coi buchi. Succedeva anche nel carrello e nel riepilogo della cassa, cioè sul percorso
 * d'acquisto, dove un buco al posto della foto è un dubbio in più prima di pagare.
 *
 * Questo file è un percorso locale: zero richieste esterne, niente che possa cadere, e il service
 * worker lo tiene già in cache (regola 3 di `public/sw.js`, che prende i nostri `.svg`). Il
 * caricatore delle foto lo lascia passare senza toccarlo, perché non comincia per `http`.
 */
export const FOTO_MANCANTE = '/foto-mancante.svg';
