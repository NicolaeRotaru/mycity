import { eSchemaIndietro, senzaCampi } from '@/lib/db/migrazione-124';

/**
 * IL CODICE DEVE REGGERE ANCHE PRIMA CHE LA MIGRAZIONE 148 SIA APPLICATA.
 *
 * Stessa storia della 124, altra migrazione. Nel progetto il codice e le
 * migrazioni viaggiano su due firme separate: unire una richiesta pubblica il
 * codice, applicare la migrazione al database è un'azione a parte, che fa
 * Nicola a mano. Fra le due c'è sempre una finestra — e per la 148 quella
 * finestra dura da giorni.
 *
 * Il database non è indulgente: una colonna che non esiste non viene ignorata,
 * fa fallire la scrittura INTERA. E non lancia: restituisce l'errore dentro la
 * risposta, che sulla copia del carrello non leggeva nessuno. Risultato, dal
 * giorno dell'unione a oggi:
 *
 *  · il carrello di chi ha comprato non veniva mai marcato come tornato, quindi
 *    restava in coda per l'email «hai lasciato qualcosa nel carrello» — mandata
 *    a chi aveva appena pagato;
 *  · e la copia del carrello sul server non veniva scritta affatto, quindi chi
 *    riempiva il carrello dal telefono e apriva il computer lo trovava vuoto.
 *
 * Qui c'è il ripiego: si prova con la colonna nuova, e se il database dice «non
 * ce l'ho» si riprova senza. Si perde il QUANDO è tornato — che serve a
 * misurare — e si tiene il fatto che è tornato, che serve a non sbagliare.
 *
 * Va tolto quando la 148 è applicata dappertutto: allora il primo tentativo
 * riesce sempre e questo codice non fa più niente.
 *
 * ── PERCHÉ QUESTO FILE E NON `migrazione-124.ts` ────────────────────────────
 *
 * Il meccanismo generale — quali errori vogliono dire «lo schema è indietro» e
 * come si toglie un campo da una riga — sta già lì, e da lì lo prendo: due
 * copie della stessa regola divergono, e il giorno in cui una si comporta male
 * nessuno sa quale delle due sta guardando.
 *
 * Quello che aggiungo è una cosa sola, ed è quella che mancava per le
 * SCRITTURE: `PGRST204`. `eSchemaIndietro` conosce i codici di PostgreSQL
 * (42703 colonna, 42P01 tabella, 42883 funzione), che sono quelli che tornano
 * quando la richiesta arriva fino al database. Ma su una scrittura la richiesta
 * spesso non ci arriva: il traduttore davanti al database confronta i campi con
 * lo schema che ha in memoria, e risponde da solo `PGRST204 — Could not find
 * the 'x' column of 'y' in the schema cache`. Senza quel codice il ripiego non
 * scatta proprio dove serve.
 *
 * DEBITO DICHIARATO, per chi ricuce: la parte generale dovrebbe stare in un
 * file che non porta il numero di una migrazione, e `PGRST204` dovrebbe entrare
 * in `eSchemaIndietro`. Non l'ho fatto perché `migrazione-124.ts` in questo
 * momento lo sta riscrivendo un'altra squadra, e sovrascrivere il lavoro di un
 * altro è peggio del debito.
 */

/** Quel poco che ci interessa di un errore del database: il codice e il testo. */
export type ErroreDatabase = { message?: string; code?: string } | null | undefined;

/** Com'è fatta la risposta di una scrittura: `{ error }`, e basta. */
export type EsitoScrittura = { error?: ErroreDatabase } | null | undefined;

/**
 * LE COLONNE CHE LA 148 AGGIUNGE, e che prima della firma non ci sono.
 *
 * Una sola: `recovered_at` su `abandoned_carts` — dice QUANDO il carrello è
 * tornato, e serve a sapere a quanti giorni dall'email arriva l'acquisto.
 */
export const COLONNE_148 = ['recovered_at'] as const;

/**
 * Il database ha rifiutato la scrittura perché un pezzo di schema non c'è
 * ancora?
 *
 * I codici di PostgreSQL li decide `eSchemaIndietro`, una volta sola, insieme
 * alla 124. Qui si aggiunge solo il codice del traduttore davanti al database,
 * più il confronto sul testo come rete: i messaggi cambiano fra le versioni.
 */
export function colonnaNonTrovata(errore: ErroreDatabase): boolean {
  if (!errore) return false;
  if (eSchemaIndietro(errore)) return true;
  if (errore.code === 'PGRST204') return true;
  const testo = (errore.message ?? '').toLowerCase();
  return testo.includes('column') && (testo.includes('does not exist') || testo.includes('could not find'));
}

export type EsitoRiprova = {
  /** La riga è finita nel database, magari senza le colonne nuove. */
  riuscita: boolean;
  /** La riga da mettere nei log, o `null` se non è successo niente di strano. */
  avviso: string | null;
};

/**
 * Scrive, GUARDA com'è andata, e se il rifiuto è per una colonna che la 148 non
 * ha ancora portato riprova senza quella.
 *
 * Non lancia mai e non scrive nei log da sola: restituisce la riga di avviso e
 * la mette nei log chi la chiama. Il browser e il server non hanno lo stesso
 * modo di scrivere un avviso, e questa regola serve a tutti e due.
 */
export async function scriviAncheSeMancaUnaColonnaNuova(
  cosa: string,
  campi: Record<string, unknown>,
  colonneRecenti: readonly string[],
  esegui: (campi: Record<string, unknown>) => PromiseLike<EsitoScrittura>,
): Promise<EsitoRiprova> {
  const primo = await esegui(campi);
  if (!primo?.error) return { riuscita: true, avviso: null };

  if (!colonnaNonTrovata(primo.error)) {
    return {
      riuscita: false,
      avviso: `${cosa}: il database ha rifiutato la scrittura — ${primo.error.message ?? 'senza motivo'}`,
    };
  }

  const secondo = await esegui(senzaCampi(campi, colonneRecenti));
  if (secondo?.error) {
    return {
      riuscita: false,
      avviso: `${cosa}: non riesco a scrivere nemmeno senza le colonne nuove — ${secondo.error.message ?? 'senza motivo'}`,
    };
  }
  return {
    riuscita: true,
    avviso: `${cosa}: scritto senza le colonne della migrazione 148, che su questo database non è ancora applicata`,
  };
}
