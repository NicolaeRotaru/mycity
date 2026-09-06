/**
 * 6/9/2026 — I PREZZI USCIVANO SCRITTI ALL'INGLESE: «€12.50» invece di «12,50 €».
 *
 * `formatPrice` costruiva la stringa a mano — `€` attaccato davanti e
 * `toFixed(2)` — quindi in italiano sbagliava tre cose insieme: il punto al
 * posto della virgola, il simbolo prima invece che dopo, e nessun separatore
 * delle migliaia. Un ordine da 1234,50 € arrivava «€1234.50» nel riepilogo di
 * cassa, sul pulsante di pagamento e nell'email «Ordine ricevuto». Per un
 * lettore italiano «€1.234» vuol dire milleduecentotrentaquattro: la cifra
 * costringe a rileggere proprio sulla riga dei soldi.
 *
 * Adesso la fa `Intl.NumberFormat('it-IT')`, cioè la regola della lingua e non
 * una stringa nostra: «12,50 €», «12.345,00 €». Lo stesso codice gira sul
 * server e nel browser, quindi la pagina non cambia sotto le mani a chi la
 * legge (niente disallineamento di idratazione).
 *
 * Lo spazio prima dell'euro è uno spazio unificatore (U+00A0), quello che
 * Intl produce di suo: tiene «12,50» e «€» sulla stessa riga, così il prezzo
 * non si spezza mai a fine riga dentro una scheda stretta.
 *
 * Questa è la casa dei formati: chi ricompone l'importo per conto suo con
 * `toFixed(2)` torna a sbagliare da solo. Si passa da qui.
 */
const PREZZO_IT = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

export const formatPrice = (n: number | string) => PREZZO_IT.format(Number(n));

/**
 * 6/9/2026 — I SOLDI ARRIVANO IN CENTESIMI, E OGNI CANALE SE LI DIVIDEVA DA SOLO.
 *
 * Passo indietro. Gli importi nel database stanno in centesimi interi (3500),
 * non in euro con la virgola: sui numeri interi non esistono errori di
 * arrotondamento, ed e' il motivo per cui li teniamo cosi'. Ma chi deve
 * SCRIVERE quella cifra a una persona la deve prima riportare in euro, e finora
 * ognuno lo faceva sul posto: `(cents / 100).toFixed(2)`. Quel `toFixed` e'
 * l'inglese — rimette il punto al posto della virgola — e chi lo usava ci
 * attaccava davanti l'euro a mano.
 *
 * Esempio vero di oggi. Un ordine da 3500 centesimi: al negoziante arrivava
 * «35,00 €» nell'email e «€35.00» nella notifica sul telefono; il fattorino
 * leggeva «€35.00» sull'etichetta da stampare e «€35.00» nella schermata dove
 * dichiara quanti contanti ha in mano. Stesso ordine, stessa cifra, quattro
 * modi di scriverla. Chi la legge si ferma a controllare se e' lo stesso
 * ordine — e quel dubbio, sulla riga dei soldi, e' il danno.
 *
 * Ripetuto con altre parole: la divisione per cento si fa QUI, in un posto
 * solo, e da qui si passa per `formatPrice`. Chi la rifa' per conto suo torna a
 * scrivere l'inglese senza accorgersene.
 *
 * Attenzione: questa serve a MOSTRARE una cifra a una persona. Il valore che
 * finisce dentro un campo da compilare (`<input type="number">`) non passa di
 * qui: li' il punto decimale serve al browser, e la virgola lo romperebbe.
 */
export const formatPriceFromCents = (cents: number) => formatPrice(cents / 100);

/**
 * 6/9/2026 — La data in lettere portava lo zero davanti al giorno: «03 settembre
 * 2026». In italiano lo zero iniziale si usa solo nella forma tutta numerica
 * (03/09/2026), mai col mese scritto per esteso. `day: 'numeric'` toglie lo zero
 * e lascia intatto il resto.
 */
export const formatDate = (date: string | Date) =>
  new Date(date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Pluralizzatore italiano semplice (singolare/plurale).
 * Per casi più complessi (zero, due, molti) usa Intl.PluralRules.
 */
export function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
