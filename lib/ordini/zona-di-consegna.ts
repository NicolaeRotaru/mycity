import { RAGGIO_CONSEGNA_KM, RITIRO_IN_NEGOZIO_ATTIVO } from '@/lib/constants';
import { haversineKm } from '@/lib/geo';

/**
 * LA FRASE DELLA ZONA SI SCRIVE QUI.
 * La cassa, la pagina Spedizioni, il rifiuto, la pillola della posizione, le FAQ e il testo di «Vicino a te»
 * la importano da qui: il confine vero (`RAGGIO_CONSEGNA_KM`) e le parole che lo dicono non si separano.
 * Non è ancora «una volta sola»: i metadati di app/near/layout.tsx e di app/category/[slug]/layout.tsx
 * (la descrizione per Google) scrivono ancora a mano «fino a N km dal negozio» e vanno portati qui.
 */
export const CONFINE_DELLA_ZONA = `${RAGGIO_CONSEGNA_KM} km`;
export const FINO_AL_CONFINE = `fino a ${CONFINE_DELLA_ZONA} dal negozio`;
export const FRASE_DELLA_ZONA = `Consegniamo a Piacenza, ${FINO_AL_CONFINE}`;

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
  const troppoLontano = `Per ora consegniamo ${FINO_AL_CONFINE}: il tuo indirizzo è troppo lontano ${dove}.`;
  return RITIRO_IN_NEGOZIO_ATTIVO
    ? `${troppoLontano} Puoi ritirare in negozio.`
    : `${troppoLontano} Prova con un negozio più vicino a te.`;
}

/**
 * 26/11/2026 — DOVE PUÒ STARE UN NEGOZIO, E DOVE SI CERCANO GLI INDIRIZZI: PIACENZA E DINTORNI.
 *
 * Un riquadro solo, qui, perché lo leggono il browser (il selettore della posizione del negozio,
 * il profilo) e il server (la ricerca degli indirizzi in lib/geocodifica.ts, l'iscrizione del
 * negozio). Un negozio fuori da qui non riceve consegne dai clienti di Piacenza: il «Cerca» che
 * trovava la Via Roma di un'altra città lo segnava confermato e il modulo lo salvava.
 * (Coordinate: ovest/est in longitudine, sud/nord in latitudine.)
 */
export const AREA_SERVITA = { ovest: 9.55, sud: 44.93, est: 9.85, nord: 45.15 } as const;

export function dentroLAreaServita(lat: number, lng: number): boolean {
  const a = AREA_SERVITA;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= a.sud && lat <= a.nord && lng >= a.ovest && lng <= a.est;
}

export const FRASE_NEGOZIO_FUORI_AREA =
  'Questa posizione è fuori da Piacenza e dintorni, dove consegniamo: cerca di nuovo l’indirizzo con la città o tocca la mappa sul negozio.';
