/**
 * Quando arriva l'ordine: quali fasce si possono davvero scegliere, e cosa si scrive sull'ordine.
 *
 * TRE DIFETTI NELLO STESSO RIQUADRO — «Quando vuoi riceverlo», al checkout, un attimo prima di
 * pagare. Tutti e tre dicono alla persona un orario che non può succedere.
 *
 * ① L'ORDINE NASCEVA CON UN APPUNTAMENTO GIÀ PASSATO. Le fasce di oggi finiscono alle 18 e alle
 *    20. Dalle 20:00 in poi non ne resta nessuna, e la lista si svuota. Ma il giorno restava
 *    «oggi» — la mattonella non si spegneva mai — e la fascia di partenza ripiegava sulla PRIMA
 *    voce, «In giornata · 15:00–18:00». Quella stringa finiva nel corpo della richiesta e su
 *    `orders.delivery_slot`. Alle 21:40 nasceva un ordine con scritto sopra «arriva fra le 15 e le
 *    18», e nessuno lo fermava. Non è un testo sbagliato: è un appuntamento nel passato preso con
 *    un negoziante che poi deve consegnarlo.
 *
 * ② TRE PROMESSE DIVERSE NELLO STESSO RIQUADRO. La mattonella «Adesso» diceva «~30–45 min», la
 *    riga sotto «In 30-60 minuti dalla conferma del negozio», e la fascia preselezionata «In
 *    giornata · 15:00–18:00». Tre risposte alla stessa domanda, nel momento della decisione.
 *
 * ③ LA RIGA CHE NON ASCOLTAVA. Quel «In 30-60 minuti» era un testo fisso: chi sceglieva «Domani ·
 *    9:00–12:00» continuava a leggere che arrivava in mezz'ora.
 *
 * ── Perché un file invece di tre correzioni ─────────────────────────────────────────────────
 * Perché la radice è una sola: **non esisteva un posto che rispondesse alla domanda**. Il numero
 * dei minuti stava scritto a mano in due punti mentre `EXPRESS_ETA_LABEL` esiste dal giorno in cui
 * qualcuno l'ha deciso; la fascia di partenza la sceglieva una funzione che non sapeva dire «oggi
 * non si può»; e la mattonella «Oggi» non chiedeva niente a nessuno. Correggere i tre testi lascia
 * in piedi il meccanismo, e il quarto punto nasce sbagliato il mese prossimo.
 *
 * ── La regola, ed è la stessa di tutta questa casa ──────────────────────────────────────────
 * Le risposte sono TRE, non due: **non serve** (ritiro in negozio) · **questa fascia** ·
 * **non-valida**. La terza è quella che mancava, e ripiegava sulla peggiore. Un ordine con una
 * fascia non valida NON parte: la conferma resta ferma e lo dice.
 *
 * 🟢 Puro: nessuna rete, nessun orologio dentro. L'ora si passa da fuori — così le prove possono
 * mettersi alle 21:40 senza aspettare le 21:40.
 */
import { EXPRESS_ETA_LABEL } from './delivery';

export type Giorno = 'now' | 'today' | 'tomorrow';

/**
 * Le fasce di oggi, ognuna con l'ora in cui FINISCE.
 *
 * L'ora di fine è il campo che conta: una fascia è ancora proponibile finché non è finita, non
 * finché non è cominciata. Alle 16 «15:00–18:00» va ancora bene.
 */
export const FASCE_DI_OGGI: { etichetta: string; oraDiFine: number }[] = [
  { etichetta: 'In giornata · 15:00–18:00', oraDiFine: 18 },
  { etichetta: 'Stasera · 18:00–20:00', oraDiFine: 20 },
];

export const FASCE_DI_DOMANI = [
  'Domani · 9:00–12:00',
  'Domani · 12:00–15:00',
  'Domani · 15:00–18:30',
  'Domani · 18:30–20:00',
];

/** La finestra in cui un rider c'è davvero. Fuori da qui l'express non si offre. */
export const APERTURA_EXPRESS = 8;
export const CHIUSURA_EXPRESS = 21;

/** La promessa dell'express, presa da dove è decisa e non riscritta a mano. */
export const ETICHETTA_ADESSO = `Adesso · arrivo in ${EXPRESS_ETA_LABEL}`;
export const SOTTOTITOLO_ADESSO = EXPRESS_ETA_LABEL;

/**
 * TUTTE le fasce che la cassa può davvero proporre. Sette, e non una di più.
 *
 * ⚠️ Questo elenco è un CANCELLO, non una comodità. La fascia scelta viaggia dal browser fino
 * alle due rotte che creano gli ordini, e lì decide se il negozio può servire: una fascia per
 * domani fa guardare gli orari di domani invece dell'orologio di adesso. Finché era testo
 * libero bastava scrivere la parola «domani» per far rispondere «sì» a un negozio chiuso —
 * alle 3 di notte nasceva un ordine che nessuno avrebbe preparato.
 *
 * Chi aggiunge una fascia la aggiunge qui sopra e la trova ammessa da sola. Chi ne inventa una
 * dal browser non entra: `lib/ordini/fascia-consegna.ts` rifiuta la richiesta, e
 * `lib/store-hours.ts` non la legge nemmeno come una finestra.
 */
export const FASCE_AMMESSE: readonly string[] = [
  ETICHETTA_ADESSO,
  ...FASCE_DI_OGGI.map((f) => f.etichetta),
  ...FASCE_DI_DOMANI,
];

/** Vero solo per le sette etichette qui sopra. Il confronto è esatto: niente interpretazioni. */
export function fasciaAmmessa(valore: unknown): valore is string {
  return typeof valore === 'string' && FASCE_AMMESSE.includes(valore);
}

/** Le fasce di oggi non ancora passate. Vuota dopo l'ultima. */
export function fasceAncoraPossibili(ora: number): string[] {
  return FASCE_DI_OGGI.filter((f) => f.oraDiFine > ora).map((f) => f.etichetta);
}

/** «Oggi» si può ancora scegliere? Dalle 20:00 in poi, no. */
export function oggiSiPuoAncora(ora: number): boolean {
  return fasceAncoraPossibili(ora).length > 0;
}

/** L'express si può offrire adesso? */
export function expressSiPuo(ora: number): boolean {
  return ora >= APERTURA_EXPRESS && ora < CHIUSURA_EXPRESS;
}

/**
 * Il giorno da cui partire, aprendo il checkout.
 *
 * Mai uno che non si può scegliere: era il difetto ①, dove si partiva da «oggi» anche a mezzanotte
 * e la fascia ripiegava su una del pomeriggio passato.
 */
export function giornoDiPartenza(ora: number): Giorno {
  return oggiSiPuoAncora(ora) ? 'today' : 'tomorrow';
}

/** La fascia da cui partire per «oggi»: la prima ancora possibile, o nessuna. */
export function fasciaDiPartenzaOggi(ora: number): string | null {
  return fasceAncoraPossibili(ora)[0] ?? null;
}

/** Le tre risposte. La terza è quella che mancava. */
export type Consegna =
  | { tipo: 'non-serve' }
  | { tipo: 'scelta'; etichetta: string }
  | { tipo: 'non-valida'; perche: string };

/**
 * Cosa si scrive sull'ordine.
 *
 * ⚠️ `non-serve` e `non-valida` NON sono la stessa cosa, e prima lo erano: tutt'e due finivano in
 * un `null`, cioè in un ordine spedito senza fascia. Il ritiro in negozio non ha bisogno di una
 * fascia; una fascia passata è un ordine da fermare.
 */
export function consegnaScelta(s: {
  giorno: Giorno;
  ora: number;
  fasciaOggi: string;
  fasciaDomani: string;
  ritiroInNegozio: boolean;
}): Consegna {
  if (s.ritiroInNegozio) return { tipo: 'non-serve' };

  if (s.giorno === 'now') {
    if (!expressSiPuo(s.ora)) {
      return { tipo: 'non-valida', perche: 'A quest’ora la consegna immediata non è disponibile. Scegli una fascia di domani.' };
    }
    return { tipo: 'scelta', etichetta: ETICHETTA_ADESSO };
  }

  if (s.giorno === 'today') {
    const possibili = fasceAncoraPossibili(s.ora);
    if (possibili.length === 0) {
      return { tipo: 'non-valida', perche: 'Per oggi non ci sono più fasce disponibili. Scegli Domani.' };
    }
    if (!possibili.includes(s.fasciaOggi)) {
      return { tipo: 'non-valida', perche: 'La fascia scelta è già passata. Scegline una ancora disponibile.' };
    }
    return { tipo: 'scelta', etichetta: s.fasciaOggi };
  }

  if (!FASCE_DI_DOMANI.includes(s.fasciaDomani)) {
    return { tipo: 'non-valida', perche: 'Scegli una fascia per domani.' };
  }
  return { tipo: 'scelta', etichetta: s.fasciaDomani };
}

/** L'etichetta da mandare all'ordine: `null` SOLO quando la fascia non serve. */
export function etichettaPerLOrdine(c: Consegna): string | null {
  return c.tipo === 'scelta' ? c.etichetta : null;
}

/** Si può confermare l'ordine? No su `non-valida`: è il freno che mancava. */
export function siPuoConfermare(c: Consegna): boolean {
  return c.tipo !== 'non-valida';
}

/**
 * La riga sotto le mattonelle, che prima diceva sempre «In 30-60 minuti».
 *
 * Adesso segue la scelta: chi ha scelto domani legge domani. Era il difetto ③.
 */
export function rigaQuandoArriva(c: Consegna): string {
  if (c.tipo === 'non-serve') return 'Ritiro in negozio: nessuna consegna.';
  if (c.tipo === 'non-valida') return c.perche;
  if (c.etichetta === ETICHETTA_ADESSO) {
    return `In ${EXPRESS_ETA_LABEL} dalla conferma del negozio`;
  }
  return c.etichetta;
}
