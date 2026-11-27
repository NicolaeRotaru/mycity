'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

/** I dettagli di un servizio che servono alla card. */
export type DettagliServizio = { durata_minuti: number | null; dove_servizio: string | null };

/**
 * 27/11/2026 — QUALI FRA QUESTI ANNUNCI SONO SERVIZI (migrazione 999g).
 *
 * Le griglie leggono i prodotti con un elenco di colonne scritto a mano: aggiungerci `tipo`
 * farebbe cadere tutta la griglia finché la 999g non è applicata. Qui si chiede a parte, e
 * solo i servizi. Se la colonna non c'è ancora la lettura fallisce e la risposta è vuota:
 * ogni annuncio resta un prodotto, ed è vero, perché senza la colonna un servizio non esiste.
 * Il carrello e la cassa fermano un servizio anche senza questa lettura.
 */
export function useServizi(ids: string[]): Map<string, DettagliServizio> {
  const chiave = [...ids].sort().join(',');
  const { data } = useQuery({
    queryKey: ['products', 'servizi', chiave],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Map<string, DettagliServizio>> => {
      const mappa = new Map<string, DettagliServizio>();
      const { data: righe, error } = await supabase
        .from('products')
        .select('id, durata_minuti, dove_servizio')
        .in('id', ids)
        .eq('tipo', 'servizio');
      if (error || !Array.isArray(righe)) return mappa;
      for (const r of righe as Array<{ id: string } & DettagliServizio>) {
        mappa.set(r.id, { durata_minuti: r.durata_minuti ?? null, dove_servizio: r.dove_servizio ?? null });
      }
      return mappa;
    },
  });
  return data ?? new Map();
}
