import { ETICHETTA_ADESSO, FASCE_DI_OGGI, finestraDellaFascia, giornoDellaFascia } from '@/lib/quando-arriva';

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

/** Il giorno di calendario a Piacenza in cui è nato l'ordine (o in cui cade un istante qualsiasi). */
function giornoDellOrdine(creatoIl: string | number | Date): { anno: number; mese: number; giorno: number } | null {
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

/** Il giorno di Piacenza come «2026-11-03», o `null` se l'istante è illeggibile. */
export function giornoDiPiacenza(istante: string | number | Date): string | null {
  const g = giornoDellOrdine(istante);
  return g ? `${g.anno}-${String(g.mese).padStart(2, '0')}-${String(g.giorno).padStart(2, '0')}` : null;
}

/** Quanti giorni di calendario di Piacenza separano due istanti, o `null` se uno è illeggibile. */
function giorniFra(da: string | number | Date, a: string | number | Date): number | null {
  const x = giornoDellOrdine(da);
  const y = giornoDellOrdine(a);
  if (!x || !y) return null;
  return Math.round((Date.UTC(y.anno, y.mese - 1, y.giorno) - Date.UTC(x.anno, x.mese - 1, x.giorno)) / 86_400_000);
}

/**
 * 31/10/2026 — LA FASCIA SCELTA IN CASSA, DETTA DAL GIORNO IN CUI NASCE L'ORDINE.
 *
 * Tutti i lettori (`fasciaLeggibile`, la scadenza d'accettazione, l'email al negozio) contano
 * «Oggi» e «Domani» dal giorno di `orders.created_at`. Coi contanti l'ordine nasce quando si
 * sceglie, e il conto torna. Con la carta nasce al webhook: lunedì alle 23:50 si sceglie
 * «Domani · 9:00–11:00» (martedì), alle 00:10 si paga, e un ordine nato martedì con scritto
 * «Domani» diceva mercoledì a tutti. Qui l'etichetta si riporta al giorno dell'ordine:
 * martedì diventa «Oggi · 9:00–11:00». Così la regola resta una sola, per tutti i lettori.
 *
 * `null` = il giorno della fascia è già passato (o non ha un nome nel giorno nuovo): la fascia
 * non si può più mantenere. La veloce e le etichette che non sono fasce tornano come sono.
 * 🟢 Puro: i due istanti li passa chi chiama.
 */
export function fasciaAlGiornoDellOrdine(
  fascia: string,
  sceltaIl: string | number | Date,
  natoIl: string | number | Date,
): string | null {
  const finestra = finestraDellaFascia(fascia);
  if (!finestra) return fascia;
  const passati = giorniFra(sceltaIl, natoIl);
  if (passati === null || passati <= 0) return fascia;
  const giorniDiDistanza = (finestra.giorno === 'domani' ? 1 : 0) - passati;
  if (giorniDiDistanza < 0) return null;
  const stessa = FASCE_DI_OGGI.find((f) => f.daMinuti === finestra.daMinuti && f.aMinuti === finestra.aMinuti);
  return stessa?.etichetta ?? null;
}
