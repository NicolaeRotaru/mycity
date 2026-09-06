import { RAGGIO_CONSEGNA_KM, RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { haversineKm } from '@/lib/geo';

/**
 * FIN DOVE CONSEGNIAMO — la domanda in un posto solo.
 *
 * Vive qui, e non dentro lib/shipping.ts, per un motivo pratico: la chiedono le
 * due rotte che creano un ordine (contanti e carta) e il conto della spedizione.
 * Un modulo piccolo e senza dipendenze si può chiamare da tutti e tre senza
 * trascinarsi dietro il resto.
 */

/** Le due coordinate che servono per sapere quanto è lontana una consegna. */
export type DoveVaLaConsegna = {
  storeLat: number | null;
  storeLng: number | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
};

/**
 * QUESTA CONSEGNA È FUORI DALLA ZONA CHE SERVIAMO?
 *
 * 6/9/2026 — Prima questa domanda non se la faceva nessuno, in nessun punto del
 * progetto: il perimetro «Piacenza e dintorni» viveva solo nei testi. Un ordine
 * per Milano arrivava fino in fondo, con la conferma via email, e poi qualcuno
 * doveva telefonare e annullarlo — un rimborso, una recensione arrabbiata e un
 * negoziante che aveva già preparato la merce.
 *
 * QUANDO NON SI SA, NON SI BLOCCA. Se manca una delle due coordinate — il
 * negozio senza posizione sulla vetrina, un indirizzo nuovo che il
 * geocodificatore non riconosce — la risposta è «no». Un ordine vero rifiutato
 * per un dato mancante costerebbe più di una consegna lontana accettata: la
 * distanza si può guardare a mano, un cliente perso no.
 *
 * Col ritiro in negozio non c'è consegna, quindi non c'è zona.
 *
 * 🟢 Pura: nessuna rete, nessun orologio. Una prova la ESEGUE.
 */
export function fuoriZonaDiConsegna(opts: DoveVaLaConsegna & { pickupInStore?: boolean }): boolean {
  if (opts.pickupInStore) return false;
  const { storeLat, storeLng, deliveryLat, deliveryLng } = opts;
  if (!storeLat || !storeLng || !deliveryLat || !deliveryLng) return false;
  return haversineKm(storeLat, storeLng, deliveryLat, deliveryLng) > RAGGIO_CONSEGNA_KM;
}

/**
 * Cosa si dice a chi abita fuori zona — un'offerta, non un muro.
 *
 * Il ritiro in negozio si nomina solo se è davvero acceso
 * (`RITIRO_IN_NEGOZIO_ATTIVO`): oggi è spento, e mandare qualcuno in negozio a
 * ritirare quando la cassa non glielo permette è una porta chiusa spacciata per
 * via d'uscita.
 */
export function motivoFuoriZona(nomeNegozio?: string | null): string {
  const negozio = nomeNegozio?.trim();
  const dove = negozio ? `da ${negozio}` : 'da questo negozio';
  return RITIRO_IN_NEGOZIO_ATTIVO
    ? `Per ora consegniamo a Piacenza e dintorni: il tuo indirizzo è troppo lontano ${dove}. Puoi ritirare in negozio.`
    : `Per ora consegniamo a Piacenza e dintorni: il tuo indirizzo è troppo lontano ${dove}. Prova con un negozio più vicino a te.`;
}
