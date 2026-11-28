import type { QueryClient } from '@tanstack/react-query';
import {
  colonneDellaDomanda,
  fetchSellerPublicMap,
  type LettoreNegozi,
  type LettoreVista,
  type SellerPublicProfile,
} from '@/lib/queries/seller-public-profiles';

export type { LettoreNegozi };

/**
 * 28/11/2026 (R09-008) — LA VETRINA DEI NEGOZI SI RICORDA PER QUALCHE MINUTO, NELLA CACHE DI CHI CHIAMA.
 *
 * In home le sezioni (Drop del giorno, storie, tendenze, negozio del mese) chiedono alla vetrina
 * (`seller_public_profiles`) gli stessi negozi. Le domande nello stesso istante già si uniscono
 * (`fetchSellerPublicMap`, R06-009); ma una sezione che arriva un attimo dopo, quando la prima
 * domanda è atterrata, rifaceva il suo giro di rete prima di mostrarsi.
 *
 * Qui la memoria sta nella cache di React Query della pagina, che sa quando un dato è vecchio:
 * ogni negozio ha la sua voce, `['vetrina-negozio', <colonne>, <id>]`, fresca per
 * `MEMORIA_VETRINA_MS`. Il lettore prende dalla cache i negozi freschi e chiede alla vetrina, in una
 * domanda sola, solo quelli che mancano; poi li scrive in cache, anche quelli che la vetrina non
 * restituisce (`null`: non approvato, sospeso), così la sezione dopo non li richiede.
 *
 * Solo nel browser, dove c'è una cache per persona: sul server ogni richiesta ha il suo client.
 */
export const MEMORIA_VETRINA_MS = 3 * 60_000;

/** La voce di un negozio nella cache: le stesse colonne (in qualunque ordine) sono la stessa voce. */
export function chiaveVetrinaNegozio(select: string, sellerId: string) {
  return ['vetrina-negozio', colonneDellaDomanda(select), sellerId] as const;
}

/** Il lettore che passa dalla cache di React Query della pagina (vedi sopra). */
export function lettoreNegoziConMemoria(queryClient: QueryClient, supabase: LettoreVista): LettoreNegozi {
  return async (sellerIds, select) => {
    const unici = [...new Set(sellerIds.filter((s): s is string => !!s))];
    const mappa = new Map<string, SellerPublicProfile>();
    const mancanti: string[] = [];
    const adesso = Date.now();
    for (const id of unici) {
      const chiave = chiaveVetrinaNegozio(select, id);
      const stato = queryClient.getQueryState<SellerPublicProfile | null>(chiave);
      if (stato?.status === 'success' && adesso - stato.dataUpdatedAt < MEMORIA_VETRINA_MS) {
        const negozio = queryClient.getQueryData<SellerPublicProfile | null>(chiave);
        if (negozio) mappa.set(id, negozio);
      } else {
        mancanti.push(id);
      }
    }
    if (mancanti.length === 0) return mappa;

    // Una lettura caduta risale a chi chiama, come senza memoria: niente scritto in cache.
    const letti = await fetchSellerPublicMap(supabase, mancanti, select);
    for (const id of mancanti) {
      const negozio = letti.get(id) ?? null;
      queryClient.setQueryData(chiaveVetrinaNegozio(select, id), negozio);
      if (negozio) mappa.set(id, negozio);
    }
    return mappa;
  };
}
