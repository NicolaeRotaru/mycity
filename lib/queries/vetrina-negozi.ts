import type { SupabaseClient } from '@supabase/supabase-js';
import { conRipiegoSchema, senzaColonne, stessaFormaDi, COLONNE_124_VISTA } from '@/lib/db/migrazione-124';

/**
 * LA VETRINA DEI NEGOZI IN HOME: sei botteghe, tre prodotti ciascuna.
 *
 * 27/8/2026 (R079) — due difetti nella stessa lettura.
 *
 * ① SCARICAVA DUECENTO PRODOTTI PER MOSTRARNE DICIOTTO. La scheda del negozio ne mostra tre
 *   (`StorePreviewCard` fa `products.slice(0, 3)`): gli altri centottantadue arrivavano lo stesso,
 *   colonna delle foto compresa, e venivano buttati. Sulla home, cioè sulla pagina che ogni
 *   visitatore apre per prima e quasi sempre da telefono. Il database sa già dare i primi N di
 *   OGNI negozio — è la funzione `store_cards`, scritta apposta il 20 agosto e usata da /stores e
 *   da /near — e da lì escono diciotto righe invece di duecento.
 *
 * ② SCEGLIEVA I SEI NEGOZI A CASO. `.limit(6)` senza `.order()`: quali negozi finiscono in home lo
 *   decideva il piano di esecuzione di PostgreSQL. La stessa persona poteva vedere sei negozi
 *   diversi a ogni ricarica, e al negoziante che chiede «perché il mio non c'è mai» non si poteva
 *   rispondere niente. Adesso l'ordine è dichiarato — per insegna, lo stesso che usa `store_cards`
 *   al suo interno — quindi la vetrina è una scelta, non un caso.
 */

export type ProdottoDiVetrina = {
  id: string;
  name: string;
  /** Sempre un numero: dal database `numeric` arriva come testo, e la scheda si aspetta un numero. */
  price: number;
  images: string[] | null;
  seller_id?: string;
};

const conPrezzoNumerico = (p: ProdottoDiVetrina): ProdottoDiVetrina => ({ ...p, price: Number(p.price) });

export interface VetrinaNegozi<S> {
  stores: S[];
  productsByStore: Record<string, ProdottoDiVetrina[]>;
  reviewsByStore: Record<string, { avg: number; count: number }>;
}

/** Quanti negozi in vetrina, e quanti prodotti per negozio ne mostra la scheda. */
export const NEGOZI_IN_VETRINA = 6;
export const PRODOTTI_PER_NEGOZIO = 3;

const SELECT_SHOWCASE =
  'id, store_name, store_address, store_logo, store_hours, store_media, is_approved, stripe_charges_enabled, stripe_payouts_enabled';

export async function leggiVetrinaNegozi<S extends { id: string }>(
  supabase: SupabaseClient,
): Promise<VetrinaNegozi<S>> {
  // 22/8/2026 — ripiego sulle due colonne che nascono con la migrazione 124: senza, la vetrina in
  // home resta vuota su un database indietro.
  const conBandierine = () =>
    supabase.from('seller_public_profiles').select(SELECT_SHOWCASE).order('store_name').limit(NEGOZI_IN_VETRINA);
  const { data: storesRaw, error } = await conRipiegoSchema(
    'StoreShowcase:seller_public_profiles',
    conBandierine,
    () =>
      stessaFormaDi<Awaited<ReturnType<typeof conBandierine>>>(
        supabase
          .from('seller_public_profiles')
          .select(senzaColonne(SELECT_SHOWCASE, COLONNE_124_VISTA))
          .order('store_name')
          .limit(NEGOZI_IN_VETRINA),
      ),
  );
  if (error) throw error;

  const stores = (storesRaw ?? []) as unknown as S[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) return { stores: [], productsByStore: {}, reviewsByStore: {} };

  const [cardsRes, reviewsRes] = await Promise.all([
    supabase.rpc('store_cards', { p_per_store: PRODOTTI_PER_NEGOZIO, p_limit: NEGOZI_IN_VETRINA }),
    supabase.rpc('store_review_stats', { p_store_ids: storeIds }),
  ]);

  const productsByStore: Record<string, ProdottoDiVetrina[]> = {};
  type RigaCard = { seller_id: string; prodotti: ProdottoDiVetrina[] | null };
  const cards = (cardsRes.data ?? []) as RigaCard[];

  if (!cardsRes.error && cards.length > 0) {
    for (const riga of cards) {
      if (!storeIds.includes(riga.seller_id)) continue;
      productsByStore[riga.seller_id] = (riga.prodotti ?? []).slice(0, PRODOTTI_PER_NEGOZIO).map(conPrezzoNumerico);
    }
  } else {
    // La funzione non c'è (migrazione indietro) o non ha risposto: meglio la vetrina piena con
    // qualche riga in più che una fila di negozi senza foto.
    const { data } = await supabase
      .from('products')
      .select('id, name, price, images, seller_id')
      .in('seller_id', storeIds)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(NEGOZI_IN_VETRINA * PRODOTTI_PER_NEGOZIO * 4);
    for (const p of (data ?? []) as ProdottoDiVetrina[]) {
      const perNegozio = (productsByStore[p.seller_id as string] ??= []);
      if (perNegozio.length < PRODOTTI_PER_NEGOZIO) perNegozio.push(conPrezzoNumerico(p));
    }
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of (reviewsRes.data ?? []) as { store_id: string; avg: number | string; count: number }[]) {
    reviewsByStore[r.store_id] = { avg: Number(r.avg), count: Number(r.count) };
  }

  return { stores, productsByStore, reviewsByStore };
}
