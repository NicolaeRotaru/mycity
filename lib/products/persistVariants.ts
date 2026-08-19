import { supabase } from '@/lib/supabase/client';
import { type ProductVariant, normalizeVariants } from '@/lib/products/variants';
import { saveProductVariantsServer } from '@/lib/products/persistVariantsServer';

/**
 * Persistenza varianti lato venditore (RLS: il seller gestisce le varianti dei
 * propri prodotti). Il diff insert/update/delete mantiene stabili gli id delle
 * varianti invariate, così i riferimenti storici in order_items restano validi.
 */

export async function loadProductVariants(productId: string): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from('product_variants')
    .select('id, options, label, stock, position')
    .eq('product_id', productId)
    .order('position', { ascending: true });
  if (error) throw error;
  return normalizeVariants(data ?? []);
}

/**
 * 008 — Questa funzione era la copia riga per riga di `saveProductVariantsServer`:
 * stesso diff insert/update/delete, stessi id da tenere stabili, quaranta righe
 * duplicate. Due copie della stessa logica non restano uguali: la prima
 * correzione che entra in una sola delle due crea una differenza di
 * comportamento fra il pannello del venditore e quello dell'amministratore,
 * e nessuno la vede finche' non fa danni sui riferimenti degli ordini.
 * La firma che accetta il client come parametro esisteva gia': qui resta il
 * punto d'ingresso comodo per il browser, la logica vive in un posto solo.
 */
export async function saveProductVariants(
  productId: string,
  variants: ProductVariant[],
): Promise<void> {
  return saveProductVariantsServer(supabase, productId, variants);
}
