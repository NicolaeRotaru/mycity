/**
 * Una LETTURA che regge su un database a cui mancano una o più migrazioni,
 * togliendo le colonne nuove una migrazione alla volta, dalla più nuova.
 *
 * 16/10/2026 (riesame del lotto) — IL RIPIEGO TOGLIEVA DUE MIGRAZIONI INSIEME.
 *
 * La lettura degli ordini di una contestazione (`findOrdersForDispute`)
 * chiedeva colonne della 124 e della 126. In produzione la 124 c'è e la 126
 * no: la prima lettura rispondeva 42703, e il ripiego rileggeva togliendo
 * INSIEME le colonne delle due migrazioni. Fra quelle della 124 c'è il numero
 * di tentativo del bonifico (`payout_tentativo`), che in produzione esiste: si
 * perdeva, e alla contestazione vinta il bonifico tornava in coda sempre col
 * tentativo 1, anche su un ordine già rimesso in coda prima (che doveva andare
 * a 2). Con lo stesso numero, la chiave anti-doppione del bonifico nuovo è la
 * stessa di quello vecchio.
 *
 * Qui si fa come la scrittura della contestazione (`scriviConRipiego` in
 * lib/stripe/webhook/dispute.ts): un gradino per migrazione. Si rinuncia a
 * una colonna solo quando il database ha detto che non ce l'ha.
 */
import { logger } from '@/lib/logger';
import { eSchemaIndietro, senzaColonne } from '@/lib/db/migrazione-124';

/**
 * Le select da provare in ordine: quella intera, poi senza le colonne del
 * primo gruppo, poi senza anche quelle del secondo, e così via. I gruppi vanno
 * dalla migrazione più nuova alla più vecchia. Un gradino che non toglie
 * niente (nessuna colonna di quel gruppo era chiesta) si salta.
 */
export function selectAGradini(select: string, gruppi: ReadonlyArray<readonly string[]>): string[] {
  const gradini = [select];
  let ultima = senzaColonne(select, []);
  let tolte: string[] = [];
  for (const gruppo of gruppi) {
    tolte = [...tolte, ...gruppo];
    const ridotta = senzaColonne(select, tolte);
    if (ridotta !== ultima) {
      gradini.push(ridotta);
      ultima = ridotta;
    }
  }
  return gradini;
}

/**
 * Esegue la lettura col primo gradino; finché il database risponde «questa
 * colonna non c'è», scende di un gradino. Qualsiasi altro esito (riuscita, o
 * un errore vero) si restituisce così com'è.
 */
export async function leggiAGradini<T extends { error: unknown }>(
  dove: string,
  select: string,
  gruppi: ReadonlyArray<readonly string[]>,
  esegui: (select: string) => PromiseLike<T>,
): Promise<T> {
  const gradini = selectAGradini(select, gruppi);
  let esito = await esegui(gradini[0]);
  for (let i = 1; i < gradini.length; i++) {
    if (!esito.error || !eSchemaIndietro(esito.error)) return esito;
    logger.warn('[db] colonne nuove non ancora nel database: rileggo senza quelle di una migrazione', {
      dove,
      gradino: i,
      codice: (esito.error as { code?: string }).code ?? null,
    });
    esito = await esegui(gradini[i]);
  }
  return esito;
}
