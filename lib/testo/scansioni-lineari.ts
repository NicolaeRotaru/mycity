/**
 * CERCARE IN UN TESTO SENZA RIPARTIRE DA OGNI CARATTERE.
 *
 * Un'espressione con `g` che comincia con una classe ripetuta (`[\w.+-]+@…`) si riprova da ogni
 * carattere: su una sequenza lunga senza `@` ogni tentativo la percorre fino in fondo, e il tempo
 * cresce col quadrato della lunghezza. Qui la regola si prova (`y`, cioè solo nel punto indicato)
 * dove `puoPartire` dice che una corrispondenza può cominciare, e dopo una corrispondenza si
 * riparte dalla sua fine, come fa `String.prototype.replace` con `g`.
 *
 * `puoPartire` sostituisce anche i lookbehind (`(?<!…)`): Safari prima della 16.4 non li legge, e
 * un'espressione con un lookbehind scritta nel codice fa cadere l'intero file che la contiene.
 *
 * 🟢 Pura: nessuna rete, nessun orologio.
 */

export type Trovato = { inizio: number; fine: number; testo: string };

/**
 * Tutte le corrispondenze di `corpo` (con la bandiera `y`), da sinistra a destra, senza
 * sovrapposizioni, provate solo dove `puoPartire(i, fineDellUltima)` è vero.
 */
export function trovaTutti(
  testo: string,
  corpo: RegExp,
  puoPartire: (i: number, fineDellUltima: number) => boolean,
): Trovato[] {
  if (!corpo.sticky) throw new Error('trovaTutti: la regola deve avere la bandiera y');
  const trovati: Trovato[] = [];
  let fineDellUltima = 0;
  for (let i = 0; i < testo.length; i++) {
    if (!puoPartire(i, fineDellUltima)) continue;
    corpo.lastIndex = i;
    const m = corpo.exec(testo);
    if (!m || m[0].length === 0) continue;
    trovati.push({ inizio: i, fine: i + m[0].length, testo: m[0] });
    fineDellUltima = i + m[0].length;
    i = fineDellUltima - 1;
  }
  return trovati;
}

/** Come `testo.replace(regola con g, sostituisci)`, sulle corrispondenze di `trovaTutti`. */
export function sostituisciTutti(
  testo: string,
  corpo: RegExp,
  puoPartire: (i: number, fineDellUltima: number) => boolean,
  sostituisci: (trovato: string) => string,
): string {
  const trovati = trovaTutti(testo, corpo, puoPartire);
  if (trovati.length === 0) return testo;
  let fuori = '';
  let copiato = 0;
  for (const t of trovati) {
    fuori += testo.slice(copiato, t.inizio) + sostituisci(t.testo);
    copiato = t.fine;
  }
  return fuori + testo.slice(copiato);
}

/**
 * Come `testo.split(regola con g e un gruppo che cattura)`: i pezzi fra una corrispondenza e
 * l'altra alternati alle corrispondenze (pari: testo, dispari: corrispondenza).
 */
export function spezzaTenendo(
  testo: string,
  corpo: RegExp,
  puoPartire: (i: number, fineDellUltima: number) => boolean,
): string[] {
  const pezzi: string[] = [];
  let copiato = 0;
  for (const t of trovaTutti(testo, corpo, puoPartire)) {
    pezzi.push(testo.slice(copiato, t.inizio), t.testo);
    copiato = t.fine;
  }
  pezzi.push(testo.slice(copiato));
  return pezzi;
}

/**
 * Vero se in `i` comincia una sequenza di caratteri di `classe` (un solo carattere per prova), o se
 * `i` è la fine della corrispondenza di prima. È il punto da cui provare una regola che comincia
 * con quella classe ripetuta: se una corrispondenza comincia a metà della sequenza, ne comincia una
 * anche al suo inizio, e la ricerca da sinistra trova quella.
 */
export function inizioDiSequenza(testo: string, classe: RegExp) {
  return (i: number, fineDellUltima: number): boolean =>
    i === 0 || i === fineDellUltima || !classe.test(testo[i - 1]);
}
