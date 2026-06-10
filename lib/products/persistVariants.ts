import { supabase } from '@/lib/supabase/client';
import { type ProductVariant, normalizeVariants } from '@/lib/products/variants';

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

export async function saveProductVariants(
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
