/**
 * 8/9/2026 - IL FOGLIO CHE SCARICA IL COMMERCIALISTA NON ESEGUE QUELLO CHE HA
 * SCRITTO UN NEGOZIANTE.
 *
 * -- Come si era rotto -------------------------------------------------------
 * Ogni pagina che esporta si componeva il CSV da sola, con una riga sola:
 *
 *     row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')
 *
 * Le virgolette proteggono da una cosa sola: il testo che spezza la riga. Non
 * proteggono dal resto. Per Excel, LibreOffice e Fogli Google un campo che
 * comincia con `=`, `+`, `-` o `@` NON e' testo: e' una formula, e viene
 * ESEGUITA appena il file si apre. Nel file degli ordini finiscono di peso il
 * nome del cliente, il nome del negozio e il nome del fattorino, cioe' testo
 * che scrivono loro. Un negozio che si chiama
 * `=HYPERLINK("http://sito-finto","Fattura")` mette un link cliccabile dentro
 * il foglio del commercialista, che si fida perche' quel file l'ha scaricato
 * dal nostro pannello. Con formule piu' cattive si leggono altre celle e si
 * mandano fuori.
 *
 * -- Perche' la difesa sta qui e non nella pagina ----------------------------
 * Perche' se ogni pagina si scrive il suo `.map(...)`, la malattia torna alla
 * prossima esportazione che qualcuno aggiunge: basta dimenticarsene una volta.
 * Qui c'e' UNA strada sola dal dato al file - `componiCsv` - e quella strada
 * neutralizza SEMPRE ogni cella, senza che chi la chiama debba ricordarsene.
 * Chi esporta passa una matrice di valori, non del testo gia' incollato.
 *
 * -- Il prezzo, dichiarato ---------------------------------------------------
 * Il campo neutralizzato porta un apostrofo davanti (`'=1+1`): e' la difesa che
 * raccomanda OWASP. In cella si vede un apostrofo in piu' e il valore resta
 * inerte. E' un prezzo che si paga solo sui campi che sembrano una formula: i
 * numeri veri (anche negativi, anche col decimale italiano) passano intatti,
 * altrimenti la colonna dei totali smetterebbe di sommarsi in Excel.
 */

/**
 * I caratteri che in prima posizione trasformano una cella in formula.
 * `-` c'e' perche' `-2+3` per Excel e' un calcolo, non un testo.
 */
const AVVII_DI_FORMULA = ['=', '+', '-', '@'] as const;

/**
 * Un numero in chiaro: cifre, al massimo un meno davanti, un decimale col punto
 * o con la virgola. Non ci sta dentro nessun operatore e nessuna funzione,
 * quindi `-1234,50` resta un numero negativo e non un calcolo.
 */
const SOLO_UN_NUMERO = /^-?\d+(?:[.,]\d+)?$/;

/**
 * Gli invisibili che i fogli di calcolo buttano via PRIMA di guardare il primo
 * carattere: senza toglierli, una tabulazione o uno spazio davanti a `=1+1` lo
 * farebbero passare per testo qui, e resterebbe una formula la'.
 */
const INVISIBILI_INIZIALI = /^[\s\u0000-\u001F\u00A0\u200B-\u200F\uFEFF]+/;

/** Il segno che dice a Excel che il file e' UTF-8. */
export const BOM_EXCEL = '\uFEFF';

/**
 * Il valore come deve uscire nel file: uguale a se stesso se e' testo, con un
 * apostrofo davanti se il foglio di calcolo lo prenderebbe per una formula.
 *
 * E' pura: stessa entrata, stessa uscita, nessun effetto. Una prova la puo'
 * eseguire senza montare niente.
 */
export function campoCsvSicuro(valore: unknown): string {
  const testo = valore === null || valore === undefined ? '' : String(valore);
  if (testo === '') return '';

  const nudo = testo.replace(INVISIBILI_INIZIALI, '');
  if (nudo === '') return testo;                 // solo spazi: niente da eseguire
  if (SOLO_UN_NUMERO.test(nudo)) return testo;   // un numero, non un calcolo
  if (!AVVII_DI_FORMULA.includes(nudo[0] as typeof AVVII_DI_FORMULA[number])) return testo;

  return `'${testo}`;
}

/**
 * Il campo fra virgolette, con le virgolette interne raddoppiate: e' quello che
 * impedisce a un `;` o a un a capo dentro un nome di spezzare la riga.
 */
export function virgolettaCampoCsv(campo: string): string {
  return `"${campo.replace(/"/g, '""')}"`;
}

export type OpzioniCsv = {
  /** Il punto e virgola e' quello che si aspetta Excel in italiano. */
  separatore?: string;
  fineRiga?: string;
};

/**
 * La matrice di valori diventa il testo del CSV. Unica strada: qualunque cosa
 * passi di qui e' neutralizzata e virgolettata, sempre.
 */
export function componiCsv(righe: readonly (readonly unknown[])[], opzioni: OpzioniCsv = {}): string {
  const separatore = opzioni.separatore ?? ';';
  const fineRiga = opzioni.fineRiga ?? '\n';
  return righe
    .map((riga) => riga.map((cella) => virgolettaCampoCsv(campoCsvSicuro(cella))).join(separatore))
    .join(fineRiga);
}

/** Il contenuto completo del file, BOM compreso: quello che finisce nel Blob. */
export function contenutoFileCsv(righe: readonly (readonly unknown[])[], opzioni: OpzioniCsv = {}): string {
  return BOM_EXCEL + componiCsv(righe, opzioni);
}
