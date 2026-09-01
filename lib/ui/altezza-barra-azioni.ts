/**
 * Quanto spazio lasciare sotto il contenuto quando in fondo allo schermo c'e'
 * una barra fissa con i pulsanti — e chi lo dice a chi.
 *
 * 30/8/2026 (R095) — IL FATTORINO NON RIUSCIVA A LEGGERE QUANTO INCASSARE.
 *
 * Sul dettaglio della consegna, l'ultima riga del contenuto e' «Totale (da
 * incassare)»: l'importo che il fattorino chiede al cliente sulla porta. Sotto
 * il contenuto era riservato uno spazio scritto a mano — 80 pixel — mentre la
 * barra fissa, quando l'ordine e' gia' stato ritirato, contiene DUE pulsanti
 * grandi impilati: 48 + 8 + 48 di pulsanti piu' 12 + 12 di respiro, cioe' circa
 * 128 pixel. Ne mancavano una cinquantina, e a restare coperta era proprio la
 * riga dei soldi. Il guscio del fattorino, su questa pagina, toglie apposta il
 * proprio spazio di sicurezza: non c'era nessuna rete sotto.
 *
 * La cura corta era scrivere 140 al posto di 80. Cura oggi e non domani: basta
 * un pulsante in piu', una scritta che va a capo su uno schermo stretto o un
 * carattere che si carica in ritardo, e il numero scritto a mano torna sbagliato
 * senza che nessuno se ne accorga. Qui lo spazio SEGUE la barra vera: la barra
 * si misura da sola e pubblica quanto e' alta; il contenuto legge quel numero.
 */
import { seguiAltezza, osservatoreDelBrowser } from '@/lib/altezza-banner';

/** La variabile che il contenuto della pagina legge per sapere quanto stare alto. */
export const VARIABILE_BARRA_AZIONI = '--altezza-barra-azioni';

/** Il respiro fra il fondo del contenuto e la barra: senza, il testo la tocca. */
export const RESPIRO_SOTTO_IL_CONTENUTO = 16;

/**
 * Lo spazio da riservare in fondo alla pagina.
 *
 * Il numero di scorta serve solo per il primo istante, prima che la barra si sia
 * misurata (e per chi ha il JavaScript a meta'): e' l'altezza della barra nella
 * sua forma piu' alta, non una media. La misura della barra comprende gia' la
 * fascia di sicurezza in fondo agli schermi senza cornice, quindi qui non si
 * riaggiunge: contata due volte, il contenuto si staccherebbe dal fondo.
 */
export function spazioSottoIlContenuto(scortaPx = 128): string {
  return `calc(var(${VARIABILE_BARRA_AZIONI}, ${Math.round(scortaPx)}px) + ${RESPIRO_SOTTO_IL_CONTENUTO}px)`;
}

type ConStile = { style: { setProperty(nome: string, valore: string): void } };
type Misurabile = { offsetHeight: number };

/**
 * Tiene la variabile allineata all'altezza vera della barra, finche' non si
 * smette. Restituisce la funzione che rimette tutto com'era.
 *
 * `osserva` si passa da fuori cosi' questa funzione si prova senza un browser, e
 * la prova puo' far crescere la barra e guardare cosa succede.
 */
export function seguiAltezzaBarraAzioni(
  barra: Misurabile | null,
  radice: ConStile,
  osserva: (bersaglio: Misurabile, quandoCambia: () => void) => () => void = osservatoreDelBrowser,
): () => void {
  return seguiAltezza(barra, radice, osserva, VARIABILE_BARRA_AZIONI);
}
