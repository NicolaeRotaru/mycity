/**
 * @tanstack/react-query in finto. Le prove di accessibilità non provano il
 * caricamento dei dati: provano cosa esce a video QUANDO i dati ci sono. Il
 * dato lo mette la prova in `globalThis.__DATI_QUERY__` (un valore, oppure una
 * funzione che riceve le opzioni della query e decide).
 */
export function useQuery(opzioni) {
  const sorgente = globalThis.__DATI_QUERY__;
  const data = typeof sorgente === 'function' ? sorgente(opzioni) : sorgente;
  return {
    data,
    isLoading: false,
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: () => Promise.resolve({ data }),
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
