/**
 * L'IBAN DEL RIMBORSO ARRIVA PER EMAIL (decisione di Nicola del 17/10/2026, «Semplifica»).
 *
 * Chi ha pagato in contanti riavrà i soldi con un bonifico fatto a mano. Il sito non chiede l'IBAN
 * in nessun modulo e nel database non c'è un campo dove scriverlo: lo chiede l'email del rimborso,
 * e il cliente risponde con i dati del conto. Qui stanno le parole che l'informativa dice su questo
 * dato e sull'avviso a chi paga: la pagina le legge da qui (`app/privacy/page.tsx`).
 *
 * Quanto restano l'email con l'IBAN nella casella dell'assistenza e l'avviso fra le notifiche degli
 * amministratori non lo decide il codice: nessuna potatura li cancella da sola, e le frasi dicono
 * proprio questo. Il numero lo sceglie Nicola col legale (🔴), come le parole.
 *
 * Collaudo del 17/10, primo giro — UN MESSAGGIO DAI CONTATTI ARRIVA ANCHE PER EMAIL.
 * `app/api/contact/route.ts` manda il messaggio intero, IBAN compreso, alla casella del supporto
 * (`SUPPORT_EMAIL`). La potatura dei due anni tocca solo la copia nel database: quella nella
 * casella resta finché non la cancelliamo. Le frasi lo dicevano prima della semplificazione e
 * l'avevano perso; la prova `l-informativa-dice-quanto-resta-l-iban-mandato-dai-contatti` manda un
 * messaggio vero dalla rotta e pretende che le due frasi dicano della copia.
 */

import { MESI_DEI_MESSAGGI_DEI_CONTATTI } from './potature-ritenzione';

/** Un numero di mesi detto come lo direbbe una persona: 24 → «2 anni», 18 → «18 mesi». */
export function durataDetta(mesi: number): string {
  if (mesi % 12 === 0) return mesi === 12 ? '1 anno' : `${mesi / 12} anni`;
  return `${mesi} mesi`;
}

/** Quanto resta un messaggio dai Contatti: lo stesso numero che usa la potatura notturna. */
const QUANTO_RESTA_UN_MESSAGGIO = durataDetta(MESI_DEI_MESSAGGI_DEI_CONTATTI);

/**
 * Un messaggio dai Contatti arriva anche per email nella casella del supporto, intero: la potatura dei
 * due anni non tocca quella copia.
 */
const LA_COPIA_NELLA_CASELLA =
  "Una copia arriva anche per email nella casella dell'assistenza, e lì resta finché non la cancelliamo.";

/** Dove chiediamo l'IBAN, davvero. */
export const DOVE_CHIEDIAMO_L_IBAN =
  "Non ti chiediamo l'IBAN in nessun modulo del sito e nel nostro database non c'è un campo per l'IBAN del rimborso: " +
  "ce lo mandi rispondendo all'email che ti scriviamo quando parte il rimborso, e la risposta arriva nella casella " +
  "email dell'assistenza. Non scrivere l'IBAN nel modulo Contatti: ti rispondiamo per email. Se lo scrivi lo stesso, " +
  `quel messaggio resta anche fra i messaggi dell'assistenza, al massimo ${QUANTO_RESTA_UN_MESSAGGIO}. ${LA_COPIA_NELLA_CASELLA}`;

/** Perché lo teniamo. */
export const PERCHE_TENIAMO_L_IBAN =
  'Obbligo di rimborsare il consumatore (Codice del Consumo, art. 56; art. 6.1.c GDPR) ed esecuzione del contratto (art. 6.1.b)';

/** Quanto lo teniamo. */
export const QUANTO_TENIAMO_L_IBAN =
  "L'email con il tuo IBAN resta nella casella dell'assistenza finché non la cancelliamo. Il bonifico fatto resta nei " +
  "movimenti del conto di MyCity, con l'IBAN di destinazione, per i 10 anni che la legge chiede per i documenti " +
  "contabili. Se l'IBAN lo scrivi in un messaggio dalla pagina Contatti, quel messaggio resta fra i messaggi " +
  `dell'assistenza al massimo ${QUANTO_RESTA_UN_MESSAGGIO}, come tutti i messaggi dei Contatti. ${LA_COPIA_NELLA_CASELLA}`;

/**
 * L'avviso a chi paga. `refundOrder` lo scrive fra le notifiche di ogni amministratore e lo manda
 * anche per email alla casella dell'assistenza, con dentro l'indirizzo email del cliente: serve a
 * pagarlo anche se poi cancella l'account, perché la cancellazione non tocca le righe degli
 * amministratori. Nessuna potatura lo cancella da solo.
 */
export const L_AVVISO_A_CHI_PAGA =
  "Per un rimborso con bonifico, chi lo fa riceve un avviso interno con l'importo, il numero dell'ordine e il tuo " +
  "indirizzo email, fra le notifiche degli amministratori e nella casella email dell'assistenza. Serve a scriverti " +
  "per pagarti, anche se nel frattempo cancelli l'account. L'avviso resta lì finché non lo cancelliamo noi.";
