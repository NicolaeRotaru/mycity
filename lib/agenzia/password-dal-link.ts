/**
 * LA PASSWORD SCELTA NEL LINK DEL PREVENTIVO — 28/11/2026 verso le 13:30.
 *
 * Nicola, iscrivendo un bar dal telefono: il pulsante dell'email vale una volta sola, poi «Accedi» chiede email e
 * password, e il titolare una password non l'aveva mai scelta. Ora la sceglie nel link, sotto l'email.
 *
 * Le regole stanno qui, in un posto solo, perché le leggono in due: la pagina del link
 * (app/preventivo/[codice]/ConfermaAbbonamento.tsx, nel browser) e la porta che accetta
 * (app/api/preventivo/[codice]/accetta/route.ts). Questo file non importa niente del server.
 *  · almeno 8 caratteri, come la registrazione (app/sign-up/page.tsx);
 *  · al massimo 72: oltre, Supabase non la accetta.
 */

export const PASSWORD_MINIMA = 8;
export const PASSWORD_MASSIMA = 72;

/** Cosa legge il titolare quando Supabase rifiuta la password scelta nel link. */
export const PASSWORD_TROPPO_DEBOLE =
  'Questa password è troppo facile da indovinare. Scegline un’altra, di almeno 8 caratteri, con lettere e numeri, e conferma di nuovo.';
