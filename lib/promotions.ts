import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sconto promozione ATTIVO (percentuale 0-70) per ciascun prodotto, letto dalla
 * fonte autorevole `product_active_discount` — la STESSA usata dal badge
 * "In promo -X%" e dalle vetrine. Serve a far pagare al checkout esattamente il
 * prezzo scontato che il cliente vede, non il prezzo pieno.
 *
 * Best-effort per singolo prodotto: un errore = 0 (nessuno sconto), così non
 * blocca mai il checkout; nel peggiore dei casi si torna al comportamento
 * precedente (prezzo pieno) anziché far fallire l'ordine.
 */
export async function fetchActiveDiscounts(
  client: SupabaseClient,
  productIds: string[],
): Promise<Map<string, number>> {
  const unique = Array.from(new Set(productIds));
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data, error } = await client.rpc('product_active_discount', { p_product: id });
      const pct = error ? 0 : Math.max(0, Math.min(70, Math.round(Number(data) || 0)));
      return [id, pct] as const;
    }),
  );
  return new Map(entries);
}

/** Prezzo unitario in centesimi dopo lo sconto promo (arrotondato al centesimo). */
export function discountedUnitCents(price: number | string, discountPercent: number): number {
  const pct = Math.max(0, Math.min(70, discountPercent || 0));
  return Math.round(Number(price) * (1 - pct / 100) * 100);
}
