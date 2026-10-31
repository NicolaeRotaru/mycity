import { ETICHETTA_ADESSO, giornoDellaFascia } from '@/lib/quando-arriva';

/**
 * LA FASCIA DI CONSEGNA, DETTA COME UN GIORNO DEL CALENDARIO.
 *
 * ── Cos'è ───────────────────────────────────────────────────────────────────────────────────
 * In cassa il cliente sceglie «quando vuoi riceverlo» e la scelta finisce su
 * `orders.delivery_slot`, così com'era scritta sulla mattonella: «Domani · 9:00–12:00».
 *
 * ── Il difetto (29/10/2026) ─────────────────────────────────────────────────────────────────
 * Quella riga la leggevano solo due controlli automatici. Il negozio, il fattorino e il cliente
 * stesso non la vedevano da nessuna parte: la consegna da 3 euro nella fascia scelta (la
 * promessa per cui il cliente paga) non la poteva mantenere nessuno, perché nessuno la sapeva.
 *
 * E mostrarla così com'è non basta: «Domani» è vero solo il giorno in cui l'ordine è nato.
 * Il negoziante che apre la pagina il giorno dopo leggerebbe «domani» e sbaglierebbe di 24 ore.
 * Qui la si traduce nel giorno vero, contato dalla data di creazione dell'ordine nel fuso di
 * Piacenza: «Domani · 9:00–12:00» su un ordine di lunedì 2/11 diventa «mar 3/11 · 9:00–12:00».
 *
 * ── Le regole ───────────────────────────────────────────────────────────────────────────────
 * - Ciò che si salva NON cambia: si cambia solo come si legge.
 * - La consegna veloce resta «Adesso · arrivo in …»: è una durata, non un giorno.
 * - Ritiro in negozio, fascia vuota, fascia che non è una delle sette ammesse (ordini vecchi
 *   col testo libero) o data dell'ordine illeggibile → `null`. La pagina non mostra niente:
 *   meglio nessuna riga che un orario inventato.
 *
 * 🟢 Puro: nessuna rete, nessun orologio. Il giorno di riferimento è quello dell'ordine.
 */

const FUSO_DI_PIACENZA = 'Europe/Rome';
const GIORNI_DELLA_SETTIMANA = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'] as const;
const SEPARATORE = ' · ';

const giornoNelFuso = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO_DI_PIACENZA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Quanti giorni dopo la data dell'ordine cade la fascia, o `null` se non è una fascia nota. */
function giorniDopoLOrdine(fascia: string): number | null {
  // Le sette di oggi e di domani, e quelle di prima che restano scritte sugli ordini già nati.
  const giorno = giornoDellaFascia(fascia);
  if (giorno === 'oggi') return 0;
  if (giorno === 'domani') return 1;
  return null;
}

/** Il giorno di calendario a Piacenza in cui è nato l'ordine. */
function giornoDellOrdine(creatoIl: string): { anno: number; mese: number; giorno: number } | null {
  const istante = new Date(creatoIl);
  if (Number.isNaN(istante.getTime())) return null;
  const parti = giornoNelFuso.formatToParts(istante);
  const valore = (tipo: string) => Number(parti.find((p) => p.type === tipo)?.value);
  const anno = valore('year');
  const mese = valore('month');
  const giorno = valore('day');
  if (!anno || !mese || !giorno) return null;
  return { anno, mese, giorno };
}

export type OrdineConFascia = {
  delivery_slot?: string | null;
  created_at?: string | null;
  pickup_in_store?: boolean | null;
};

/**
 * La fascia da mostrare a negozio, fattorino e cliente: «mar 3/11 · 9:00–12:00».
 * `null` quando non c'è niente di vero da dire.
 */
export function fasciaLeggibile(ordine: OrdineConFascia): string | null {
  const fascia = ordine.delivery_slot;
  if (ordine.pickup_in_store || !fascia) return null;
  if (fascia === ETICHETTA_ADESSO) return ETICHETTA_ADESSO;

  const spostamento = giorniDopoLOrdine(fascia);
  if (spostamento === null || !ordine.created_at) return null;
  const nato = giornoDellOrdine(ordine.created_at);
  if (!nato) return null;

  // Date.UTC fa da solo il riporto su mese e anno: il 31/12 + 1 è il 1/1.
  const giorno = new Date(Date.UTC(nato.anno, nato.mese - 1, nato.giorno + spostamento));
  const orario = fascia.slice(fascia.indexOf(SEPARATORE) + SEPARATORE.length);
  return `${GIORNI_DELLA_SETTIMANA[giorno.getUTCDay()]} ${giorno.getUTCDate()}/${giorno.getUTCMonth() + 1}${SEPARATORE}${orario}`;
}
