import { MARKETPLACE_FEE_BPS } from '@/lib/constants';
import { fraseAttesaBonifico } from '@/lib/stripe/tempi-bonifico';

/**
 * 31/8/2026 (R037) — SULLA PAGINA DEI SUOI SOLDI PROMETTEVAMO AL NEGOZIO L'8%,
 * E IN CASSA NE TRATTENEVAMO IL 10.
 *
 * La stessa frase sbagliata viveva in due posti. Nel Centro venditori e' stata
 * raddrizzata il 30/8 (app/seller/help/domande.ts, che adesso prende la
 * percentuale da `MARKETPLACE_FEE_BPS`), ma qui — sulla pagina «Guadagni», cioe'
 * proprio dove il negoziante va a controllare quanto gli arriva — il numero era
 * ancora battuto a mano: «solo l'8% del venduto». Il difetto e' stato dichiarato
 * chiuso mentre era vivo per meta', perche' la prova di allora leggeva una
 * pagina sola.
 *
 * Su mille euro di venduto sono venti euro al mese di differenza fra quello che
 * il negoziante legge e quello che gli arriva sul conto: se ne accorge da solo
 * guardando il bonifico, e da li' in poi non crede piu' a nessun altro numero
 * che gli scriviamo.
 *
 * Il testo vive qui, fuori dalla pagina, per due motivi — gli stessi di
 * domande.ts: la percentuale nasce dalla costante che fa i conti veri, e una
 * prova puo' leggere davvero la frase che il negoziante ha sotto gli occhi
 * (dentro il JSX non la saprebbe aprire).
 */

/** La commissione come la legge una persona: 10 quando i punti base sono 1000. */
export const COMMISSIONE_PERCENTO = MARKETPLACE_FEE_BPS / 100;

/**
 * «l'8%» ma «il 10%»: in italiano l'articolo segue come si PRONUNCIA il numero,
 * non come si scrive. Senza questa riga il giorno che la commissione cambia la
 * frase diventerebbe «il 8%» — e una promessa scritta male proprio sui soldi si
 * legge come una promessa poco seria. Vale per le percentuali da 0 a 100, le
 * uniche che abbiano senso per una commissione.
 */
function articoloDavantiA(percento: number): string {
  const intero = Math.trunc(percento);
  const siPronunciaConVocale = intero === 1 || intero === 8 || intero === 11 || intero === 18 || (intero >= 80 && intero <= 89);
  return siPronunciaConVocale ? "l'" : 'il ';
}

/**
 * Un paragrafo della spiegazione: `forte` e' la parte in grassetto sulla pagina.
 * Sta spezzato in tre perche' il grassetto resti dov'era senza che la frase
 * debba diventare JSX — e quindi illeggibile a una prova.
 */
export type ParagrafoCommissione = {
  prima: string;
  forte: string;
  dopo: string;
};

/**
 * E' una funzione e non una costante perche' anche i tempi del bonifico non si
 * riscrivono qui: li dice `fraseAttesaBonifico()`, dove quel numero e' stato
 * deciso.
 */
export function spiegazioneCommissione(): ParagrafoCommissione[] {
  return [
    {
      prima: 'Su MyCity paghi ',
      forte: `solo ${articoloDavantiA(COMMISSIONE_PERCENTO)}${COMMISSIONE_PERCENTO}% del venduto`,
      dopo: ' realmente concluso (non rimborsi, non ordini annullati). Nessuna commissione mensile, nessun costo di iscrizione.',
    },
    {
      prima: 'Il bonifico parte ',
      forte: `in automatico ${fraseAttesaBonifico()}`,
      dopo: '. In caso di reso o contestazione la quota corrispondente viene trattenuta o recuperata.',
    },
  ];
}

/** La frase intera, come la legge il negoziante: grassetto compreso. */
export const testoIntero = (p: ParagrafoCommissione): string => `${p.prima}${p.forte}${p.dopo}`;
