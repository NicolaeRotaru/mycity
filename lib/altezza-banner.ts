/**
 * Quanto spazio dichiara il banner dei cookie, e a chi lo dice.
 *
 * PERCHÉ ESISTE. Il banner sta incollato in fondo allo schermo. La barra «Aggiungi al carrello»
 * della scheda prodotto sta anche lei in fondo, e per non finirci sotto legge una variabile che il
 * banner pubblica: quanto sono alto. Se quel numero è vecchio, la barra si sposta della misura
 * sbagliata e il pulsante che fa incassare torna coperto.
 *
 * IL DIFETTO CHE QUESTO FILE CHIUDE. La misura si prendeva UNA volta sola, quando il banner
 * compariva. Poi la persona tocca «Personalizza», il banner cresce di quattro righe, e il numero
 * pubblicato resta quello di prima: la barra si sposta di meno di quanto serve e il pulsante torna
 * sotto. Non è un caso di laboratorio — è il percorso normale di chi vuole scegliere invece di
 * accettare tutto, cioè proprio quello che le linee guida del Garante chiedono di rendere facile.
 *
 * PERCHÉ NON BASTAVA AGGIUNGERE UNA DIPENDENZA. La cura corta era mettere anche `mode` nella lista
 * delle dipendenze dell'effetto. Cura oggi e non domani: la stessa cosa succede se un domani il
 * testo si allunga, una riga va a capo su uno schermo stretto, un carattere si carica in ritardo o
 * arriva una lingua con parole più lunghe. Ognuna di quelle vorrebbe una voce in più in una lista
 * che qualcuno deve ricordarsi di aggiornare — ed è la forma di difetto che questa casa paga di
 * più: un controllo che dipende da una lista scritta a mano.
 *
 * Qui l'altezza SEGUE l'elemento. Chi la pubblica non deve sapere PERCHÉ è cambiata.
 */

/** La variabile che la barra d'acquisto legge. Un nome solo, in un posto solo. */
export const VARIABILE_ALTEZZA = '--altezza-banner-cookie';

/** Il respiro fra il fondo del banner e ciò che si porta a fuoco scorrendo. */
export const MARGINE_SCROLL = 16;

/** «Non l'ho misurato» è ZERO dichiarato, non un numero inventato. */
export function altezzaDichiarata(px?: number | null): string {
  return typeof px === 'number' && Number.isFinite(px) && px > 0 ? `${Math.round(px)}px` : '0px';
}

/** Quanto spazio lasciare in fondo alla pagina mentre il banner è visibile. */
export function paddingDiScorrimento(px?: number | null): string {
  const alto = typeof px === 'number' && Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
  return `${alto + MARGINE_SCROLL}px`;
}

type ConStile = { style: { setProperty(nome: string, valore: string): void } };
type Misurabile = { offsetHeight: number };

/**
 * Tiene la variabile allineata all'altezza vera dell'elemento, finché non si smette.
 *
 * `osserva` è il pezzo che tocca il browser, e si passa da fuori: così questa funzione si prova
 * senza un browser, e la prova può far finta che l'elemento cresca.
 *
 * Torna la funzione che rimette tutto com'era: la variabile a zero e l'osservazione spenta. Se
 * l'elemento non c'è, pubblica zero e non finge di aver misurato.
 */
export function seguiAltezza(
  elemento: Misurabile | null,
  radice: ConStile,
  osserva: (bersaglio: Misurabile, quandoCambia: () => void) => () => void,
): () => void {
  const pubblica = () => {
    const px = elemento?.offsetHeight;
    radice.style.setProperty(VARIABILE_ALTEZZA, altezzaDichiarata(px));
  };
  pubblica();
  if (!elemento) return () => radice.style.setProperty(VARIABILE_ALTEZZA, '0px');
  const smetti = osserva(elemento, pubblica);
  return () => {
    smetti();
    radice.style.setProperty(VARIABILE_ALTEZZA, '0px');
  };
}

/**
 * L'osservatore vero del browser, con la sua via d'uscita dichiarata.
 *
 * Se `ResizeObserver` non c'è, la misura resta quella d'apertura: è meno di quanto vorremmo, ed è
 * scritto qui invece di essere scoperto da chi non riesce a comprare.
 */
export function osservatoreDelBrowser(bersaglio: Misurabile, quandoCambia: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const o = new ResizeObserver(() => quandoCambia());
  o.observe(bersaglio as unknown as Element);
  return () => o.disconnect();
}
