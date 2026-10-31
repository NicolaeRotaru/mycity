import type { SupabaseClient } from '@supabase/supabase-js';
import { type ProductVariant } from '@/lib/products/variants';
import { DaCompletare } from '@/lib/products/salvataggio-tracciato';

/**
 * Persistenza varianti lato server (client admin service-role). Identica nella
 * logica a `persistVariants.ts` ma accetta un SupabaseClient esplicito: serve
 * all'admin per gestire le varianti di prodotti di un seller arbitrario, cosa
 * che il client browser (RLS, seller-scoped) non può fare.
 *
 * Il diff insert/update/delete mantiene stabili gli id delle varianti invariate
 * (riferimenti in order_items). Il trigger DB riallinea products.stock/has_variants.
 *
 * 28/10/2026 — `scorteViste` (id → pezzi, com'erano all'apertura del modulo):
 * la scorta di una variante gia' salvata si riscrive solo se e' diversa da
 * quella vista. Mentre il modulo resta aperto `reserve_stock` la abbassa a ogni
 * vendita: riscrivere il numero vecchio rimetterebbe in vetrina pezzi venduti.
 * Senza `scorteViste` si riscrive tutto, come prima.
 *
 * 31/10/2026 — E QUELLA CAMBIATA A MANO SI SCRIVE SOLO SE NESSUNO L'HA MOSSA.
 * La S vista a 2, venduta a 1 nel frattempo, riscritta a 4 dal negoziante: in
 * banca dati andava 4, e la vendita spariva. Adesso, se la scorta di una
 * variante cambiata non e' piu' quella vista, non si scrive niente (nessuna
 * variante, nessuna cancellazione) e un `DaCompletare` lo dice al negoziante. Resta
 * il buco dei millisecondi fra questa lettura e la scrittura: per chiuderlo
 * serve una funzione del database che scriva solo «se e' ancora N».
 */
export async function saveProductVariantsServer(
  supabase: SupabaseClient,
  productId: string,
  variants: ProductVariant[],
  scorteViste?: Record<string, number>,
): Promise<void> {
  const { data: existing, error: loadErr } = await supabase
    .from('product_variants')
    .select('id, stock')
    .eq('product_id', productId);
  if (loadErr) throw loadErr;
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  const scortaInBanca = new Map((existing ?? []).map((r) => [r.id as string, (r as { stock?: unknown }).stock]));

  const keepIds = new Set<string>();
  const toInsert: Array<Record<string, unknown>> = [];
  const toUpdate: Array<{ id: string; row: Record<string, unknown> }> = [];

  variants.forEach((v, i) => {
    const row: Record<string, unknown> = {
      product_id: productId,
      options: v.options,
      label: v.label,
      stock: Math.max(0, Math.trunc(v.stock || 0)),
      position: i,
    };
    if (v.id && existingIds.has(v.id)) {
      keepIds.add(v.id);
      const vista = scorteViste?.[v.id];
      if (vista !== undefined && Math.max(0, Math.trunc(vista || 0)) === row.stock) delete row.stock;
      const adesso = scortaInBanca.get(v.id);
      // Gia' in banca dati il numero che il negoziante chiede (un salvataggio
      // rimandato dopo una risposta persa): niente da scrivere, niente conflitto.
      if ('stock' in row && vista !== undefined && adesso === row.stock) delete row.stock;
      if ('stock' in row && vista !== undefined && typeof adesso === 'number' && adesso !== vista) {
        throw new DaCompletare(
          `La scorta di «${v.label}» è cambiata mentre modificavi: avevi davanti ${vista} pezzi, ora sono ${adesso}. Riapri il prodotto, controlla il numero e salva di nuovo.`,
          ['scorta'],
        );
      }
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
