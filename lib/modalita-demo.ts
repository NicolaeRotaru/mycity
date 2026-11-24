/**
 * LA MODALITÀ DEMO — 24/11/2026.
 *
 * Nicola: «Tutte le attività che si iscrivono però non hanno effettuato il loro pagamento entrano
 * sulla piattaforma in modalità demo e la loro vetrina non è visibile ancora sul marketplace».
 * La regola vera sta nel database (public.negozio_in_vetrina, migrazione 709): qui si decide solo
 * cosa dire al negozio nella sua dashboard. Dal 24/11 lo dice il riquadro «Abbonamento»
 * (lib/agenzia/riquadro-abbonamento.ts), che legge lo stesso `negozio_in_vetrina`.
 *
 * Un negozio approvato che il database non mette in vetrina è in demo: prepara vetrina e prodotti,
 * ma il pubblico non li vede finché non attiva un abbonamento ai servizi. Se la domanda al database
 * non riesce (`inVetrina` null) non si dice niente: meglio nessun avviso che uno falso.
 */
export function inModalitaDemo(stato: { approvato: boolean; inVetrina: boolean | null | undefined }): boolean {
  return stato.approvato && stato.inVetrina === false;
}
