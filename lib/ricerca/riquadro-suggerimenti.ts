/**
 * COSA DICE IL RIQUADRO SOTTO LA BARRA DI RICERCA — e «rotto» non è «non c'è».
 *
 * 27/8/2026 (R089) — il riquadro conosceva due stati soli: sto caricando, e non c'è niente. Su una
 * lettura fallita (rete storta, funzione di ricerca non applicata, tempo scaduto) l'elenco restava
 * vuoto, il caricamento risultava finito, e al cliente compariva «Nessun risultato per «pane»» —
 * annunciato pure a voce a chi usa lo screen reader. Una bugia sul mondo, detta nel momento di
 * massima intenzione d'acquisto: chi la sente se ne va, e il negozio perde una vendita su merce che
 * aveva in negozio.
 *
 * Gli stati sono TRE più il caso normale — attesa · errore · vuoto · elenco — la stessa regola di
 * `lib/stato-vista.ts`. Qui c'è anche il testo, perché la frase sbagliata era il difetto.
 *
 * 🟢 Pura: nessuna rete, nessun React. Una prova la ESEGUE.
 */
export type MostraSuggerimenti = 'attesa' | 'errore' | 'vuoto' | 'elenco';

export interface DomandaRiquadro {
  termine: string;
  caricando: boolean;
  errore?: unknown;
  quanti: number;
}

export interface VerdettoRiquadro {
  mostra: MostraSuggerimenti;
  /** Quello che sente chi naviga con lo screen reader. Vuoto = non si annuncia niente. */
  annuncio: string;
}

export function riquadroSuggerimenti(d: DomandaRiquadro): VerdettoRiquadro {
  const rotto = d.errore !== undefined && d.errore !== null && d.errore !== false;

  // L'errore batte tutto, tranne quello che la persona sta già leggendo: se dei suggerimenti sono
  // arrivati non si cancellano dallo schermo per un errore sulla battuta successiva.
  if (rotto && d.quanti === 0) {
    return { mostra: 'errore', annuncio: 'Non riesco a cercare adesso. Riprova.' };
  }
  if (d.caricando && d.quanti === 0) return { mostra: 'attesa', annuncio: '' };
  if (d.quanti === 0) return { mostra: 'vuoto', annuncio: `Nessun suggerimento per ${d.termine}` };
  return {
    mostra: 'elenco',
    annuncio: `${d.quanti} suggeriment${d.quanti === 1 ? 'o' : 'i'} disponibil${d.quanti === 1 ? 'e' : 'i'}`,
  };
}
