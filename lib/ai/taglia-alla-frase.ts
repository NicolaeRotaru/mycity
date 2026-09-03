/**
 * UNA DESCRIZIONE CORTA E' UTILE. UNA TAGLIATA A META' PAROLA NO.
 *
 * Dal 3/9/2026 una risposta del modello fermata dal tetto dei token e' un errore: prima passava per
 * completa, e un blocco strutturato troncato scriveva dati storti sui prodotti. Giusto — ma non per
 * tutti. La descrizione del prodotto ha un tetto di 300 token, quindi il taglio la' e' la normalita',
 * e trasformarlo in errore vuol dire che al negoziante non esce piu' niente invece di uscire un testo
 * un po' piu' corto. Il negoziante e' in negozio, col telefono in mano, e sta caricando la merce.
 *
 * Qui il testo tagliato viene chiuso all'ultima frase intera. Se non c'e' nemmeno una frase intera,
 * il testo non si mostra: meglio niente che una riga mozza sotto la foto del pane.
 */

/** La punteggiatura che chiude una frase in italiano, virgolette e parentesi comprese. */
const FINE_FRASE = /[.!?…](?=["'»)\]]?\s|["'»)\]]?$)/g;

export function tagliaAllUltimaFraseIntera(testo: string): string {
  const pulito = (testo ?? '').trim();
  if (!pulito) return '';

  let ultima = -1;
  for (const m of pulito.matchAll(FINE_FRASE)) {
    // Includo anche l'eventuale virgoletta o parentesi che chiude subito dopo il punto.
    const dopo = pulito.slice(m.index + 1).match(/^["'»)\]]/);
    ultima = m.index + 1 + (dopo ? dopo[0].length : 0);
  }
  if (ultima <= 0) return '';
  return pulito.slice(0, ultima).trim();
}
