/**
 * GLI INDIRIZZI DEL PANNELLO DEMO DEL LINK COL CODICE — 25/11/2026.
 *
 * Nicola: «che il link del preventivo ti porti ad una demo come quella di pane quotidiano». Il link
 * resta /preventivo/<codice> (è quello già mandato ai titolari): ora apre la dashboard della demo, e
 * accanto ci sono le pagine dei servizi e quella dell'abbonamento, dove si sceglie e si accetta.
 * Qui non ci sono icone né React: lo usano le pagine del server e il guscio del browser.
 */
export function indirizziDemo(codice: string) {
  const dashboard = `/preventivo/${codice}`;
  return {
    dashboard,
    abbonamento: `${dashboard}/abbonamento`,
    servizio: (slug: string) => `${dashboard}/servizi/${slug}`,
  };
}
