import type { SupabaseClient } from '@supabase/supabase-js';
import { type ProductVariant } from '@/lib/products/variants';

/**
 * Persistenza varianti lato server (client admin service-role). Identica nella
 * logica a `persistVariants.ts` ma accetta un SupabaseClient esplicito: serve
 * all'admin per gestire le varianti di prodotti di un seller arbitrario, cosa
 * che il client browser (RLS, seller-scoped) non può fare.
 *
 * Il diff insert/update/delete mantiene stabili gli id delle varianti invariate
 * (riferimenti in order_items). Il trigger DB riallinea products.stock/has_variants.
 */
export async function saveProductVariantsServer(
  supabase: SupabaseClient,
  productId: string,
  variants: ProductVariant[],
): Promise<void> {
  const { data: existing, error: loadErr } = await supabase
    .from('product_variants')
    .select('id')
    .eq('product_id', productId);
  if (loadErr) throw loadErr;
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));

  const keepIds = new Set<string>();
  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ id: string; row: Record<string, unknown> }> = [];

  variants.forEach((v, i) => {
    const row = {
      product_id: productId,
      options: v.options,
      label: v.label,
      stock: Math.max(0, Math.trunc(v.stock || 0)),
      position: i,
    };
    if (v.id && existingIds.has(v.id)) {
      keepIds.add(v.id);
      toUpdate.push({ id: v.id, row });
    } else {
      toInsert.push(row);
    }
  });

  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase.from('product_variants').delete().in('id', toDelete);
    if (error) throw error;
  }
  for (const u of toUpdate) {
    const { error } = await supabase.from('product_variants').update(u.row).eq('id', u.id);
    if (error) throw error;
  }
  if (toInsert.length > 0) {
    const { error } = await supabase.from('product_variants').insert(toInsert);
    if (error) throw error;
  }
}
