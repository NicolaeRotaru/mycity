import { queryKeys } from '@/lib/queries/keys';
import {
  COLONNE_NEGOZIO_DELLA_SCHEDA,
  leggiRigaDelProdotto,
  negozioDellaSchedaOperativo,
  schedaColNegozio,
  type ClientDiLettura,
} from '@/lib/queries/catalogo';
import { COLONNE_DI_BASE, chiaveVendutoDa, leggiNegozioDallaVista, vendutoDaDaRiga } from '@/lib/queries/venduto-da';

/**
 * LA SCHEDA PRODOTTO E «VENDUTO DA» CON DUE VIAGGI, NON QUATTRO.
 *
 * 16/10/2026 — Il 15/10 il negozio della scheda ha smesso di arrivare agganciato
 * al prodotto (R3: da `profiles`, che dopo la migrazione 161 un cliente non legge)
 * e il guscio ha cominciato a portare anche «Venduto da» (R55). Ogni pezzo aveva
 * la sua domanda, e le domande erano in fila:
 *
 *   prodotto → negozio della scheda → «Venduto da» completo (in produzione
 *   fallisce: la 126 non c'e') → «Venduto da» ridotto.
 *
 * Quattro viaggi di rete prima che il cliente veda nome, prezzo e foto, a ogni
 * visita. Prima del 15/10 erano due.
 *
 * Qui il negozio si chiede alla vista UNA volta, con le colonne della scheda e
 * quelle di «Venduto da» insieme, e dalla stessa riga escono tutte e due le
 * risposte. Due viaggi: il prodotto, poi il suo negozio. Finche' manca la 126 la
 * prima scheda di ogni processo ne fa tre (la domanda con le colonne d'impresa
 * dice no e si ripiega); per i dieci minuti dopo, il no si ricorda
 * (`leggiNegozioDallaVista`) e si torna a due.
 *
 * Le risposte hanno la forma ESATTA di quelle che il browser si farebbe da solo
 * (`domandaProdotto`, `domandaVendutoDa`) e stanno sotto le loro chiavi: il
 * browser le trova in mano e non va in rete.
 */

/** Le colonne della scheda piu' quelle di «Venduto da», senza doppioni. */
export const COLONNE_SCHEDA_E_VENDUTO_DA = [
  ...new Set(
    `${COLONNE_NEGOZIO_DELLA_SCHEDA}, ${COLONNE_DI_BASE}`
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean),
  ),
].join(', ');

/** Una risposta da mettere in cache: sotto quale chiave, con quale dato. */
export type VoceDelGuscio = { queryKey: readonly unknown[]; data: unknown };

/**
 * Quello che il guscio della scheda consegna al browser: la scheda e, se il
 * negozio vende, il suo «Venduto da».
 *
 * Per un negozio che la vetrina non mostra (sospeso, mai approvato) «Venduto da»
 * non c'e': la pagina dice «non disponibile» e il riquadro non si disegna.
 * Se una lettura fallisce l'errore sale: chi chiama decide cosa farne.
 */
export async function leggiSchedaPerIlGuscio(supa: ClientDiLettura, id: string): Promise<VoceDelGuscio[]> {
  const prodotto = await leggiRigaDelProdotto(supa, id);
  if (!prodotto) return [{ queryKey: queryKeys.products.detail(id), data: null }];

  const riga = prodotto.seller_id
    ? await leggiNegozioDallaVista(supa, prodotto.seller_id, COLONNE_SCHEDA_E_VENDUTO_DA)
    : null;

  const scheda = schedaColNegozio(prodotto, riga);
  const voci: VoceDelGuscio[] = [{ queryKey: queryKeys.products.detail(id), data: scheda }];
  if (riga && negozioDellaSchedaOperativo(scheda)) {
    voci.push({ queryKey: chiaveVendutoDa(prodotto.seller_id), data: vendutoDaDaRiga(riga) });
  }
  return voci;
}
