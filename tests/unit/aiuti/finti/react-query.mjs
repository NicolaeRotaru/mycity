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

export const useQueries = (o) => (o?.queries ?? []).map((q) => useQuery(q));
export const useMutation = () => ({
  mutate: () => {}, mutateAsync: async () => {}, isPending: false, isError: false, error: null,
});
export const useQueryClient = () => ({
  invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined,
});
export class QueryClient {}
export const QueryClientProvider = ({ children }) => children;
export const keepPreviousData = undefined;
