/**
 * 22/8/2026 — LA GIORNATA DI CASSA È QUELLA DI PIACENZA.
 *
 * `toISOString()` dà il giorno di Greenwich. D'estate l'Italia è due ore
 * avanti: una consegna delle 23:30 del 15 luglio a Piacenza è l'1:30 del 16 a
 * Greenwich. Chi conta con `toISOString()` la mette nel 16, chi conta col fuso
 * locale la mette nel 15 — e i due non si trovano.
 *
 * Il fattorino quadrava già col fuso giusto. Non lo facevano la funzione del
 * database che conferma la rimessa, né la pagina che l'amministratore guarda
 * mentre conferma. Risultato: nelle sere cariche l'ordine restava appeso e il
 * negozio non veniva pagato, mentre tutti e due guardavano «il 15 luglio».
 *
 * La funzione stava dentro una rotta sola, quindi chi ne aveva bisogno altrove
 * non poteva importarla e riusava `toISOString()`. Adesso ha una casa.
 */

export const FUSO_PIACENZA = 'Europe/Rome';

/** La data (AAAA-MM-GG) nel fuso di Piacenza, non in quello di Greenwich. */
export function giornoLocale(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO_PIACENZA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
