/**
 * 5/11/2026 (S04, scheda 482) — COME SI RICONOSCE UN «NO» DEL DATABASE.
 *
 * Le due prove d'integrazione accettavano come «negato» qualsiasi errore: un errore di rete, un
 * indirizzo sbagliato, un database spento erano «permesso negato», e la CI scriveva «girate» su
 * prove che non avevano guardato niente. E sulle funzioni, una che l'anonimo PUÒ eseguire ma che
 * si ferma con «ordine non trovato» (l'id usato è tutto zeri) risultava «negata».
 *
 * Qui un «no» è solo un no del database: il permesso negato di Postgres (42501), o — per una
 * funzione che PostgREST non espone a quel ruolo — PGRST202. Tutto il resto è un guasto, e la prova
 * deve cadere.
 */
export type ErroreDb = { code?: string | null; message?: string | null } | null;

/** Codici con cui il database dice «non puoi». */
const NO_DEL_DATABASE = new Set(['42501', 'PGRST202']);

export function eUnNoDelDatabase(errore: ErroreDb): boolean {
  return !!errore && NO_DEL_DATABASE.has(String(errore.code ?? ''));
}

/**
 * Una lettura è negata se il database dice «non puoi» oppure risponde senza errore e senza righe
 * (la regola per riga che filtra in silenzio). Un errore qualsiasi NON è un «negato».
 */
export function letturaNegata(esito: { data: unknown[] | null; error: ErroreDb }): boolean {
  if (esito.error) return eUnNoDelDatabase(esito.error);
  return (esito.data ?? []).length === 0;
}

/** Una chiamata di funzione è negata solo se il database dice «non puoi». */
export function chiamataNegata(errore: ErroreDb): boolean {
  return eUnNoDelDatabase(errore);
}
