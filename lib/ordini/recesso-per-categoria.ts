import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 26/11/2026 — IL PANE È ESCLUSO DAL RECESSO ANCHE SE IL NEGOZIO NON L'HA SPUNTATO.
 * La spunta `non_recedibile` (migrazione 180) parte spenta: un pane creato senza
 * toccarla accettava «Cambio idea» (HTTP 201). Il fatto `legale.recesso-esclusi`
 * dice che pane, dolci, salumi, latticini e gli altri freschi sono esclusi: la
 * categoria del prodotto lo sa già. Vale la categoria o uno dei suoi padri (una
 * sottocategoria del Panificio creata dal pannello resta pane). La spunta del
 * negozio resta e si somma: serve per le ordinazioni e i freschi fuori da queste.
 *
 * 27/11/2026 (R09-015) — La regola stava dentro la rotta dei resi (app/api/returns/create), e la
 * scheda prodotto e il carrello, PRIMA dell'acquisto (art. 49 c.1 lett. m Cod. Cons.), dicevano
 * «escluso dal recesso» solo con la spunta. Ora vive qui, una volta sola, e la leggono tutti e tre.
 *
 * 🟢 Pura: nessuna rete, nessun orologio.
 */
export const CATEGORIE_DEPERIBILI = new Set([
  'panificio',
  'alimentari-dolci',
  'salumeria',
  'alimentari-latticini',
  'alimentari-pasta-fresca',
  'frutta-verdura',
]);
export type CategoriaPerIlRecesso = { id: string; slug: string; parent_id: string | null };

export function segnaIDeperibili<P extends { category_id?: unknown }>(prodotti: P[], categorie: CategoriaPerIlRecesso[]): P[] {
  const perId = new Map(categorie.map((c) => [c.id, c]));
  const deperibile = (id: unknown): boolean => {
    let cur = typeof id === 'string' ? perId.get(id) : undefined;
    for (let passi = 0; cur && passi < 20; passi++) {
      if (CATEGORIE_DEPERIBILI.has(cur.slug)) return true;
      cur = cur.parent_id ? perId.get(cur.parent_id) : undefined;
    }
    return false;
  };
  return prodotti.map((p) => (deperibile(p.category_id) ? { ...p, non_recedibile: true } : p));
}

/**
 * Per la scheda prodotto e il carrello (nel browser): i prodotti letti con `*` diventano esclusi
 * anche per la categoria. Le categorie si leggono solo se serve (un prodotto ha `category_id`). Se
 * la lettura cade, restano come sono: vale la spunta, e altrimenti la frase generale del reso, che
 * nomina già i freschi.
 */
export async function esclusiAncheDallaCategoria<P extends { category_id?: unknown }>(
  supabase: SupabaseClient,
  prodotti: P[],
): Promise<P[]> {
  if (!prodotti.some((p) => typeof p.category_id === 'string')) return prodotti;
  try {
    const { data, error } = await supabase.from('categories').select('id, slug, parent_id');
    if (error || !Array.isArray(data)) return prodotti;
    return segnaIDeperibili(prodotti, data as CategoriaPerIlRecesso[]);
  } catch {
    return prodotti;
  }
}
