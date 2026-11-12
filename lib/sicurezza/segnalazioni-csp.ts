/**
 * 12/11/2026 (R06-025) — DOVE IL BROWSER SEGNALA LE VIOLAZIONI DELLA POLITICA.
 *
 * La Content-Security-Policy del middleware (`report-uri` e `report-to`) e
 * l'header Reporting-Endpoints puntano qui; la rotta app/api/csp-report scrive
 * le segnalazioni nei log. Un posto solo per l'indirizzo, cosi' politica e
 * rotta non possono separarsi.
 */
export const INDIRIZZO_SEGNALAZIONI_CSP = '/api/csp-report';

/** Il nome del punto di raccolta per `report-to` e Reporting-Endpoints. */
export const GRUPPO_SEGNALAZIONI_CSP = 'csp';

/** L'header Reporting-Endpoints che accompagna la politica. */
export function reportingEndpoints(): string {
  return `${GRUPPO_SEGNALAZIONI_CSP}="${INDIRIZZO_SEGNALAZIONI_CSP}"`;
}
