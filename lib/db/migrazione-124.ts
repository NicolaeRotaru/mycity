import { createClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { requireSupabaseService } from '@/lib/env';

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

/**
 * 30/10/2026 — UNA SCRITTURA NON ARRIVA A POSTGRESQL: LA FERMA PRIMA POSTGREST.
 *
 * I codici qui sopra sono di PostgreSQL, e tornano quando la richiesta arriva
 * al database: è il caso di una LETTURA che chiede `gross_total_cents` (42703).
 * Una SCRITTURA che la porta no: PostgREST confronta i campi con lo schema che
 * ha in memoria e risponde da solo `PGRST204 — Could not find the
 * 'gross_total_cents' column of 'orders' in the schema cache`. Senza questo
 * codice il ripiego di ogni `update`/`insert` con i campi della 124 non
 * scattava mai: dopo il rifiuto di un negozio il segno dell'annullo cadeva, il
 * ricalcolo del carrello si fermava e la carta rendeva 18 € invece di 16
 * (collaudo dell'ondata 16; era il debito dichiarato in `migrazione-148.ts`).
 *
 * Come per il 23514, per NOME: PGRST204 vale solo se nomina una colonna che
 * nasce con la 124. Un nome scritto male nel codice resta un errore vero.
 */
/**
 * 31/10/2026 — LE ORE DEI TURNI DEI BONIFICI NASCONO CON LA 126, NON CON LA 124.
 *
 * Il turno del bonifico (al negozio e al fattorino) scrive l'ora in cui è
 * stato preso, e il suo ripiego la toglie se il database non ce l'ha. Ma il
 * riconoscimento del PGRST204 qui sotto guardava solo le colonne della 124:
 * su un database senza la 126 — la produzione di oggi — PostgREST rispondeva
 * «Could not find the 'payout_claimed_at' column», il ripiego non scattava e
 * ogni bonifico finiva in TRANSFER_FAILED prima di partire. Sempre per NOME:
 * valgono solo queste due, che sono quelle che il ripiego toglie davvero.
 */
export const COLONNE_126_DEI_TURNI = ['payout_claimed_at', 'rider_payout_claimed_at'] as const;

/** La colonna della 124 (o delle ore dei turni della 126) che l'errore nomina, se ne nomina una. */
function colonnaNuovaNominata(errore: unknown): string | undefined {
  const e = errore as { message?: unknown; details?: unknown } | null;
  const testo = `${typeof e?.message === 'string' ? e.message : ''} ${typeof e?.details === 'string' ? e.details : ''}`;
  // Il bordo di parola tiene fuori i nomi più lunghi (`gross_total_cents_bis`):
  // `_` conta come lettera, quindi `payout_tentativo` non si trova dentro `rider_payout_tentativo`.
  return [...COLONNE_124, ...COLONNE_126_DEI_TURNI].find((colonna) => new RegExp(`\\b${colonna}\\b`).test(testo));
}

function nominaUnaColonna124(errore: unknown): boolean {
  return colonnaNuovaNominata(errore) !== undefined;
}

/**
 * 13/11/2026 (R23-003) — PGRST204 NON DICE SE LA COLONNA MANCA O SE POSTGREST NON LO SA ANCORA.
 *
 * PostgREST risponde PGRST204 confrontando la scrittura con lo schema che tiene in memoria. Con
 * la migrazione applicata e la memoria vecchia (la ricarica dello schema non gli è arrivata) la
 * risposta è identica a quella di prima della migrazione: il ripiego scattava e la scrittura
 * saltava `gross_total_cents` (o il numero del tentativo del bonifico) su un database che li ha.
 * Per ogni chiamante di `conRipiegoSchema`, non solo per l'annullo: un ordine senza lordo, e i
 * paletti sui soldi, scritti «se il lordo c'è», non fermavano più niente.
 *
 * Adesso, prima di rinunciare alla colonna, si chiede al database con una LETTURA della sola
 * colonna: una lettura arriva a PostgreSQL, non si ferma alla memoria di PostgREST. Tabella e
 * colonna si prendono dal messaggio del PGRST204, non dalla richiesta: chi avvolge la scrittura
 * in una funzione (il turno del bonifico in `lib/stripe/payout.ts`) non passa una richiesta da
 * interrogare, e il controllo prima non partiva. Si legge con le credenziali del client admin del
 * sito (`lib/supabase/server.ts` lo crea così): quel file non si può importare da qui, perché
 * questo modulo lo usano anche pagine del browser (`app/stores/page.tsx`) e lui porta
 * `next/headers`. Nel browser la chiave non c'è: niente lettura, si fa come prima.
 * Se la colonna c'è, niente ripiego: resta l'errore, e si vede. Se la lettura dice che non c'è,
 * o non si può fare, si fa come prima. `leggiAGradini` fa solo letture, che PostgREST non ferma
 * con PGRST204: lì il caso non nasce.
 */
const MESSAGGIO_PGRST204 = /Could not find the '([^']+)' column of '([^']+)' in the schema cache/;

async function colonnaCheIlDatabaseHa(tabella: string, colonna: string): Promise<boolean> {
  if (typeof window !== 'undefined') return false;
  try {
    const { url, key } = requireSupabaseService();
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await admin.from(tabella).select(colonna).limit(1);
    return !error;
  } catch {
    return false;
  }
}

/**
 * R23-003 — Questo PGRST204 nomina una colonna che il database HA? Allora non è lo schema
 * indietro, è la memoria di PostgREST vecchia: nessun ripiego deve togliere quella colonna.
 * Per `conRipiegoSchema` e per i ripieghi fatti a mano che riconoscono l'errore con
 * `eSchemaIndietro` o `colonnaNonTrovata` (lib/db/migrazione-148.ts). Lo annota lei.
 */
export async function memoriaDiPostgrestVecchia(errore: unknown, dove: string): Promise<boolean> {
  const e = errore as { code?: unknown; message?: unknown } | null;
  if (e?.code !== 'PGRST204' || typeof e.message !== 'string') return false;
  const trovato = MESSAGGIO_PGRST204.exec(e.message);
  if (!trovato) return false;
  const [, colonna, tabella] = trovato;
  if (!(await colonnaCheIlDatabaseHa(tabella, colonna))) return false;
  logger.error(
    "[db] PostgREST ha in memoria uno schema vecchio: la colonna c'è nel database ma la scrittura è rifiutata. " +
      "Niente ripiego (salterebbe la colonna): la scrittura resta rifiutata finché lo schema non si ricarica (NOTIFY pgrst, 'reload schema')",
    { dove, tabella, colonna, codice: 'PGRST204' },
  );
  return true;
}

export function eSchemaIndietro(errore: unknown): boolean {
  const code = (errore as { code?: string } | null)?.code;
  if (!code) return false;
  // 23514 = un CHECK qualsiasi. Vale come «schema indietro» solo quando dice
  // quale, ed è uno dei due sugli stati del bonifico. Un CHECK senza nome, o
  // con il nome di un paletto sui soldi, resta un errore vero.
  if (code === '23514') return nominaUnVincoloDiStato(errore);
  // PGRST204 = PostgREST non trova una colonna in una scrittura. Vale solo se è una della 124.
  if (code === 'PGRST204') return nominaUnaColonna124(errore);
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
  // R23-003 — PostgREST non vede una colonna che il database ha: la sua memoria è vecchia, non la migrazione.
  if (await memoriaDiPostgrestVecchia(primo.error, dove)) return primo;

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
