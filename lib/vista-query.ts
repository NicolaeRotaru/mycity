/**
 * DALLA LETTURA AL VERDETTO — così una pagina non può decidere sul solo «sto caricando».
 *
 * ── Il difetto che ha prodotto questo file ───────────────────────────────────────────────────
 * Contato il 23/8/2026 su tutta l'area venditore: **undici pagine, ventinove letture, e `isError`
 * non compare nemmeno una volta.** Otto di quelle pagine dichiarano un valore di ripiego
 * (`const { data: orders = [], isLoading } = useQuery(...)`), e il provider globale non alza gli
 * errori al confine di pagina — ha `retry: 1` e nessun `throwOnError`. Quindi dopo un tentativo la
 * lettura smette, `isLoading` torna falso, `data` resta `undefined`, e il ripiego prende il posto
 * del dato.
 *
 * Il risultato, nel punto peggiore: la pagina dei **Guadagni** mostra la torre dei numeri a zero e
 * scrive «Ancora nessun ordine pagato con carta» — mentre in cima dichiara «Incassi reali dai tuoi
 * ordini». Afferma di essere reale su dati che non ha mai ricevuto, al negoziante che paga il
 * canone. La bacheca ha la forma opposta e la stessa radice: `if (isLoading || !stats)` la lascia
 * sullo scheletro **per sempre**, senza un modo di sapere che è fallito né di riprovare.
 *
 * ── Perché un file nuovo invece di undici toppe ──────────────────────────────────────────────
 * Perché la toppa si dimentica alla dodicesima pagina. `lib/stato-vista.ts` ha già la regola —
 * «vuoto» esce solo con `letto: true` — ma resta una funzione che qualcuno deve ricordarsi di
 * chiamare. Qui la regola scende di un piano: si passa la LETTURA e si riceve il VERDETTO. Non
 * esiste una forma in cui ti dimentichi l'errore, perché non c'è un ramo da scrivere a mano.
 *
 * 🟢 Pura: nessuna rete, nessun React, nessun orologio. Una prova la ESEGUE.
 */

import { statoDellaVista, type VerdettoVista } from './stato-vista';

/**
 * La parte di un risultato di React Query che ci serve.
 *
 * Non è il tipo di React Query: è il minimo che descrive una lettura, così la funzione si prova
 * senza montare niente e senza fingere una libreria intera.
 */
export interface LetturaQuery<T> {
  /** v5: `status === 'pending'`, cioè non c'è ancora nessun dato e non è fallita. */
  isPending?: boolean;
  /** Compatibilità con chi legge `isLoading`: in v5 è `isPending && isFetching`. */
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  data?: T;
}

/** Quanti elementi porta questo dato: un elenco si conta, un oggetto vale uno, il nulla vale zero. */
export function quantiDi(dati: unknown): number {
  if (dati === undefined || dati === null) return 0;
  if (Array.isArray(dati)) return dati.length;
  return 1;
}

/**
 * Il verdetto di una lettura.
 *
 * `letto` NON è «la lettura è finita»: è «c'è un dato in mano». Sono due cose diverse, ed è la
 * differenza che il difetto sfruttava — con `data` a `undefined` e `isLoading` falso, una pagina
 * credeva di aver letto. Qui una lettura senza dato non è mai «letta», qualunque cosa dicano le
 * bandierine.
 */
export function vistaDaQuery<T>(q: LetturaQuery<T>, opzioni: { quanti?: number } = {}): VerdettoVista & { dati: T | undefined } {
  const caricando = Boolean(q.isPending ?? q.isLoading);
  const haDato = q.data !== undefined && q.data !== null;
  const verdetto = statoDellaVista({
    letto: haDato,
    caricando,
    // Un `isError` alzato senza oggetto errore è comunque un errore: la bandierina basta, e
    // pretendere anche l'oggetto lascerebbe passare proprio il caso che si vuole fermare.
    errore: q.isError ? (q.error ?? true) : undefined,
    quanti: opzioni.quanti ?? quantiDi(q.data),
  });
  return { ...verdetto, dati: q.data };
}
