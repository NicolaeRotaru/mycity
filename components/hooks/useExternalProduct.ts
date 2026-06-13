'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queries/keys';
import type { ExternalData } from '@/lib/products/externalSyncShared';

/**
 * Dati esterni (prezzo + tempo di consegna) di un prodotto importato da
 * marketplace, "in tempo reale" per il cliente. L'endpoint restituisce subito
 * lo snapshot in cache e rinfresca in background lato server quando è scaduto:
 * il render del cliente non chiama mai direttamente l'AI.
 *
 * `enabled` solo per i prodotti con sorgente esterna, così i (molti) prodotti
 * nativi non fanno alcuna richiesta.
 */
export function useExternalProduct(productId: string, opts: { hasExternal: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.products.external(productId),
    enabled: !!productId && opts.hasExternal,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ExternalData | null> => {
      const res = await fetch(`/api/products/${productId}/external-refresh`);
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return (body?.data?.external as ExternalData | null) ?? null;
    },
  });
  return query.data ?? null;
}
