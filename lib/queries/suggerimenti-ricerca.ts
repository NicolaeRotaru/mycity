import { conNegozioApprovato, COLONNE_NEGOZIO_IN_VETRINA } from '@/lib/queries/seller-public-profiles';
import type { LettoreConFunzioni } from '@/lib/queries/fasce-prodotti';

/**
 * I SUGGERIMENTI DELLA BARRA DI RICERCA: prodotti, negozi, categorie.
 *
 * 15/10/2026 (R3) — Il ripiego per le parole a meta' («pomo» per «Pomodori»)
 * cercava i prodotti agganciando il negozio a `profiles` con `!inner` e
 * pretendendo `profiles.is_approved`. Con la migrazione 161 `profiles` si chiude
 * a chi non e' il proprietario: per ogni cliente l'aggancio interno non trova
 * niente e il ripiego risponde sempre zero. Adesso i prodotti si cercano per
 * nome, e si tengono quelli il cui negozio compare nella vista pubblica dei
 * negozi approvati.
 */

export type Suggerimento =
  | { kind: 'product'; id: string; name: string; price: number; image: string | null; store: string | null }
  | { kind: 'store'; id: string; name: string; logo: string | null }
  | { kind: 'category'; slug: string; name: string };

/** Quanti prodotti propone la tendina. */
const PRODOTTI_SUGGERITI = 6;

/**
 * Il ripiego chiede qualche riga in piu' di quante ne mostra: quelle di un
 * negozio non approvato si scartano DOPO la lettura, e la tendina non deve
 * restare corta per colpa loro.
 */
const PRODOTTI_LETTI_NEL_RIPIEGO = PRODOTTI_SUGGERITI * 2;

type ProdSuggest = { id: string; name: string; price: number | string; images: string[] | null; store_name: string | null };
type StoreSuggest = { id: string; store_name: string | null; store_logo: string | null };
type CatSuggest = { slug: string; name: string };

/** I prodotti il cui nome contiene il termine, solo di negozi approvati. */
export async function prodottiPerNome(supa: LettoreConFunzioni, term: string): Promise<ProdSuggest[]> {
  const { data } = await supa
    .from('products')
    .select('id, name, price, images, seller_id')
    .eq('status', 'available')
    .ilike('name', `%${term}%`)
    .limit(PRODOTTI_LETTI_NEL_RIPIEGO);
  type Riga = { id: string; name: string; price: number | string; images: string[] | null; seller_id: string | null };
  const approvati = await conNegozioApprovato(supa, (data ?? []) as Riga[], COLONNE_NEGOZIO_IN_VETRINA);
  return approvati.slice(0, PRODOTTI_SUGGERITI).map((p) => ({
    id: p.id,
    name: p.name,
    price: p.price,
    images: p.images,
    store_name: p.profiles.store_name ?? null,
  }));
}

/** Tutti i suggerimenti per un termine: prima i prodotti, poi negozi e categorie. */
export async function leggiSuggerimentiRicerca(supa: LettoreConFunzioni, term: string): Promise<Suggerimento[]> {
  const pattern = `%${term}%`;
  // 1) Prodotti via RPC smart (FTS italiano + trigram fallback). Più
  //    rilevante di ILIKE: matcha morfologicamente (es. "salumeria"
  //    matcha "salumerie") e ordina per ranking semantico.
  const [productsRes, storesRes, categoriesRes] = await Promise.all([
    supa.rpc('search_products_smart', { q: term, lim: PRODOTTI_SUGGERITI }),
    supa
      .from('seller_public_profiles')
      .select('id, store_name, store_logo')
      .ilike('store_name', pattern)
      .limit(3),
    supa
      .from('categories')
      .select('slug, name')
      .ilike('name', pattern)
      .limit(3),
  ]);

  // La RPC usa FTS italiano: per termini PARZIALI (es. "pomo") può non
  // matchare "Pomodori". Fallback ILIKE su name (stessa logica di /search)
  // così il suggest resta coerente con la pagina dei risultati.
  let prodRows = ((productsRes as { data: unknown }).data ?? []) as ProdSuggest[];
  if (prodRows.length === 0) prodRows = await prodottiPerNome(supa, term);

  const products: Suggerimento[] = prodRows.map((p) => ({
    kind: 'product' as const,
    id: p.id,
    name: p.name,
    price: Number(p.price),
    image: Array.isArray(p.images) && p.images[0] ? p.images[0] : null,
    store: p.store_name ?? null,
  }));
  const stores: Suggerimento[] = (((storesRes as { data: unknown }).data ?? []) as StoreSuggest[]).map((s) => ({
    kind: 'store' as const,
    id: s.id,
    name: s.store_name ?? 'Negozio',
    logo: s.store_logo ?? null,
  }));
  const cats: Suggerimento[] = (((categoriesRes as { data: unknown }).data ?? []) as CatSuggest[]).map((c) => ({
    kind: 'category' as const,
    slug: c.slug,
    name: c.name,
  }));
  return [...products, ...stores, ...cats];
}
