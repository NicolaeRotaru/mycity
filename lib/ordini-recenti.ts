/**
 * QUANDO È SUCCESSO — e un ordine di tre giorni fa non si scrive «18:42».
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────
 * La pagina «Today» dell'amministrazione è la prima che si apre la mattina. In
 * cima sette numeri che partono da mezzanotte: ordini di oggi, incasso di oggi,
 * consegnati, nuovi iscritti. In fondo una tabella, «Ultimi 10 ordini», che di
 * mezzanotte non sapeva niente: prendeva gli ultimi dieci ordini ESISTENTI, di
 * qualunque giorno. E la colonna «Quando» li stampava con `toLocaleTimeString`,
 * cioè ora e minuti e basta.
 *
 * Alle nove di mattina, con zero ordini nuovi, la stessa schermata diceva due
 * cose opposte: il riquadro «Ordini oggi: 0» e sotto dieci righe con orari
 * plausibili — «18:42», «19:05» — che erano di giovedì scorso. Fra i due vince
 * quello che sembra più concreto: l'elenco. Con i volumi di oggi, pochi ordini
 * al giorno, questo non era il caso raro: era il caso normale. E la frase del
 * riquadro vuoto, «Nessun ordine ancora oggi», prometteva pure che lì dentro ci
 * fossero gli ordini di oggi.
 *
 * ── La regola, ed è la stessa di `lib/stato-vista.ts` ────────────────────────
 * Un elenco non può essere mostrato sotto una finestra di tempo che non è la
 * sua. Quindi due cose, e nessuna delle due è un testo scritto a mano:
 *
 *  ① **La finestra viaggia col dato.** `leggiCruscottoOggi` dichiara quanti
 *     giorni indietro ha davvero guardato, e il titolo e la frase del vuoto
 *     nascono da quel numero (`intestazioneOrdiniRecenti`). Se domani la
 *     finestra cambia, le parole cambiano da sole: non c'è più una prosa da
 *     ricordarsi di aggiornare, quindi non c'è più una prosa da dimenticare.
 *  ② **Il giorno non si può nascondere.** `etichettaQuando` vuole per forza
 *     l'ora di adesso, e l'ora nuda la restituisce SOLO se la riga è di oggi.
 *     Ieri diventa «ieri 18:42», l'altro ieri «3 set 18:42». Non esiste un ramo
 *     in cui una riga vecchia esce vestita da stamattina.
 *
 * Il precedente c'era già e stava nel posto sbagliato: `app/rider/history` ha
 * la sua `dayLabel` privata, «Oggi / Ieri / data lunga», scritta dentro il
 * componente. Lì dentro nessuna prova la può eseguire, e infatti quando è
 * servita di nuovo — qui — nessuno se n'è ricordato. Adesso sta in `lib/`.
 *
 * 🟢 Puro: nessuna rete, nessun React, nessun orologio dentro. L'ora si passa da
 * fuori — così una prova può mettersi alle nove di mattina senza aspettarle.
 */

import { NON_LETTO } from './letture-cruscotto';

/** Quanti ordini recenti mostra il cruscotto. Il numero sta scritto una volta. */
export const QUANTI_ORDINI_RECENTI = 10;

/**
 * Quanti giorni indietro guarda la tabella «ultimi ordini».
 *
 * Non zero: alle nove di mattina un elenco vuoto non aiuta nessuno, e sapere
 * com'è finita ieri sera è metà del motivo per cui si apre questa pagina. Non
 * infinito: oltre una settimana non è più «cosa sta succedendo», è storico, e
 * lo storico si guarda in /admin/orders, che è fatto apposta.
 */
export const GIORNI_DI_ORDINI_RECENTI = 7;

/** I mesi scritti a mano: così l'etichetta è la stessa ovunque giri la prova. */
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];

const due = (n: number) => String(n).padStart(2, '0');

/** Mezzanotte del giorno in cui cade `d`, ora locale — come il resto del cruscotto. */
function mezzanotte(d: Date): number {
  const m = new Date(d);
  m.setHours(0, 0, 0, 0);
  return m.getTime();
}

/**
 * Quanti giorni di calendario separano `quando` da `adesso`.
 * 0 = oggi, 1 = ieri, negativo = nel futuro (orologi che non vanno d'accordo).
 */
export function giorniDiDistanza(quando: Date, adesso: Date): number {
  return Math.round((mezzanotte(adesso) - mezzanotte(quando)) / 86_400_000);
}

/**
 * Cosa si scrive nella colonna «Quando».
 *
 * L'ora da sola esce solo per gli ordini di oggi: è l'unico caso in cui «18:42»
 * non nasconde niente. Per tutti gli altri il giorno c'è, e se l'anno è un
 * altro c'è anche l'anno — se no il 3 settembre dell'anno scorso si legge
 * uguale al 3 settembre di quest'anno.
 *
 * Una data che non si riesce a leggere non diventa «00:00»: diventa il trattino
 * di `lib/letture-cruscotto`, che è il segno con cui in questa casa si dice
 * «questo non l'ho potuto sapere».
 */
export function etichettaQuando(quando: string | Date | null | undefined, adesso: Date): string {
  if (quando === null || quando === undefined || quando === '') return NON_LETTO;
  const d = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(d.getTime())) return NON_LETTO;

  const ora = `${due(d.getHours())}:${due(d.getMinutes())}`;
  const distanza = giorniDiDistanza(d, adesso);
  if (distanza === 0) return ora;
  if (distanza === 1) return `ieri ${ora}`;

  const giorno = `${d.getDate()} ${MESI[d.getMonth()]}`;
  const anno = d.getFullYear() === adesso.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${giorno}${anno} ${ora}`;
}

/** Il titolo della sezione e la frase da scrivere quando non c'è nessuna riga. */
export interface IntestazioneOrdiniRecenti {
  titolo: string;
  vuoto: string;
}

/**
 * Titolo e frase-del-vuoto della tabella, ricavati dalla finestra che la
 * lettura ha DAVVERO guardato.
 *
 * `giorni` arriva dal risultato di `leggiCruscottoOggi`, non dalla memoria di
 * chi scrive la pagina: è il punto di tutto. Se il numero non arriva — una
 * lettura vecchia, un finto in una prova — non si tira a indovinare «oggi»: si
 * scrive la cosa vera anche senza sapere la finestra.
 */
export function intestazioneOrdiniRecenti(giorni: number | null | undefined): IntestazioneOrdiniRecenti {
  // `Number(null)` fa zero, e zero qui vorrebbe dire «oggi»: cioè il dato che
  // manca si travestirebbe da risposta sicura — esattamente il difetto che
  // questo file esiste per chiudere. Il buco si scarta prima di contare.
  const n = giorni === null || giorni === undefined ? Number.NaN : Number(giorni);
  if (!Number.isFinite(n) || n < 0) {
    return { titolo: 'Ultimi ordini', vuoto: 'Nessun ordine da mostrare.' };
  }
  const quanti = Math.trunc(n);
  if (quanti === 0) {
    return {
      titolo: `Ultimi ${QUANTI_ORDINI_RECENTI} ordini di oggi`,
      vuoto: 'Nessun ordine ancora oggi.',
    };
  }
  if (quanti === 1) {
    return {
      titolo: `Ultimi ${QUANTI_ORDINI_RECENTI} ordini · ultime 24 ore`,
      vuoto: 'Nessun ordine nelle ultime 24 ore.',
    };
  }
  return {
    titolo: `Ultimi ${QUANTI_ORDINI_RECENTI} ordini · ultimi ${quanti} giorni`,
    vuoto: `Nessun ordine negli ultimi ${quanti} giorni.`,
  };
}
