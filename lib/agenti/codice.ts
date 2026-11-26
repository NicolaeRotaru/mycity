// Il codice del link d'invito degli agenti: la forma, e dove sta. Senza dipendenze, così lo legge anche il browser.
//
// Il link è <sito>/invito-agente#<codice>. Il codice sta dopo il «#» perché quella parte il browser non la manda
// a nessun server: non finisce nei registri di Vercel, nelle statistiche delle pagine viste, né nell'intestazione
// Referer verso altri siti (collaudo del 26/11/2026: col codice nel percorso finiva in tutti e tre).
// La pagina lo legge, lo tiene nella memoria della scheda del browser (sessionStorage) e lo toglie dalla barra.

export const CODICE_INVITO = /^[A-Za-z0-9_-]{43}$/;
export const PERCORSO_INVITO = '/invito-agente';
/** Dove la pagina tiene il codice mentre la persona entra col suo account (resta nella scheda, non va al server). */
export const CHIAVE_CODICE = 'mycity.invito-agente';
