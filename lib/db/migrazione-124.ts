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

/**
 * 22/8/2026 — Le colonne che la 124 aggiunge alla VISTA `seller_public_profiles`.
 *
 * Stanno in un elenco a parte perché il loro «prima della 124» è diverso: sulla
 * tabella `profiles` esistono da sempre, ed è lì che le legge la dashboard del
 * venditore. È solo la vetrina pubblica, che passa dalla vista, a poterle
 * chiedere a un database che non le ha ancora. Tenerle nell'elenco generale
 * avrebbe costretto ad avvolgere sette file che non ne hanno bisogno — un
 * guardiano che grida su tutto è un guardiano che si impara a ignorare.
 */
export const COLONNE_124_VISTA = ['stripe_charges_enabled', 'stripe_payouts_enabled'] as const;

/** La vista su cui quelle due colonne possono ancora non esserci. */
export const VISTA_124 = 'seller_public_profiles';

/** Codici PostgreSQL che dicono «questo pezzo di schema non c'è ancora». */
const SCHEMA_INDIETRO = new Set([
  '42703', // undefined_column
  '42883', // undefined_function
  // 22/8/2026 — mancava, ed è il codice della TABELLA che non c'è ancora
  // (non della colonna). Senza, il ripiego non sarebbe scattato per
  // `payment_attempts`, che è nata dopo: la strada si sarebbe fermata
  // esattamente come prima di avere un ripiego.
  '42P01', // undefined_table
]);

/**
 * 3/9/2026 — «UN VINCOLO QUALSIASI» NON VUOL DIRE «SCHEMA INDIETRO».
 *
 * Qui dentro c'era anche 23514, il codice di PostgreSQL per «hai violato un
 * CHECK». Ci era finito per una ragione vera e stretta: prima della migrazione
 * 124 il vincolo vecchio sugli stati del bonifico non conosceva gli stati
 * nuovi, e li rifiutava. Ma 23514 è il codice di TUTTI i CHECK di quella
 * tabella, non solo di quello.
 *
 * Il giorno dopo la 127, e poi la 146, hanno messo sui soldi i paletti che
 * servivano davvero: il lordo non negativo, il rimborso entro il lordo, il
 * compenso al negozio non più alto dell'incasso. Anche loro rispondono 23514.
 * Così il ripiego, nel momento esatto in cui il database fermava un importo
 * storto, leggeva «migrazione non ancora applicata», toglieva
 * `gross_total_cents` dalla riga e riprovava — e i paletti, che sono tutti
 * scritti «se il lordo c'è», con il lordo vuoto lasciavano passare qualsiasi
 * cifra. Un ordine da 10 euro con 11 euro di compenso al negozio entrava, e
 * nel registro restava scritta la diagnosi sbagliata.
 *
 * Adesso il 23514 si accetta SOLO se l'errore nomina uno dei due vincoli di
 * stato che la 124 riscrive. Un paletto sui soldi torna com'è: un errore, che
 * ferma la scrittura e si vede. La regola generale, per chi scriverà il
 * prossimo ripiego: si distingue per NOME del vincolo o della colonna, mai per
 * famiglia di codice.
 */
const VINCOLI_DI_STATO_124 = ['orders_payout_status_check', 'orders_rider_payout_status_check'] as const;

/** L'errore nomina uno dei due vincoli di stato che la 124 riscrive? */
function nominaUnVincoloDiStato(errore: unknown): boolean {
  const e = errore as { message?: unknown; details?: unknown } | null;
  const testo = `${typeof e?.message === 'string' ? e.message : ''} ${typeof e?.details === 'string' ? e.details : ''}`;
  return VINCOLI_DI_STATO_124.some((vincolo) => testo.includes(vincolo));
}

export function eSchemaIndietro(errore: unknown): boolean {
  const code = (errore as { code?: string } | null)?.code;
  if (!code) return false;
  // 23514 = un CHECK qualsiasi. Vale come «schema indietro» solo quando dice
  // quale, ed è uno dei due sugli stati del bonifico. Un CHECK senza nome, o
  // con il nome di un paletto sui soldi, resta un errore vero.
  if (code === '23514') return nominaUnVincoloDiStato(errore);
  return SCHEMA_INDIETRO.has(code);
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

/**
 * 22/8/2026 — IL RAMO DI RIPIEGO HA LA STESSA FORMA DI QUELLO PRINCIPALE.
 *
 * Il ripiego costruisce la lista delle colonne a runtime (`senzaColonne`), e
 * PostgREST le colonne le deduce solo da una stringa scritta a mano: una
 * costruita al volo gli risulta «stringa generica», e i due rami di
 * `conRipiegoSchema` finiscono con due tipi diversi.
 *
 * Questa funzione dichiara quello che è vero: il ripiego restituisce le stesse
 * righe, con una colonna in meno — che il codice a valle legge come
 * `undefined`, ed è esattamente il comportamento voluto.
 */
export function stessaFormaDi<T>(ramoDiRipiego: PromiseLike<unknown>): PromiseLike<T> {
  return ramoDiRipiego as PromiseLike<T>;
}
