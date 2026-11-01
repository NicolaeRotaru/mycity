import {
  raccogliAFinestre, righeCsvConAvviso, contenutoCsv, nomeFileCsv, pezzoNomeFile, fraseSenzaId,
} from '@/lib/admin/esporta-csv';

/**
 * 8/9/2026 — IL FILE DEGLI UTENTI CONTENEVA I CINQUECENTO PIÙ RECENTI E NON LO
 * DICEVA.
 *
 * ── Come si era rotto ───────────────────────────────────────────────────────
 * Il pulsante «Esporta CSV» di /admin/users scriveva nel file `filtered`, cioè
 * quello che era già a schermo: al massimo i cinquecento profili che la pagina
 * si porta in casa all'apertura. Il file si chiamava `mycity-utenti-2026-09-08.csv`
 * e dentro non c'era una riga che dicesse che era un pezzo. Chi lo apre lo
 * legge come l'elenco degli iscritti: se lo usa per una comunicazione, o per
 * dire a un'autorità «questi sono i nostri utenti», sta usando un elenco monco
 * senza saperlo.
 *
 * È lo stesso difetto che l'8/9 ha colpito il file degli ordini
 * (`lib/ordini/esporta-ordini.ts`): là la lezione è arrivata, qui no. Questo
 * file è quella lezione portata anche sugli utenti.
 *
 * ── La cura, in tre pezzi ───────────────────────────────────────────────────
 * ① L'esportazione fa una lettura sua, a finestre, finché il database non dice
 *    che sono finiti: quello che c'è in pagina e quello che c'è nel file
 *    smettono di essere legati.
 * ② Se non si arriva in fondo, il file NON può sembrare intero: avviso in prima
 *    riga e `-PARZIALE` nel nome. Per ottenere il testo del CSV bisogna passare
 *    da `RaccoltaUtenti`, che sa se è completa: un elenco monco che si spaccia
 *    per intero bisognerebbe fabbricarlo apposta.
 * ③ Le celle passano da `lib/csv-sicuro`, quindi un nome scelto da un utente
 *    (`=HYPERLINK("http://sito-finto";"Fattura")`) non diventa una formula
 *    eseguita dentro il foglio di chi lo apre. Prima qui il CSV si componeva a
 *    mano con le sole virgolette, che da questo non proteggono.
 *
 * Niente Supabase e niente React: la lettura arriva come funzione, quindi una
 * prova può eseguire tutto senza database e senza browser.
 */

/** La forma minima che serve per scrivere una riga del file. */
export type UtenteDaEsportare = {
  id: string;
  email?: string | null;
  full_name?: string | null;
  store_name?: string | null;
  role?: string | null;
  is_approved?: boolean | null;
  created_at?: string | null;
};

/** Le colonne, nello stesso ordine di prima: chi ha già un foglio non lo rifà. */
export const INTESTAZIONI_CSV_UTENTI = [
  'ID', 'Email', 'Nome', 'Ruolo', 'Approvato', 'Creato il',
] as const;

/** Quanti utenti per lettura. Mille è il tetto per richiesta di PostgREST. */
export const UTENTI_PER_LETTURA = 1000;

/**
 * Quante letture al massimo: 30 x 1000, cioè ventinovemila utenti più la
 * lettura vuota che dice «sono finiti». È una cintura, non un limite atteso.
 */
export const TETTO_LETTURE_UTENTI = 30;

/** La lettura di una finestra di utenti: estremi inclusi, come `.range()`. */
export type LettoreDiUtenti = (da: number, a: number) => Promise<UtenteDaEsportare[]>;

export type RaccoltaUtenti = {
  righe: UtenteDaEsportare[];
  /** Vero solo se il database ha detto «sono finiti», non se ci siamo stancati. */
  completo: boolean;
  letture: number;
  /** `senza-id`: righe arrivate senza identificativo, contate e lasciate fuori. */
  motivo?: 'tetto' | 'ricerca' | 'senza-id';
  senzaId?: number;
};

/** Una riga del file, nell'ordine delle intestazioni. */
export function rigaCsvUtente(u: UtenteDaEsportare): unknown[] {
  return [
    u.id,
    u.email ?? '',
    u.full_name ?? u.store_name ?? '',
    u.role ?? '',
    u.is_approved ? 'sì' : 'no',
    u.created_at ?? '',
  ];
}

/**
 * Legge tutti gli utenti a finestre. L'algoritmo (fine a «zero righe»,
 * doppioni tolti per id, righe senza id contate e lasciate fuori, tetto) sta in
 * `lib/admin/esporta-csv.ts`, lo stesso degli ordini: qui c'è solo il tetto.
 */
export async function raccogliUtentiDaEsportare(
  leggi: LettoreDiUtenti,
  opzioni: { perLettura?: number; tettoLetture?: number } = {},
): Promise<RaccoltaUtenti> {
  return raccogliAFinestre(leggi, {
    perLettura: opzioni.perLettura ?? UTENTI_PER_LETTURA,
    tettoLetture: opzioni.tettoLetture ?? TETTO_LETTURE_UTENTI,
  });
}

/**
 * La raccolta quando si sta esportando il risultato di una ricerca: le righe
 * sono già quelle, e sono complete solo se la ricerca non ha toccato il suo
 * tetto di risultati.
 */
export function raccoltaDallaRicerca(
  righe: readonly UtenteDaEsportare[],
  ricercaTroncata: boolean,
): RaccoltaUtenti {
  return {
    righe: [...righe],
    completo: !ricercaTroncata,
    letture: 1,
    ...(ricercaTroncata ? { motivo: 'ricerca' as const } : {}),
  };
}

/** L'avviso che sta in prima riga quando l'elenco non è arrivato in fondo. */
export function avvisoFileUtentiParziale(raccolta: RaccoltaUtenti): string {
  const quante = raccolta.righe.length;
  const dettaglio = raccolta.motivo === 'ricerca'
    ? `Qui dentro ci sono solo i primi ${quante} risultati della ricerca: ce ne sono altri che non sono stati scaricati.`
    : raccolta.motivo === 'senza-id'
    ? `Qui dentro ci sono ${quante} utenti, letti fino in fondo.`
    : `Qui dentro ci sono solo i primi ${quante} utenti, il resto non è stato scaricato.`;
  return `ATTENZIONE: elenco INCOMPLETO. ${dettaglio}${fraseSenzaId(raccolta.senzaId)} NON usarlo come elenco degli iscritti: rifai l'esportazione restringendo la ricerca, o chiedi l'elenco completo.`;
}

/** Le righe del file: l'avviso (se serve), le intestazioni, gli utenti. */
export function righeCsvUtenti(raccolta: RaccoltaUtenti): unknown[][] {
  return righeCsvConAvviso(raccolta, INTESTAZIONI_CSV_UTENTI, rigaCsvUtente,
    () => avvisoFileUtentiParziale(raccolta));
}

/**
 * Il testo del file. Passa da `contenutoFileCsv`, quindi ogni cella è
 * neutralizzata: nessun nome scelto da un utente diventa una formula eseguita.
 */
export function contenutoCsvUtenti(raccolta: RaccoltaUtenti): string {
  return contenutoCsv(righeCsvUtenti(raccolta));
}

/**
 * Il nome del file dice cosa c'è dentro: la data, il filtro applicato, se è una
 * ricerca, e `-PARZIALE` quando l'elenco non è completo.
 */
export function nomeFileUtenti(opzioni: {
  oggi: string;
  completo: boolean;
  filtro?: string;
  ricerca?: string;
}): string {
  const filtro = opzioni.filtro && opzioni.filtro !== 'all' ? pezzoNomeFile(opzioni.filtro) : '';
  const parola = opzioni.ricerca?.trim() ? pezzoNomeFile(opzioni.ricerca, 24) : '';
  // Una ricerca di soli caratteri non latini («王», «Иван») o simboli dà una
  // parola vuota: il nome dice comunque che è una ricerca, non l'elenco intero.
  const cercato = opzioni.ricerca?.trim() ? (parola ? `cerca-${parola}` : 'cerca') : '';
  return nomeFileCsv({ prefisso: 'mycity-utenti', oggi: opzioni.oggi, completo: opzioni.completo, pezzi: [filtro, cercato] });
}
