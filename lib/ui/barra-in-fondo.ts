/**
 * DA DOVE PARTE UNA BARRA INCOLLATA IN FONDO ALLO SCHERMO.
 *
 * 27/8/2026 (R096) — LA SAFE-AREA DELL'IPHONE ERA CONTATA DUE VOLTE.
 *
 * Le due barre che chiudono un acquisto — «Conferma ordine» in cassa e
 * «Aggiungi al carrello» sulla scheda prodotto — mettevano
 * `env(safe-area-inset-bottom)` in DUE posti: dentro `bottom`, per scavalcare
 * la barra gestuale, e di nuovo nel padding (la classe `pb-safe`, o un
 * `pb-[calc(0.75rem+env(...))]`). Su un iPhone con barra gestuale sono una
 * trentina di pixel contati due volte: la barra galleggia staccata dal fondo,
 * con una fascia vuota sotto il pulsante.
 *
 * È un difetto solo visivo, ma sta sui due pulsanti che chiudono l'acquisto:
 * una barra storta proprio lì sembra un sito rotto nel momento in cui serve
 * fiducia, e ruba pixel sugli schermi corti.
 *
 * La misura va in UN posto solo, e il posto giusto è `bottom`: è quello che
 * deve scavalcare la barra gestuale e, quando c'è, il banner dei cookie. Il
 * padding torna a essere padding.
 *
 * 🟢 Pura: costruisce una stringa. Una prova la ESEGUE.
 */

/** La misura della barra gestuale, quella che non va contata due volte. */
export const SAFE_AREA_IN_FONDO = 'env(safe-area-inset-bottom, 0px)';

/**
 * Il `bottom` di una barra incollata in fondo: la safe-area più tutto quello
 * che le sta sotto (barra a schede, banner dei cookie).
 */
export function fondoDellaBarra(sopra: string[] = []): string {
  const pezzi = [SAFE_AREA_IN_FONDO, ...sopra.filter((p) => p.trim().length > 0)];
  return `calc(${pezzi.join(' + ')})`;
}
