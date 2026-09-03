import type { APIRequestContext } from '@playwright/test';

/**
 * 3/9/2026 — LA PAGINA ARRIVA, MA SENZA IL SUO JAVASCRIPT.
 *
 * Accendendo per la prima volta le prove nel browser dentro la CI (prima si
 * auto-saltavano per la mancanza di segreti mai creati) e' venuto fuori un
 * difetto che nessuna prova sul database poteva vedere.
 *
 * Il middleware genera un nonce nuovo a ogni richiesta e lo mette nella regola
 * di sicurezza dei contenuti: `script-src 'self' 'nonce-XYZ' 'strict-dynamic'`.
 * Con `strict-dynamic` il browser IGNORA `'self'` e gli indirizzi: passa solo
 * uno script che porta quel nonce. Next.js scrive il nonce nei tag `<script>`
 * mentre costruisce la pagina — cosa che puo' fare solo per le pagine calcolate
 * al momento della richiesta. Le pagine preparate in anticipo (nella lista del
 * costruttore hanno il pallino «Static») sono state scritte prima che quel
 * nonce esistesse, quindi i loro tag non ne hanno nessuno.
 *
 * Risultato in una build di produzione: il browser rifiuta OGNI script della
 * pagina, React non si attacca mai, la pagina resta il guscio disegnato dal
 * costruttore. Sono cosi' /sign-in, /sign-up, /stores, /search, /cart,
 * /shared-cart e /checkout — cioe' l'accesso e tutta la cassa.
 *
 * In sviluppo non succede: li' la regola ammette gli script in linea, e per
 * questo nessuno se n'era accorto.
 *
 * A COSA SERVE QUESTO FILE. Alcune prove nel browser chiedono cose che
 * esistono solo dopo che la pagina si e' animata (compilare un campo, premere
 * un pulsante, vedere un messaggio calcolato). Finche' il difetto qui sopra e'
 * vivo, quelle prove non possono passare, e NON vanno spente: verrebbero
 * dimenticate. Vengono saltate a condizione — e la condizione e' il difetto
 * stesso, misurato sulla pagina vera a ogni esecuzione.
 *
 * Il giorno in cui qualcuno ripara il nonce, `diagnosiJavascript` smette di
 * trovare il difetto, le prove NON si saltano piu' e tornano a girare da sole.
 * E' l'opposto di un interruttore: si puo' solo riaccendere.
 */

export type DiagnosiJavascript = {
  /** La pagina arriva al browser senza nessuno script eseguibile? */
  senzaJavascript: boolean;
  /** Perche', in italiano. Vuoto quando la pagina e' sana. */
  motivo: string;
};

/**
 * Guarda una pagina come la guarda il browser: la regola di sicurezza nella
 * risposta e i tag `<script>` nel documento. Non apre il browser e non aspetta
 * niente — e' una domanda sola, e la risposta e' sempre la stessa.
 */
export async function diagnosiJavascript(
  request: APIRequestContext,
  percorso: string,
): Promise<DiagnosiJavascript> {
  const risposta = await request.get(percorso);
  const regola = risposta.headers()['content-security-policy'] ?? '';

  const soloConNonce =
    /script-src[^;]*'nonce-/.test(regola) && /script-src[^;]*'strict-dynamic'/.test(regola);
  if (!soloConNonce) return { senzaJavascript: false, motivo: '' };

  const nonceDellaRegola = /script-src[^;]*'nonce-([^']+)'/.exec(regola)?.[1] ?? '';
  const documento = await risposta.text();
  const nonceDeiTag = new Set(
    [...documento.matchAll(/<script\b[^>]*\bnonce="([^"]*)"/g)].map((m) => m[1]),
  );

  if (nonceDeiTag.size === 0) {
    return {
      senzaJavascript: true,
      motivo:
        `${percorso}: la regola di sicurezza accetta solo script col nonce di questa richiesta, ` +
        'e nel documento non c\'e\' un solo tag <script> che lo porti. ' +
        'La pagina e\' preparata in anticipo: il browser rifiuta tutti i suoi script e React non si attacca mai.',
    };
  }

  if (!nonceDeiTag.has(nonceDellaRegola)) {
    return {
      senzaJavascript: true,
      motivo:
        `${percorso}: il nonce nei tag <script> (${[...nonceDeiTag][0]}) non e' quello della ` +
        `risposta (${nonceDellaRegola}): il documento arriva da una copia in cache. ` +
        'Il browser rifiuta gli script lo stesso.',
    };
  }

  return { senzaJavascript: false, motivo: '' };
}
