/**
 * S10 (5/11/2026) — Che cosa vuol dire l'errore di Supabase all'accesso.
 *
 * `signInWithPassword` non lancia: restituisce l'errore, anche quando la rete
 * e' caduta o il servizio risponde 5xx. Prima tutto diventava «Email o password
 * non corretti», e chi aveva la password giusta la cambiava per niente.
 */
export type EsitoErroreDiAccesso = 'credenziali' | 'troppi_tentativi' | 'servizio_giu';

export function esitoErroreDiAccesso(
  errore: { code?: unknown; status?: unknown; name?: unknown } | null | undefined,
): EsitoErroreDiAccesso {
  const codice = typeof errore?.code === 'string' ? errore.code : '';
  const stato = typeof errore?.status === 'number' ? errore.status : undefined;
  const nome = typeof errore?.name === 'string' ? errore.name : '';
  if (codice === 'over_request_rate_limit' || stato === 429) return 'troppi_tentativi';
  if (nome === 'AuthRetryableFetchError' || stato === 0 || (stato !== undefined && stato >= 500)) {
    return 'servizio_giu';
  }
  return 'credenziali';
}
