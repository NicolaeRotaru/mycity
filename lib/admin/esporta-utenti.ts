import { contenutoFileCsv } from '@/lib/csv-sicuro';

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
  motivo?: 'tetto' | 'ricerca';
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
 * Legge finestra dopo finestra finché il database non restituisce PIÙ NIENTE.
 *
 * Il criterio di fine è «zero righe», non «meno righe di quante ne ho chieste»:
 * PostgREST ha un suo tetto di righe per richiesta che si cambia dal pannello
 * di Supabase, e se quel tetto è più basso della finestra la prima lettura
 * torna corta — il criterio furbo direbbe «sono finiti» e rifabbricherebbe il
 * file monco che sembra intero. Si paga una lettura in più, quella vuota.
 *
 * I doppioni si tolgono per identificativo: mentre si sfoglia, un iscritto
 * nuovo entra in cima e sposta tutte le righe di uno.
 */
export async function raccogliUtentiDaEsportare(
  leggi: LettoreDiUtenti,
  opzioni: { perLettura?: number; tettoLetture?: number } = {},
): Promise<RaccoltaUtenti> {
  const perLettura = Math.max(1, Math.trunc(opzioni.perLettura ?? UTENTI_PER_LETTURA));
  const tetto = Math.max(1, Math.trunc(opzioni.tettoLetture ?? TETTO_LETTURE_UTENTI));

  const perId = new Map<string, UtenteDaEsportare>();
  let letture = 0;
  let da = 0;

  for (let giro = 0; giro < tetto; giro++) {
    const blocco = await leggi(da, da + perLettura - 1);
    letture++;
    for (const utente of blocco) {
      if (utente?.id && !perId.has(utente.id)) perId.set(utente.id, utente);
    }
    if (blocco.length === 0) {
      return { righe: [...perId.values()], completo: true, letture };
    }
    da += blocco.length;
  }

  return { righe: [...perId.values()], completo: false, letture, motivo: 'tetto' };
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
    : `Qui dentro ci sono solo i primi ${quante} utenti, il resto non è stato scaricato.`;
  return `ATTENZIONE: elenco INCOMPLETO. ${dettaglio} NON usarlo come elenco degli iscritti: rifai l'esportazione restringendo la ricerca, o chiedi l'elenco completo.`;
}

/** Le righe del file: l'avviso (se serve), le intestazioni, gli utenti. */
export function righeCsvUtenti(raccolta: RaccoltaUtenti): unknown[][] {
  const testa: unknown[][] = raccolta.completo
    ? []
    : [[avvisoFileUtentiParziale(raccolta)], []];
  return [...testa, [...INTESTAZIONI_CSV_UTENTI], ...raccolta.righe.map(rigaCsvUtente)];
}

/**
 * Il testo del file. Passa da `contenutoFileCsv`, quindi ogni cella è
 * neutralizzata: nessun nome scelto da un utente diventa una formula eseguita.
 */
export function contenutoCsvUtenti(raccolta: RaccoltaUtenti): string {
  return contenutoFileCsv(righeCsvUtenti(raccolta));
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
  const pezzo = (t: string) => t.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filtro = opzioni.filtro && opzioni.filtro !== 'all' ? `-${pezzo(opzioni.filtro)}` : '';
  const cercato = opzioni.ricerca?.trim() ? `-cerca-${pezzo(opzioni.ricerca).slice(0, 24)}` : '';
  const parziale = opzioni.completo ? '' : '-PARZIALE';
  return `mycity-utenti-${opzioni.oggi}${filtro}${cercato}${parziale}.csv`;
}
