import { spezzaTenendo } from '@/lib/testo/scansioni-lineari';

/**
 * Il motivo del rinvio dice «(pagina /contact)» e a volte un indirizzo email: nella pagina delle
 * impostazioni diventano collegamenti. Qui il testo si divide in pezzi, alternando il testo nudo
 * (pari) alla pagina o all'email trovata (dispari), come `split` con un gruppo che cattura.
 *
 * «/contact» conta solo se prima non c'è una lettera, una cifra, «/», «.» o «:» (non è un pezzo di
 * un indirizzo) e dopo non c'è una lettera, una cifra, «/» o «-». Il «prima» lo guarda
 * `inizioNelMotivo`, senza lookbehind (Safari prima della 16.4 non lo legge e la pagina non si
 * caricherebbe); l'email si prova solo dove comincia una sequenza dei suoi caratteri, così un testo
 * lungo non si ripercorre da ogni carattere.
 */
const PAGINA_O_EMAIL_NEL_MOTIVO = /\/contact(?![\w/-])|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/y;
const PRIMA_DELLA_PAGINA_NO = /[\w/.:]/;
const CARATTERE_DELL_EMAIL = /[A-Za-z0-9._%+-]/;

export function pezziDelMotivo(testo: string): string[] {
  const inizioNelMotivo = (i: number, fineDellUltima: number): boolean =>
    testo[i] === '/'
      ? i === 0 || !PRIMA_DELLA_PAGINA_NO.test(testo[i - 1])
      : i === 0 || i === fineDellUltima || !CARATTERE_DELL_EMAIL.test(testo[i - 1]);
  return spezzaTenendo(testo, PAGINA_O_EMAIL_NEL_MOTIVO, inizioNelMotivo);
}
