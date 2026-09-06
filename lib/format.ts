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
