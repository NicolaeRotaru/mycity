/**
 * QUANTI PAGAMENTI VANNO A BUON FINE, E PERCHÉ FALLISCONO GLI ALTRI.
 *
 * 27/8/2026 (R046). Ogni tentativo di pagamento con carta — riuscito o
 * rifiutato — viene registrato dal webhook in `payment_attempts` insieme al
 * motivo del rifiuto. Il dato c'era da settimane, e non lo leggeva nessuno:
 * nessuna pagina, nessuna query, nessun avviso. La domanda base del prodotto
 * pagamenti — «quanti pagamenti passano?» — non aveva risposta pur avendo la
 * risposta in casa.
 *
 * Cosa costava non guardarlo: se il checkout si rompe (una chiave scaduta, il
 * 3D Secure che non funziona su un browser) ce ne accorgeremmo solo dal calo
 * degli ordini, giorni dopo. E ogni modifica al checkout resta una scommessa,
 * perché non esiste un prima e un dopo da confrontare.
 *
 * IL DENOMINATORE È INCOMPLETO, ED È GIUSTO SAPERLO: chi abbandona sulla
 * schermata della banca (3D Secure) non genera né un riuscito né un fallito, e
 * qui dentro non compare. Questo numero misura «di quelli che ci hanno
 * provato davvero, quanti sono passati», non l'abbandono del checkout.
 */

export type TentativoPagamento = {
  status: string | null;
  decline_code?: string | null;
  error_code?: string | null;
};

export type EsitoTasso = {
  riusciti: number;
  falliti: number;
  /** Riusciti + falliti: il denominatore vero di questo conto. */
  tentativi: number;
  /** Da 0 a 1. `null` quando non c'è nemmeno un tentativo: non è zero, è «non lo so». */
  tasso: number | null;
  /** I motivi dei rifiuti, dal più frequente. */
  motivi: Array<{ codice: string; quanti: number }>;
};

/** Quando un rifiuto non porta nessun codice, si chiama così. */
const MOTIVO_SENZA_NOME = 'sconosciuto';

export function tassoAutorizzazione(tentativi: ReadonlyArray<TentativoPagamento>): EsitoTasso {
  let riusciti = 0;
  let falliti = 0;
  const conteggio = new Map<string, number>();

  for (const t of tentativi) {
    if (t.status === 'succeeded') {
      riusciti += 1;
      continue;
    }
    if (t.status !== 'failed') continue; // stati che non conosciamo non entrano nel conto
    falliti += 1;
    const codice = t.decline_code || t.error_code || MOTIVO_SENZA_NOME;
    conteggio.set(codice, (conteggio.get(codice) ?? 0) + 1);
  }

  const totale = riusciti + falliti;
  return {
    riusciti,
    falliti,
    tentativi: totale,
    tasso: totale > 0 ? riusciti / totale : null,
    motivi: [...conteggio.entries()]
      .map(([codice, quanti]) => ({ codice, quanti }))
      .sort((a, b) => b.quanti - a.quanti),
  };
}

/**
 * Se questo è vero, il checkout va guardato subito.
 *
 * La soglia chiede DUE cose insieme: un tasso sotto il minimo e abbastanza
 * tentativi perché il numero voglia dire qualcosa. Su tre pagamenti, due
 * rifiuti non sono un'emergenza: sono tre pagamenti.
 */
export function tassoDaGuardare(
  esito: EsitoTasso,
  sogliaMinima = 0.9,
  tentativiMinimi = 20,
): boolean {
  if (esito.tasso === null) return false;
  if (esito.tentativi < tentativiMinimi) return false;
  return esito.tasso < sogliaMinima;
}
