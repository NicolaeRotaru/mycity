import { RAGGIO_CONSEGNA_KM, RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { haversineKm } from '@/lib/geo';
import { FINO_A_DOVE_CONSEGNIAMO } from '@/lib/promesse-pubbliche';

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
 *
 * 28/10/2026 — Il messaggio diceva «Per ora consegniamo a Piacenza e
 * dintorni»: col confine a 5 km Podenzano, Rottofreno e Gossolengo restano
 * fuori, e chi abitava lì si sentiva rifiutare con una frase che lo includeva.
 * Adesso dice il limite vero, letto da `RAGGIO_CONSEGNA_KM`, ed è scritto una
 * volta sola per le due strade: acceso o spento il ritiro, il confine è lo stesso.
 */
export function motivoFuoriZona(nomeNegozio?: string | null): string {
  const negozio = nomeNegozio?.trim();
  const dove = negozio ? `da ${negozio}` : 'da questo negozio';
  // 13/11/2026 (R13-013) — Il confine si legge dalla frase di tutto il sito (lib/promesse-pubbliche.ts).
  const troppoLontano = `Per ora consegniamo ${FINO_A_DOVE_CONSEGNIAMO}: il tuo indirizzo è troppo lontano ${dove}.`;
  return RITIRO_IN_NEGOZIO_ATTIVO
    ? `${troppoLontano} Puoi ritirare in negozio.`
    : `${troppoLontano} Prova con un negozio più vicino a te.`;
}

/**
 * DOVE PUÒ STARE UN NEGOZIO — Piacenza e dintorni.
 *
 * 13/11/2026 (R13-006) — Nessun punto della catena sapeva dove sta Piacenza: il selettore
 * della posizione, il geocodificatore, il modulo e il server prendevano per buono qualunque
 * numero. Un negozio che scriveva «Via Roma 12» senza la città finiva a Roma con la posizione
 * confermata; veniva approvato, e poi ogni ordine era «fuori zona» senza che nessuno gli
 * dicesse perché. Il raggio di consegna si guardava solo al momento dell'ordine.
 *
 * Il riquadro tiene il comune di Piacenza con le sue frazioni (Mucinasso, Roncaglia,
 * Borghetto, San Bonico…) e la prima cintura (San Nicolò, Gossolengo, Pontenure). È lo stesso
 * dove si cercano gli indirizzi di Piacenza (lib/geocodifica.ts). Lo leggono il selettore
 * (avviso dopo «Cerca»), l'iscrizione (/api/seller/apply) e il profilo del negozio; il database
 * ha la stessa regola (migrazione 377).
 *
 * 🟢 Pura: nessuna rete, nessun orologio.
 */
export const RIQUADRO_PIACENZA = { ovest: 9.57, sud: 44.97, est: 9.86, nord: 45.1 } as const;

export function dentroAreaDiPiacenza(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const r = RIQUADRO_PIACENZA;
  return lat >= r.sud && lat <= r.nord && lng >= r.ovest && lng <= r.est;
}

/** Cosa si dice al negozio la cui posizione cade fuori dall'area servita. */
export const POSIZIONE_NEGOZIO_FUORI_AREA =
  "La posizione del negozio è fuori dall'area di Piacenza che serviamo. Cerca l'indirizzo con la città (es. «Via Roma 12, Piacenza») o tocca la mappa sul negozio.";
