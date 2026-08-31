/**
 * L'identificativo del BROWSER per Google Analytics, letto dal suo cookie.
 *
 * 30/8/2026 (R166) — DAL SERVER MANDAVAMO L'ID DELLA PERSONA AL POSTO DI QUELLO
 * DEL BROWSER.
 *
 * L'acquisto verso Google partiva con `client_id` uguale all'identificativo
 * dell'utente su Supabase — un UUID. Il Measurement Protocol di GA4 attacca
 * l'evento alla sessione web SOLO se `client_id` e' il valore del cookie `_ga`,
 * che ha la forma `numero.numero`. Con un UUID, Google non riconosce nessuna
 * sessione: nasce un utente nuovo, senza sorgente di traffico, e l'acquisto
 * finisce sotto «(direct)/(none)». Cioe' la campagna che ha portato la vendita
 * non se la vede attribuita — ed e' su quel numero che si decide il budget.
 *
 * Il cookie ce l'abbiamo: viaggia con la richiesta che crea l'ordine. Qui si
 * legge; chi conta lo rimanda uguale.
 *
 * Il cookie vale `GA1.1.<client>.<primo accesso>`, per esempio
 * `GA1.1.1234567890.1699999999`: il `client_id` sono le ultime due parti
 * attaccate col punto. Su alcuni domini la seconda cifra e' diversa
 * (`GA1.2.…`), quindi si prendono sempre le ultime due parti e non le si conta
 * dal principio.
 */

/** La forma che GA4 accetta come identificativo di browser: due numeri col punto. */
const FORMA_GA = /^\d{1,20}\.\d{1,20}$/;

/**
 * Il `client_id` di Google scritto nel cookie `_ga` di questa richiesta, oppure
 * `null` se il cookie non c'e' o non ha la forma giusta.
 *
 * `null` non e' un ripiego da riempire con qualcos'altro: senza il cookie NON
 * esiste nessun identificativo di browser, e inventarne uno vuol dire creare un
 * utente fantasma su Google. Chi chiama deve decidere sapendolo.
 */
export function clientIdGaDalCookie(intestazioneCookie: string | null | undefined): string | null {
  const testo = intestazioneCookie ?? '';
  const grezzo = testo.match(/(?:^|;\s*)_ga=([^;]+)/)?.[1]?.trim();
  if (!grezzo) return null;
  const pezzi = grezzo.split('.');
  if (pezzi.length < 2) return null;
  const candidato = pezzi.slice(-2).join('.');
  return FORMA_GA.test(candidato) ? candidato : null;
}

/**
 * Il `client_id` di una persona, ripulito, quando arriva da fuori (il corpo di
 * una richiesta, un'etichetta di Stripe): stesso metro del cookie.
 */
export function clientIdGaValido(valore: unknown): string | null {
  return typeof valore === 'string' && FORMA_GA.test(valore.trim()) ? valore.trim() : null;
}
