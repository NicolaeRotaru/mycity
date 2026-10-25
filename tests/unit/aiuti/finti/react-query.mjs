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
export const useMutation = () => {
  const annota = (variabili) => {
    if (Array.isArray(globalThis.__MUTAZIONI__)) globalThis.__MUTAZIONI__.push(variabili);
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
  invalidateQueries: () => {},
  setQueryData: (chiave, valore) => {
    if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push([chiave, valore]);
  },
  getQueryData: () => undefined,
  cancelQueries: async (filtro) => {
    if (Array.isArray(globalThis.__CACHE_SCRITTA__)) globalThis.__CACHE_SCRITTA__.push(['annulla', filtro?.queryKey]);
  },
});
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
