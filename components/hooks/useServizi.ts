'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { leggiServizi, type DettagliServizio } from '@/lib/products/servizio';

export type { DettagliServizio };

/**
 * 27/11/2026 — QUALI FRA QUESTI ANNUNCI SONO SERVIZI (migrazione 999g).
 *
 * La lettura sta in `leggiServizi` (lib/products/servizio.ts): a parte, a blocchi, e vuota
 * prima della 999g. Il carrello e la cassa fermano un servizio anche senza questa lettura.
 */
export function useServizi(ids: string[]): Map<string, DettagliServizio> {
  const chiave = [...ids].sort().join(',');
  const { data } = useQuery({
    queryKey: ['products', 'servizi', chiave],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: () => leggiServizi(supabase, ids),
  });
  // Una risposta che non è una mappa (una cache vecchia, un finto delle prove) vale «nessun servizio».
  return data instanceof Map ? data : new Map();
}
