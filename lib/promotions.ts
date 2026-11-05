import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

/**
 * 5/11/2026 — La mappa degli sconti porta il segno `scontiNonLetti` quando
 * almeno uno sconto non si e' potuto leggere. Prima uno sconto non letto valeva
 * 0 in silenzio, e l'ordine passava a prezzo pieno mentre il cliente vedeva
 * «In promo». Chi crea l'ordine guarda il segno e si ferma con «riprova fra poco».
 */
export type MappaSconti = Map<string, number> & { scontiNonLetti?: boolean };

/**
 * Sconto promozione ATTIVO (percentuale 0-70) per ciascun prodotto, letto dalla
 * fonte autorevole `product_active_discount` — la STESSA usata dal badge
 * "In promo -X%" e dalle vetrine. Serve a far pagare al checkout esattamente il
 * prezzo scontato che il cliente vede, non il prezzo pieno.
 *
 * Un errore vale 0 nella mappa, ma la mappa resta segnata come «non letta»
 * (`scontiNonLetti` sulla mappa): le rotte che creano l'ordine si fermano con un 503
 * invece di addebitare il prezzo pieno a chi vede il prezzo in promo.
 */
export async function fetchActiveDiscounts(
  client: SupabaseClient,
  productIds: string[],
): Promise<MappaSconti> {
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
  if (error) {
    logger.warn('[promozioni] product_active_discounts non letta, si ripiega sui singoli prodotti', {
      prodotti: unique.length, message: (error as { message?: string }).message,
    });
  }
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
  let cadute = 0;
  let ultimoErrore: string | undefined;
  const entries = await Promise.all(
    unique.map(async (id) => {
      const { data: singolo, error: err } = await client.rpc('product_active_discount', { p_product: id });
      if (err) {
        cadute += 1;
        ultimoErrore = (err as { message?: string }).message;
      }
      return [id, err ? 0 : limita(singolo)] as const;
    }),
  );
  const mappa: MappaSconti = new Map(entries);
  if (cadute > 0) {
    logger.warn('[promozioni] sconti non letti: l ordine non deve passare a prezzo pieno', {
      prodotti: unique.length, cadute, message: ultimoErrore,
    });
    mappa.scontiNonLetti = true;
  }
  return mappa;
}

/** Prezzo unitario in centesimi dopo lo sconto promo (arrotondato al centesimo). */
export function discountedUnitCents(price: number | string, discountPercent: number): number {
  const pct = Math.max(0, Math.min(70, discountPercent || 0));
  return Math.round(Number(price) * (1 - pct / 100) * 100);
}
