/**
 * @tanstack/react-query in finto. Le prove di accessibilità non provano il
 * caricamento dei dati: provano cosa esce a video QUANDO i dati ci sono. Il
 * dato lo mette la prova in `globalThis.__DATI_QUERY__` (un valore, oppure una
 * funzione che riceve le opzioni della query e decide).
 *
 * 30/8/2026 (R087, R091) — serviva anche il contrario: cosa esce a video quando
 * la lettura NON riesce. Prima qui `isError` era falso e basta, quindi nessuna
 * prova poteva montare una pagina con la rete caduta — ed è esattamente lo
 * stato in cui due pagine dicevano «non c'è niente» a chi invece aveva ordini e
 * messaggi. La prova lo chiede con `globalThis.__ESITO_QUERY__`: un oggetto (o
 * una funzione che riceve le opzioni della query) con i campi da sovrascrivere.
 * Chi non lo imposta non si accorge di niente: il comportamento di prima resta
 * identico.
 */
export function useQuery(opzioni) {
  // 25/10/2026 — Se la prova mette un array in `globalThis.__OPZIONI_QUERY__`, ci finiscono le
  // opzioni di ogni domanda: così una prova può dire se una domanda PARTE (`enabled`) e con
  // quale `queryFn`, che qui non viene mai chiamata. Chi non lo mette non si accorge di niente.
  if (Array.isArray(globalThis.__OPZIONI_QUERY__)) globalThis.__OPZIONI_QUERY__.push(opzioni);
  const sorgente = globalThis.__DATI_QUERY__;
  const data = typeof sorgente === 'function' ? sorgente(opzioni) : sorgente;
  // 24/11/2026 — Se la prova mette una Map in `globalThis.__CACHE_QUERY__`, è la memoria del finto:
  // ogni domanda servita ci resta come `JSON(queryKey) → { queryKey, data }`, e `setQueriesData` la
  // aggiorna. Chi non la mette non si accorge di niente.
  if (globalThis.__CACHE_QUERY__ instanceof Map && Array.isArray(opzioni?.queryKey)) {
    globalThis.__CACHE_QUERY__.set(JSON.stringify(opzioni.queryKey), { queryKey: opzioni.queryKey, data });
  }
  const base = {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: () => Promise.resolve({ data }),
  };
  const guasto = globalThis.__ESITO_QUERY__;
  const sopra = typeof guasto === 'function' ? guasto(opzioni) : guasto;
  return sopra ? { ...base, ...sopra } : base;
}

/**
 * 30/8/2026 (R080) — La griglia dei prodotti adesso sfoglia a finestre
 * (`useInfiniteQuery`): senza questo, montarla in una prova non compilava
 * nemmeno. Il dato resta quello che mette la prova in `__DATI_QUERY__`, servito
 * come pagina unica: le prove che montano una pagina guardano cosa esce a
 * video, non come si sfoglia.
 */
export function useInfiniteQuery(opzioni) {
  const base = useQuery(opzioni);
  const pagina = Array.isArray(base.data) ? base.data : base.data == null ? [] : [base.data];
  return {
    ...base,
    data: { pages: [pagina], pageParams: [opzioni?.initialPageParam ?? 0] },
    fetchNextPage: () => Promise.resolve(),
    hasNextPage: false,
    isFetchingNextPage: false,
  };
}

// Finto: ogni domanda risponde col dato della prova, non c'e' nessuno stato da tenere fra un giro e l'altro.
// eslint-disable-next-line react-hooks/rules-of-hooks
export const useQueries = (o) => (o?.queries ?? []).map((q) => useQuery(q));
/**
 * 16/10/2026 — QUELLO CHE LA PAGINA HA CHIESTO DI SCRIVERE.
 *
 * `mutate` non faceva niente, quindi nessuna prova poteva dire «senza la conferma, il bonifico
 * non si segna». Se la prova mette un array in `globalThis.__MUTAZIONI__`, ogni `mutate` ci
 * finisce dentro con le sue variabili; chi non lo mette non si accorge di niente.
 */
export const useMutation = (opzioni) => {
  const annota = (variabili) => {
    if (Array.isArray(globalThis.__MUTAZIONI__)) globalThis.__MUTAZIONI__.push(variabili);
    // 5/11/2026 (S04) — Se la prova accende `globalThis.__MUTAZIONI_VERE__`, la scrittura gira
    // davvero: `mutationFn`, poi `onSuccess` o `onError` (vedi sotto dove il finto differisce). Così una prova
    // vede cosa la pagina rilegge e cosa dice dopo un errore. Le promesse in volo finiscono in
    // `__MUTAZIONI_IN_VOLO__` (se è un array), da aspettare. Chi non la accende non vede niente.
    if (globalThis.__MUTAZIONI_VERE__ && opzioni?.mutationFn) {
      // 24/11/2026 — Qui il finto è VOLUTAMENTE PIÙ SEVERO di react-query vero, che chiama `onError`
      // anche quando è `onSuccess` a lanciare. Nel finto solo un errore di `mutationFn` va in
      // `onError`; un errore DENTRO `onSuccess` è un difetto della pagina: deve emergere (la promessa
      // in volo si rompe), non diventare «non riuscito» e passare inosservato in una prova che guarda
      // il messaggio d'errore.
      const volo = (async () => {
        let esito;
        try {
          esito = await opzioni.mutationFn(variabili);
        } catch (e) {
          await opzioni.onError?.(e, variabili);
          return;
        }
        await opzioni.onSuccess?.(esito, variabili);
      })();
      if (Array.isArray(globalThis.__MUTAZIONI_IN_VOLO__)) globalThis.__MUTAZIONI_IN_VOLO__.push(volo);
    }
  };
  return {
    mutate: (variabili) => annota(variabili),
    mutateAsync: async (variabili) => annota(variabili),
    isPending: false, isError: false, error: null,
  };
};
/**
 * 25/10/2026 — QUELLO CHE LA PAGINA HA SCRITTO NELLA MEMORIA.
 *
 * Se la prova mette un array in `globalThis.__CACHE_SCRITTA__`, ogni `setQueryData` ci finisce
 * dentro come `[chiave, valore]`; chi non lo mette non si accorge di niente. `cancelQueries`
 * c'è perché chi scrive in memoria, prima, ferma la lettura in volo (pulsante Assistenza): ci
 * finisce come `['annulla', chiave]`, così una prova vede anche l'ORDINE fra le due.
 */
export const useQueryClient = () => ({
  // 5/11/2026 (S04) — Se la prova mette un array in `globalThis.__RILETTURE__`, ogni chiave
  // che la pagina chiede di rileggere ci finisce dentro. Chi non lo mette non vede niente.
  invalidateQueries: (filtro) => {
    if (Array.isArray(globalThis.__RILETTURE__)) globalThis.__RILETTURE__.push(filtro?.queryKey);
  },
  setQueryData: (chiave, valore) => {
    if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push([chiave, valore]);
  },
  // 24/11/2026 — Come l'API vera: tutte le domande in memoria che corrispondono al filtro
  // (`queryKey` come prefisso, o uguale con `exact`; più `predicate`) prendono il dato nuovo (un
  // valore, o una funzione del dato di prima; `undefined` lascia la domanda com'era). Ritorna
  // `[queryKey, dato][]`; ogni scrittura finisce anche in `__CACHE_SCRITTA__`, se c'è.
  setQueriesData: (filtro, aggiorna) => {
    const memoria = globalThis.__CACHE_QUERY__;
    if (!(memoria instanceof Map)) return [];
    const parziale = (a, b) =>
      a === b ||
      (typeof a === typeof b && !!a && !!b && typeof a === 'object' && Object.keys(b).every((k) => parziale(a[k], b[k])));
    const corrisponde = ({ queryKey, data }) => {
      const k = filtro?.queryKey;
      if (k && (filtro.exact ? JSON.stringify(queryKey) !== JSON.stringify(k) : !parziale(queryKey, k))) return false;
      return filtro?.predicate ? !!filtro.predicate({ queryKey, state: { data } }) : true;
    };
    return [...memoria.entries()].filter(([, q]) => corrisponde(q)).map(([hash, q]) => {
      const nuovo = typeof aggiorna === 'function' ? aggiorna(q.data) : aggiorna;
      if (nuovo === undefined) return [q.queryKey, undefined];
      memoria.set(hash, { queryKey: q.queryKey, data: nuovo });
      if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push([q.queryKey, nuovo]);
      return [q.queryKey, nuovo];
    });
  },
  getQueryData: () => undefined,
  // 28/11/2026 (R09-008) — Le sezioni della home chiedono se il negozio è già in memoria
  // (lib/queries/vetrina-con-memoria.ts): nel finto la memoria è vuota, e si legge come prima.
  getQueryState: () => undefined,
  cancelQueries: async (filtro) => {
    if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push(['annulla', filtro?.queryKey]);
  },
});
// 25/11/2026 — la pagina categoria calcola l'impronta delle file con hashKey (come react-query).
export const hashKey = (chiave) => JSON.stringify(chiave);
export class QueryClient {}
export const QueryClientProvider = ({ children }) => children;
export const keepPreviousData = undefined;

/**
 * 3/9/2026 — Il guscio della pagina negozio (`app/store/[id]/layout.tsx`) precarica sul server e
 * consegna lo stato dentro la pagina. Per montarlo — e per poter ESEGUIRE la sua
 * `generateMetadata`, che è il testo che si legge su Google e nell'anteprima di WhatsApp —
 * servivano anche questi due. Qui il precarico non deve fare niente: le prove che montano una
 * pagina il dato lo mettono in `__DATI_QUERY__`.
 */
export const HydrationBoundary = ({ children }) => children;
export const dehydrate = () => ({ mutations: [], queries: [] });
