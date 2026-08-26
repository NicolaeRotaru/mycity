/**
 * IL CUORE DEI PREFERITI — un gesto solo, un colore solo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IL DIFETTO CHE QUESTO FILE CHIUDE
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo stesso gesto — mettere un prodotto nei preferiti — aveva due colori diversi a seconda di dove
 * lo facevi. Sulla card del prodotto il cuore acceso è **vino** (`secondary-500`), che è il colore
 * del marchio e quello che il mockup prescrive. Sulla scheda del prodotto era **fucsia**
 * (`rose-500`), che non è un colore del marchio: è una rampa che Tailwind si porta dietro di suo.
 *
 * Il cliente vede lo stesso cuore cambiare colore passando da una schermata all'altra, e non c'è
 * niente da capire: è lo stesso gesto.
 *
 * La radice è che le rampe di Tailwind (`rose-*`, `red-*`) sono raggiungibili accanto a quelle del
 * marchio, quindi chi scrive una schermata nuova può pescare l'una o l'altra senza accorgersene.
 * Un colore scritto a mano in due posti diverge in silenzio: qui il colore ha una casa sola.
 *
 * 🟢 Nessun disco, nessuna rete: sono stringhe di classi, e una prova le può eseguire.
 */

/** Il cuore acceso: il prodotto è nei preferiti. */
export const CUORE_ACCESO = 'fill-secondary-500 text-secondary-500';

/** Il cuore spento, sulla card (sfondo chiaro dietro). */
export const CUORE_SPENTO = 'text-ink-400';

/** Il bottone tondo della scheda prodotto, quando il prodotto è nei preferiti. */
export const BOTTONE_ACCESO = 'bg-secondary-500 border-secondary-500 text-white hover:scale-110';

/** Lo stesso bottone quando non lo è: si accende al passaggio, con lo stesso colore. */
export const BOTTONE_SPENTO =
  'bg-white border-cream-300 text-ink-300 hover:scale-110 hover:text-secondary-400 hover:border-secondary-200';

/** L'anello di fuoco: quello usato ovunque nel sito, non una rampa a caso. */
export const ANELLO = 'focus-visible:ring-secondary-400';

/**
 * Le classi del cuore, dato lo stato. Esiste perché la prova possa ESEGUIRE la scelta invece di
 * cercare un colore nel testo di un componente.
 */
export function classiCuore(acceso: boolean): string {
  return acceso ? CUORE_ACCESO : CUORE_SPENTO;
}

/** Le classi del bottone tondo della scheda prodotto, dato lo stato. */
export function classiBottoneCuore(acceso: boolean): string {
  return acceso ? BOTTONE_ACCESO : BOTTONE_SPENTO;
}
