/**
 * Cosa c'è scritto su una riga d'ordine: il nome e la foto di quello che il
 * cliente ha comprato.
 *
 * 27/8/2026 (R029) — LA RIGA D'ORDINE NON TENEVA NESSUNA COPIA DEL NOME.
 *
 * Il nome si leggeva per aggancio (`order_items ( ..., products ( name, images ) )`).
 * Bastava che il negozio cancellasse il prodotto — e il pannello venditore
 * aveva un tasto che lo cancellava davvero — perché nello storico del cliente
 * restasse per sempre una riga senza nome e senza foto: non sa più cosa ha
 * comprato, e non può nemmeno recensirlo.
 *
 * Adesso il nome e la foto vengono scritti sulla riga quando l'ordine nasce
 * (li mette il database, migrazione 140) e qui si legge quella copia. Non è un
 * doppione: è la memoria di quel giorno. Se il negozio ritocca il nome, la
 * ricevuta continua a dire quello che è stato comprato davvero.
 */

export const NOME_PRODOTTO_PERSO = 'Prodotto non più disponibile';

export type RigaOrdine = {
  /** La copia scritta il giorno dell'ordine (migrazione 140). */
  product_name?: string | null;
  /** La prima foto, copiata lo stesso giorno. */
  product_image?: string | null;
  /** L'aggancio al prodotto di oggi: può non esserci più. */
  products?: { name?: string | null; images?: string[] | null } | null;
};

/** Il nome da mostrare: prima la copia del giorno, poi il prodotto di oggi. */
export function nomeDellaRigaOrdine(riga: RigaOrdine): string {
  const scatto = riga.product_name?.trim();
  if (scatto) return scatto;
  const oggi = riga.products?.name?.trim();
  if (oggi) return oggi;
  // Meglio dirlo che scrivere «Prodotto»: quello sembra un difetto grafico,
  // questo dice cosa è successo.
  return NOME_PRODOTTO_PERSO;
}

/** La foto da mostrare, con la stessa regola del nome. */
export function fotoDellaRigaOrdine(riga: RigaOrdine): string | undefined {
  const scatto = riga.product_image?.trim();
  if (scatto) return scatto;
  const oggi = riga.products?.images?.[0];
  return oggi || undefined;
}
