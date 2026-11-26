// Il codice del link d'invito degli agenti: la forma, e dove sta. Senza dipendenze, così lo legge anche il browser.
//
// Il link è <sito>/invito-agente#<codice>. Il codice sta dopo il «#» perché quella parte il browser non la manda
// a nessun server: non finisce nei registri di Vercel, nelle statistiche delle pagine viste, né nell'intestazione
// Referer verso altri siti (collaudo del 26/11/2026: col codice nel percorso finiva in tutti e tre).
// La pagina lo legge, lo tiene nella memoria del browser per un giorno (serve mentre la persona crea l'account e
// conferma l'email, anche se la conferma si apre in un'altra scheda) e lo toglie dalla barra.

export const CODICE_INVITO = /^[A-Za-z0-9_-]{43}$/;
export const PERCORSO_INVITO = '/invito-agente';
/** Dove la pagina tiene il codice mentre la persona crea l'account o entra (resta nel browser, non va al server). */
export const CHIAVE_CODICE = 'mycity.invito-agente';
/** Dopo un giorno il codice tenuto si dimentica: su un telefono prestato non resta a lungo. */
export const DURATA_CODICE_MS = 24 * 3600 * 1000;
