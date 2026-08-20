/**
 * Filtrare per un elenco lungo di identificativi, senza sfondare l'indirizzo.
 *
 * Il difetto (#93). `.in('id', elenco)` di PostgREST non manda l'elenco nel
 * corpo della richiesta: lo scrive nell'indirizzo, circa 37 caratteri per
 * identificativo. Con duemila negozi sono settantaquattromila caratteri contro
 * un limite pratico fra otto e sedicimila. Il modo in cui si rompe è la parte
 * peggiore: non un errore visibile, ma un 414 che il codice legge come
 * «nessun risultato». La sitemap smetterebbe di elencare i prodotti e Google
 * di indicizzarli, e nessuno se ne accorgerebbe, perché la sitemap continua a
 * rispondere.
 *
 * Qui l'elenco si spezza in blocchi da cento e i risultati si riuniscono. Non
 * è la soluzione più elegante — quella è far fare il collegamento al database —
 * ma è la rete di sicurezza che vale ovunque, subito, senza migrazione.
 */

export const DIMENSIONE_BLOCCO = 100;

/** Spezza una lista in blocchi di `dimensione` elementi. */
export function inBlocchi<T>(lista: readonly T[], dimensione = DIMENSIONE_BLOCCO): T[][] {
  if (dimensione < 1) throw new Error('La dimensione del blocco deve essere almeno 1');
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += dimensione) out.push(lista.slice(i, i + dimensione));
  return out;
}

type Risposta<R> = { data: R[] | null; error: { message?: string } | null };

/**
 * Esegue la lettura una volta per blocco e riunisce le righe. Se un blocco
 * fallisce, l'errore risale: meglio una pagina in errore che una pagina che
 * mostra meno righe di quante ce ne siano e non lo dice.
 */
export async function leggiInBlocchi<R>(
  identificativi: readonly string[],
  leggi: (blocco: string[]) => PromiseLike<Risposta<R>>,
  dimensione = DIMENSIONE_BLOCCO,
): Promise<{ data: R[]; error: { message?: string } | null }> {
  if (identificativi.length === 0) return { data: [], error: null };
  const righe: R[] = [];
  for (const blocco of inBlocchi(identificativi, dimensione)) {
    const { data, error } = await leggi(blocco);
    if (error) return { data: righe, error };
    if (data) righe.push(...data);
  }
  return { data: righe, error: null };
}
