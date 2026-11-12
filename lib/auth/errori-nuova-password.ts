import { logger } from '@/lib/logger';

/**
 * 12/11/2026 (R10-016) — COSA SI DICE QUANDO LA NUOVA PASSWORD NON VA BENE.
 *
 * Stava dentro app/reset-password/page.tsx come `translateError`, e ogni testo con «weak»
 * riceveva lo stesso consiglio: «Usane una più lunga, con maiuscole/numeri/simboli». Ma
 * Supabase rifiuta come «weak» anche una password lunga e complicata che compare negli
 * elenchi di password rubate (`AuthWeakPasswordError`, reasons: ['pwned']): il consiglio
 * era sbagliato, la persona allungava la stessa password e veniva rifiutata di nuovo.
 * Adesso si legge il motivo. Qui sta fuori dalla pagina perché una prova lo possa eseguire.
 */

/** L'errore come arriva da Supabase: il messaggio e, per le password deboli, i motivi. */
export type ErroreDiSupabase = { message?: unknown; code?: unknown; reasons?: unknown } | null | undefined;

export const PASSWORD_RUBATA =
  'Questa password compare negli elenchi di password rubate in rete: scegline un’altra, che non usi già da nessuna parte.';
export const PASSWORD_CORTA = 'La password è troppo corta: usane una di almeno 8 caratteri.';
/** Revisione qa: il minimo lo dice il server nel messaggio; 8 e' solo il ripiego. */
const passwordCorta = (minimo: number | null) =>
  minimo && minimo !== 8 ? `La password è troppo corta: usane una di almeno ${minimo} caratteri.` : PASSWORD_CORTA;
export const PASSWORD_SEMPLICE = 'La password è troppo semplice: aggiungi maiuscole, numeri o simboli.';

export function traduciErroreNuovaPassword(errore: ErroreDiSupabase): string {
  const msg = typeof errore?.message === 'string' ? errore.message : '';
  const m = msg.toLowerCase();
  const motivi = Array.isArray(errore?.reasons) ? errore.reasons.map((r) => String(r)) : [];

  if (m.includes('same as') || m.includes('should be different'))
    return 'La nuova password deve essere diversa da quella precedente';
  // Prima i motivi (li manda Supabase con l'errore), poi le parole del messaggio.
  if (motivi.includes('pwned') || m.includes('pwned') || m.includes('known to be weak') || m.includes('leaked'))
    return PASSWORD_RUBATA;
  if (motivi.includes('length') || (m.includes('at least') && m.includes('characters') && !m.includes('one character'))) {
    const minimo = Number(m.match(/at least (\d+) characters/)?.[1] ?? NaN);
    return passwordCorta(Number.isFinite(minimo) ? minimo : null);
  }
  if (motivi.includes('characters') || m.includes('weak') || m.includes('should contain'))
    return PASSWORD_SEMPLICE;
  if (m.includes('expired') || m.includes('jwt'))
    return 'Sessione scaduta. Richiedi un nuovo link di reset qui sotto.';
  if (m.includes('invalid') && m.includes('token'))
    return 'Link di reset non valido. Richiedine uno nuovo qui sotto.';
  // Revisione qa: «For security purposes, you can only request this after 42 seconds» è la
  // risposta più comune a chi chiede di nuovo il link; e `includes('rate')` prendeva anche «generate».
  const secondi = m.match(/after (\d+) seconds?/)?.[1];
  if (secondi) return `Hai appena chiesto un link: puoi chiederne un altro fra ${secondi} secondi.`;
  if (/\brate limit|\btoo many\b|for security purposes/.test(m))
    return 'Troppi tentativi. Riprova fra qualche minuto.';
  if (m.includes('invalid') && m.includes('email'))
    return 'L’indirizzo email non sembra valido: controllalo e riprova.';
  if (m.includes('not authenticated') || m.includes('no session'))
    return 'Sessione persa. Apri di nuovo il link dall\'email.';
  /*
   * 6/9/2026 — Il messaggio grezzo serve a NOI: va nel registro (e da li' a Sentry), non a
   * schermo. La frase e' neutra e non nomina la password: la usano l'aggiornamento della
   * password e la richiesta di un nuovo link.
   */
  if (msg) {
    logger.error(new Error(msg), { context: 'reset-password:messaggio-non-tradotto' });
  }
  return 'Qualcosa non ha funzionato. Riprova, oppure richiedi un nuovo link qui sotto.';
}
