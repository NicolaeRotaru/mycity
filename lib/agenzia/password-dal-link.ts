/**
 * LA PASSWORD SCELTA NEL LINK DEL PREVENTIVO — 28/11/2026 verso le 13:30.
 *
 * Nicola, iscrivendo un bar dal telefono: il pulsante dell'email vale una volta sola, poi «Accedi» chiede email e
 * password, e il titolare una password non l'aveva mai scelta. Ora la sceglie nel link, sotto l'email.
 *
 * Le regole stanno qui, in un posto solo, perché le leggono in due: la pagina del link
 * (app/preventivo/[codice]/ConfermaAbbonamento.tsx, nel browser) e la porta che accetta
 * (app/api/preventivo/[codice]/accetta/route.ts). Non importa niente del server: le frasi dei rifiuti di Supabase
 * vengono da lib/auth/errori-nuova-password.ts, che usa già la pagina /reset-password nel browser.
 *  · almeno 8 caratteri, come la registrazione (app/sign-up/page.tsx);
 *  · al massimo 72 BYTE, non caratteri: Supabase conta i byte (`len(password) > 72` in GoTrue) e sopra risponde
 *    400 `validation_failed`, non `weak_password`. Una «è» vale due byte: 40 «è» sono 40 caratteri e 80 byte
 *    (collaudo del 28/11). Per questo il tetto si misura qui coi byte, nella pagina e nella porta.
 */

import { PASSWORD_RUBATA, PASSWORD_SEMPLICE, traduciErroreNuovaPassword, type ErroreDiSupabase } from '@/lib/auth/errori-nuova-password';

export const PASSWORD_MINIMA = 8;
export const PASSWORD_MASSIMA = 72;

/** Quanti byte pesa la password per Supabase (UTF-8). */
export function byteDellaPassword(password: string): number {
  return new TextEncoder().encode(password).length;
}

/** Cosa legge il titolare quando la password supera il tetto di Supabase. */
export const PASSWORD_TROPPO_LUNGA = 'Questa password è troppo lunga: scegline una più corta, o con meno lettere accentate.';

/**
 * Cosa legge il titolare quando Supabase rifiuta la password scelta nel link. Si legge il motivo che manda
 * Supabase (password rubata, troppo corta, troppo semplice), con le stesse frasi di /reset-password e della
 * registrazione (lib/auth/errori-nuova-password.ts): un messaggio fisso faceva girare in tondo chi aveva una
 * password lunga ma rubata (collaudo del 28/11). Un rifiuto senza motivo leggibile vale «troppo semplice».
 */
export function fraseDellaPasswordRifiutata(errore: ErroreDiSupabase): string {
  const frase = traduciErroreNuovaPassword(errore);
  return eFraseDellaPassword(frase) ? frase : PASSWORD_SEMPLICE;
}

/** La pagina riconosce il rifiuto della password, per tornare al campo: sono solo queste frasi. */
export function eFraseDellaPassword(messaggio: string): boolean {
  return messaggio === PASSWORD_RUBATA || messaggio === PASSWORD_SEMPLICE || messaggio.startsWith('La password è troppo corta');
}
