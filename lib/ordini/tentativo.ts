/**
 * LA CHIAVE DI UN TENTATIVO DI ORDINE IN CONTANTI.
 *
 * Due difetti bloccanti trovati dalla radiografia del 21/8/2026 stavano tutti e
 * due qui dentro, e tutti e due erano invisibili perché la decisione viveva in
 * mezzo a una pagina da mille righe e a una rotta da seicento: non c'era niente
 * da mettere sotto una prova.
 *
 * ① LA CHIAVE ERA L'IMPRONTA DEL CARRELLO, e un carrello uguale ha impronta
 *    uguale per sempre. Maria compra due filoni ogni martedì: il martedì dopo
 *    il server riconosceva la chiave, restituiva gli ordini della settimana
 *    prima e il sito diceva «Ordine effettuato». Al negozio non arrivava
 *    niente.
 *
 * ② LA CHIAVE SI SCRIVEVA ALLA FINE, dopo aver creato gli ordini. Due invii
 *    partiti nello stesso istante leggevano entrambi «nessuna chiave» e
 *    creavano entrambi gli ordini: il negozio preparava due spese, il fattorino
 *    ne consegnava una, il credito veniva tolto due volte.
 */

/** Quanto si aspetta un invio gemello prima di considerarlo morto per strada. */
export const ABBANDONATO_DOPO_MS = 60_000;

/**
 * La chiave di QUESTO tentativo: nasce al primo invio, resta uguale se
 * l'invio viene ripetuto, e muore quando l'ordine è andato a buon fine.
 *
 * Sta in `sessionStorage` perché una pagina ricaricata mentre l'ordine parte è
 * esattamente il caso che il doppione deve coprire: se la chiave morisse col
 * componente, quel ricaricamento creerebbe il secondo ordine.
 *
 * `deposito` e `genera` arrivano da fuori così la prova può eseguirli.
 */
export function chiaveTentativo(
  deposito: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  genera: () => string,
  nome = 'mycity:cod:tentativo',
): string {
  if (!deposito) return genera();
  try {
    const gia = deposito.getItem(nome);
    if (gia) return gia;
    const nuova = genera();
    deposito.setItem(nome, nuova);
    return nuova;
  } catch {
    // Navigazione privata o memoria negata: meglio una chiave per invio che
    // nessuna chiave.
    return genera();
  }
}

export function chiudiTentativo(
  deposito: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  nome = 'mycity:cod:tentativo',
): void {
  if (!deposito) return;
  try {
    deposito.removeItem(nome);
  } catch {
    /* niente da chiudere */
  }
}

/** Cosa fare quando la chiave risulta già presa. */
export type DecisioneChiaveOccupata = 'restituisci-ordini' | 'gemello-in-corso' | 'chiave-abbandonata';

/**
 * Chi arriva secondo sulla stessa chiave non deve MAI creare altri ordini, ma i
 * casi non sono uguali fra loro.
 *
 *  · ci sono già gli ordini → è lo stesso invio ripetuto: gli si restituiscono;
 *  · non ci sono e la riga è di pochi secondi fa → il gemello sta lavorando:
 *    si dice «sto arrivando»;
 *  · non ci sono e la riga è vecchia → quell'invio è morto per strada e la
 *    chiave è rimasta a occupare il posto. Senza questa via d'uscita il cliente
 *    resterebbe bloccato per sempre su quel carrello.
 */
export function decisioneSuChiaveOccupata(opts: {
  ordiniGia: unknown[] | null;
  natoDaMs: number;
  abbandonatoDopoMs?: number;
}): DecisioneChiaveOccupata {
  if (opts.ordiniGia && opts.ordiniGia.length > 0) return 'restituisci-ordini';
  return opts.natoDaMs > (opts.abbandonatoDopoMs ?? ABBANDONATO_DOPO_MS)
    ? 'chiave-abbandonata'
    : 'gemello-in-corso';
}
