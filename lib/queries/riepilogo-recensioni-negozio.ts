import { queryKeys } from '@/lib/queries/keys';

/**
 * 12/11/2026 (R07-021, R07-022) — MEDIA E NUMERO DELLE RECENSIONI DEL NEGOZIO, UNA DOMANDA SOLA.
 *
 * La vetrina scrive per Google lo schema del negozio con le sue stelle. Le stelle venivano da
 * questa lettura, che faceva solo il browser: l'HTML del server usciva senza `aggregateRating`,
 * e il browser riscriveva lo script con le stelle, cioè due script diversi per la stessa
 * pagina. Ora la stessa domanda (stessa chiave, stessa forma) la fa anche il precarico del
 * server (`precaricaNegozio`), e la pagina parte già con le stelle.
 *
 * `store_review_stats` è aperta ad anon (migrazione 052): la può chiamare il client del server.
 *
 * La stessa lettura è scritta anche in `components/store-sections/useStorePageData.ts` (la
 * prova minori-s09-vetrina-recensioni ne legge il testo): chiave e forma devono restare uguali,
 * e la seconda prova di riparazione-r07-vetrina-stelle-dal-server lo controlla.
 */
export type ClientConFunzioni = {
  // I client Supabase hanno tipi generati diversi fra browser e server: qui serve la forma.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (nome: string, argomenti?: Record<string, unknown>) => any;
};

export type RiepilogoRecensioni = { media: number; totale: number };

export function domandaRiepilogoRecensioni(supa: ClientConFunzioni, id: string) {
  return {
    queryKey: [...queryKeys.reviews.store(id), 'riepilogo'] as const,
    staleTime: 60_000,
    queryFn: async (): Promise<RiepilogoRecensioni | null> => {
      const { data, error } = await supa.rpc('store_review_stats', { p_store_ids: [id] });
      if (error) throw error;
      const riga = ((data ?? []) as { store_id: string; avg: number | string; count: number }[]).find((r) => r.store_id === id);
      return riga ? { media: Number(riga.avg), totale: Number(riga.count) } : { media: 0, totale: 0 };
    },
  };
}
