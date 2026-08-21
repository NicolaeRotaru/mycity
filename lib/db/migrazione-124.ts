import { logger } from '@/lib/logger';

/**
 * IL CODICE DEVE REGGERE ANCHE PRIMA CHE LA MIGRAZIONE SIA APPLICATA.
 *
 * Nel progetto il codice e le migrazioni viaggiano su due firme separate: unire
 * una richiesta pubblica il codice, applicare la migrazione al database è
 * un'azione a parte. Fra le due c'è sempre una finestra — minuti se qualcuno
 * guarda, ore se non guarda nessuno.
 *
 * Tutti i lotti precedenti l'avevano coperta: «le altre riparazioni hanno tutte
 * un ripiego verificato nel codice, funzionano come prima senza rompersi». Il
 * lotto del 21 agosto no, ed è un difetto mio. Le colonne nuove della
 * migrazione 124 finivano dentro le istruzioni senza condizioni, e PostgreSQL
 * non è indulgente: una colonna che non esiste non viene ignorata, fa fallire
 * l'istruzione INTERA. Il risultato, dal minuto dell'unione a quello della
 * firma sul database, era che **non si poteva creare nessun ordine**.
 *
 * Qui c'è il ripiego. Si prova con i campi nuovi; se il database risponde «non
 * esiste», si riprova senza e si scrive un avviso forte. Quando la migrazione
 * è applicata, il primo tentativo riesce sempre e questo codice non fa niente.
 *
 * Va tolto quando la 124 è applicata dappertutto. Finché c'è, la prova in
 * `tests/unit/prima-della-migrazione-124.test.ts` garantisce che l'ordine nasca
 * in tutti e due i mondi.
 */

/** I campi dell'ordine che nascono con la migrazione 124. */
export const CAMPI_124 = ['gross_total_cents'] as const;

/** Le colonne che la 124 aggiunge e che una `select` non può chiedere prima. */
export const COLONNE_124 = ['gross_total_cents', 'payout_tentativo', 'rider_payout_tentativo'] as const;

/** Codici PostgreSQL che dicono «questo pezzo di schema non c'è ancora». */
const SCHEMA_INDIETRO = new Set([
  '42703', // undefined_column
  '42883', // undefined_function
  '23514', // check_violation — uno stato nuovo rifiutato dal vincolo vecchio
]);

export function eSchemaIndietro(errore: unknown): boolean {
  const code = (errore as { code?: string } | null)?.code;
  return !!code && SCHEMA_INDIETRO.has(code);
}

/**
 * Esegue `conNuovo`; se il database dice che lo schema è indietro, esegue
 * `senzaNuovo` e lo annota. L'avviso è volutamente rumoroso: questa strada non
 * deve diventare la normalità silenziosa.
 */
export async function conRipiegoSchema<T extends { error: unknown }>(
  dove: string,
  conNuovo: () => PromiseLike<T>,
  senzaNuovo: () => PromiseLike<T>,
): Promise<T> {
  const primo = await conNuovo();
  if (!primo.error || !eSchemaIndietro(primo.error)) return primo;

  logger.warn('[db] migrazione 124 non ancora applicata: proseguo senza i campi nuovi', {
    dove,
    codice: (primo.error as { code?: string }).code,
  });
  return senzaNuovo();
}

/** Toglie da un oggetto i campi che esistono solo dopo la migrazione 124. */
export function senzaCampi<T extends Record<string, unknown>>(riga: T, campi: readonly string[]): T {
  const fuori = { ...riga };
  for (const c of campi) delete fuori[c];
  return fuori;
}

/** Toglie da una `select` PostgREST le colonne che esistono solo dopo la 124. */
export function senzaColonne(select: string, colonne: readonly string[]): string {
  const da = new Set(colonne);
  return select
    .split(',')
    .map((c) => c.trim())
    .filter((c) => !da.has(c))
    .join(', ');
}
