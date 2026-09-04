/**
 * Restituisce un path interno sicuro per redirect post-login/post-azione.
 * Blocca:
 *  - URL assoluti http(s)://
 *  - URL protocol-relative //
 *  - URL con backslash (alcuni browser le normalizzano in /)
 *  - URL non stringa
 * Fallback al path di default.
 *
 * 3/9/2026 — UN CARATTERE INVISIBILE PORTAVA IL CLIENTE SU UN SITO ESTERNO.
 *
 * Qui si bloccavano gli indirizzi assoluti, il doppio slash e la barra
 * rovesciata, ma NON la tabulazione, il ritorno a capo e l'a capo. Il lettore di
 * indirizzi dei browser e di Node cancella quei tre caratteri PRIMA di
 * interpretare: cosi' `/<TAB>/sito-truffa.it` usciva di qui intatto e, appena
 * risolto contro il nostro dominio (`new URL(next, env.appUrl())` in
 * app/auth/callback/route.ts), diventava `https://sito-truffa.it`.
 *
 * Il link parte dal dominio vero: `https://mycity-marketplace.com/sign-in?returnTo=/%09/sito-truffa.it`.
 * La signora Rossi lo apre da WhatsApp, vede il nostro indirizzo nella barra,
 * mette email e password sul NOSTRO modulo, e subito dopo si ritrova su una
 * copia del sito che le richiede la password «per confermare». E' il primo
 * anello del furto d'account: vale per i clienti e vale per i negozianti, che
 * sull'account hanno il conto dove arrivano i soldi.
 *
 * LA CAUSA. Il filtro ragionava sui caratteri della stringa mentre la decisione
 * finale la prende il lettore di indirizzi, che quei caratteri li cancella:
 * filtro e consumatore non guardavano la stessa stringa. Finche' il controllo e'
 * «la stringa non comincia con //», ogni carattere che il lettore normalizza e'
 * un buco nuovo — la barra rovesciata era gia' stata tappata cosi' una volta.
 *
 * LA RIPARAZIONE, in tre mosse:
 *  ① si toglie quello che il lettore toglierebbe (tabulazione, ritorno a capo,
 *    a capo), cosi' da qui in poi si ragiona sulla STESSA stringa che vedra' il
 *    consumatore;
 *  ② se restano altri caratteri di controllo, si rifiuta invece di indovinare;
 *  ③ il verdetto finale non e' piu' una lista di prefissi vietati, ma la sola
 *    domanda che conta: risolto contro un dominio qualunque, questo percorso
 *    resta su quel dominio? Se cambia casa, e' un indirizzo esterno travestito.
 */

/** Dominio finto: serve solo a chiedere al lettore di indirizzi se il percorso resta in casa. */
const CASA = 'https://interno.invalid';

export function safeInternalPath(input: unknown, fallback = '/'): string {
  if (typeof input !== 'string') return fallback;

  // ① Quello che il lettore di indirizzi cancella, lo cancelliamo prima noi:
  //    tabulazione (09), a capo (0A), ritorno a capo (0D). Da qui in avanti la
  //    stringa che controlliamo e' identica a quella che verra' interpretata.
  const pulito = input.replace(/[\t\n\r]/g, '').trim();

  if (pulito.length === 0) return fallback;
  if (pulito.length > 512) return fallback;

  // ② Altri caratteri di controllo: non si indovina cosa ne farebbe il lettore.
  if (/[\u0000-\u001F\u007F]/.test(pulito)) return fallback;

  // Deve iniziare con singolo slash
  if (!pulito.startsWith('/')) return fallback;
  // Blocca protocol-relative // e backslash
  if (pulito.startsWith('//') || pulito.startsWith('/\\')) return fallback;
  // Blocca schemi noti (finiscono anche dentro un href, non solo in un redirect)
  if (/^\/?(javascript|data|vbscript|file):/i.test(pulito)) return fallback;

  // ③ La domanda che conta: risolto contro una casa qualunque, ci resta?
  try {
    if (new URL(pulito, CASA).origin !== CASA) return fallback;
  } catch {
    return fallback;
  }

  return pulito;
}
