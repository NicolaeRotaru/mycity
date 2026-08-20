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
  if (unique.length === 0) return new Map();

  const limita = (v: unknown) => Math.max(0, Math.min(70, Math.round(Number(v) || 0)));

  // #86 — Una chiamata sola per tutto il carrello.
  //
  // Prima se ne faceva una PER ARTICOLO: un carrello da venti pezzi erano venti
  // viaggi al database, in parallelo ma tutti da aspettare, proprio nel punto in
  // cui la persona ha gia' la carta in mano. La funzione gemella e' nella
  // migrazione 122 e ha la stessa identica logica di quella singola.
  const { data, error } = await client.rpc('product_active_discounts', { p_products: unique });
  if (!error && Array.isArray(data)) {
    const mappa = new Map<string, number>(unique.map((id) => [id, 0]));
    for (const riga of data as Array<{ product_id: string; discount_percent: number }>) {
      mappa.set(riga.product_id, limita(riga.discount_percent));
    }
    return mappa;
  }

  // Ripiego: finche' la migrazione 122 non e' applicata la funzione non esiste
  // ancora. Si torna al comportamento di prima invece di far pagare a tutti il
  // prezzo pieno — o peggio, di far fallire l'ordine.
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data: singolo, error: err } = await client.rpc('product_active_discount', { p_product: id });
      return [id, err ? 0 : limita(singolo)] as const;
    }),
  );
  return new Map(entries);
}

/** Prezzo unitario in centesimi dopo lo sconto promo (arrotondato al centesimo). */
export function discountedUnitCents(price: number | string, discountPercent: number): number {
  const pct = Math.max(0, Math.min(70, discountPercent || 0));
  return Math.round(Number(price) * (1 - pct / 100) * 100);
}
