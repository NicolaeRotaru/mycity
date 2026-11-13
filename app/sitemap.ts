import type { MetadataRoute } from 'next';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { leggiInBlocchiTutte, leggiTutteLeRighe } from '@/lib/supabase/blocchi';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';

export const revalidate = 3600; // sitemap rigenerato ogni ora

const STATIC_PATHS: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
  { path: '/',          priority: 1.0, changeFrequency: 'daily'   },
  { path: '/near',      priority: 0.9, changeFrequency: 'daily'   },
  { path: '/stores',    priority: 0.9, changeFrequency: 'daily'   },
  { path: '/search',    priority: 0.5, changeFrequency: 'weekly'  },
  { path: '/sell',      priority: 0.6, changeFrequency: 'monthly' },
  { path: '/about',     priority: 0.5, changeFrequency: 'monthly' },
  { path: '/faq',       priority: 0.4, changeFrequency: 'monthly' },
  { path: '/help',      priority: 0.4, changeFrequency: 'monthly' },
  { path: '/contact',   priority: 0.4, changeFrequency: 'monthly' },
  { path: '/shipping',  priority: 0.3, changeFrequency: 'monthly' },
  { path: '/privacy',       priority: 0.3, changeFrequency: 'monthly' },
  { path: '/cookies',       priority: 0.3, changeFrequency: 'monthly' },
  { path: '/accessibility', priority: 0.3, changeFrequency: 'monthly' },
  { path: '/events',        priority: 0.6, changeFrequency: 'weekly'  },
  { path: '/shop-of-month', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/lists',         priority: 0.5, changeFrequency: 'weekly'  },
  // 5/11/2026 — Pagine pubbliche utili che mancavano.
  { path: '/categorie',     priority: 0.7, changeFrequency: 'weekly'  },
  { path: '/come-funziona', priority: 0.5, changeFrequency: 'monthly' },
  { path: '/terms',         priority: 0.3, changeFrequency: 'monthly' },
  { path: '/returns',       priority: 0.3, changeFrequency: 'monthly' },
];

/**
 * 5/11/2026 — NIENTE DATE FINTE.
 *
 * Qui le statiche e le categorie dicevano «cambiate adesso» a ogni rigenerazione, cioè ogni ora;
 * prodotti e negozi davano la data di CREAZIONE come se fosse quella di modifica. Google impara
 * che il campo non è affidabile e smette di usarlo. Le tabelle non hanno una colonna di ultima
 * modifica, quindi `lastModified` non si scrive: meglio niente che una data inventata.
 */

/**
 * Sitemap dinamica: statiche + tutte le categorie + tutti i prodotti
 * disponibili di seller approvati + tutti gli store approvati. Letta da
 * Googlebot, Bingbot ecc. La cache è gestita da Next con `revalidate = 3600`.
 */
/**
 * Le categorie che hanno almeno un prodotto: la sua, e tutte quelle sopra di lei. Il tetto ai
 * passi tiene fermo il giro anche se un giorno una categoria finisse per essere madre di sé stessa.
 */
function categorieConProdotti(
  categorie: ReadonlyArray<{ id: string; parent_id?: string | null }>,
  prodotti: ReadonlyArray<{ category_id?: string | null }>,
): Set<string> {
  const madreDi = new Map(categorie.map((c) => [c.id, c.parent_id ?? null]));
  const piene = new Set<string>();
  for (const p of prodotti) {
    let id = p.category_id ?? null;
    for (let passi = 0; id && !piene.has(id) && passi < 10; passi += 1) {
      piene.add(id);
      id = madreDi.get(id) ?? null;
    }
  }
  return piene;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Un solo posto decide l'indirizzo del sito (lib/env.ts). Con la copia locale
  // che ripiegava su localhost, ogni riga della sitemap indicava a Google una
  // pagina irraggiungibile: nessuna di quelle pagine poteva essere indicizzata.
  const APP_URL = env.appUrl();
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((s) => ({
    url: `${APP_URL}${s.path}`,
    priority: s.priority,
    changeFrequency: s.changeFrequency,
  }));

  // Senza chiavi DB restituiamo solo le pagine statiche. Qui il silenzio è una SCELTA scritta, non
  // una dimenticanza (R010): una compilazione locale senza chiavi deve poter finire. Ovunque
  // altrove sotto `app/` la mancanza delle variabili adesso si sente, invece di trasformarsi in un
  // «non trovato» che finisce su Google.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return staticEntries;
  }

  const supabase = creaClientAnonimo();

  type ProductSlug = { id: string; created_at?: string | null; seller_id?: string; category_id?: string | null };
  type StoreSlug = { id: string; created_at?: string | null };
  type CategorySlug = { id: string; slug: string; parent_id?: string | null };

  // 12/11/2026 (R06-006) — `.limit(2000)` non e' una lettura completa: il database
  // ne consegna al massimo mille per richiesta. I negozi si leggono a finestre.
  const [storesRes, categoriesRes] = await Promise.all([
    leggiTutteLeRighe<StoreSlug>((da, a) =>
      supabase
        .from('seller_public_profiles')
        .select('id, created_at')
        .order('id', { ascending: true })
        .range(da, a) as unknown as PromiseLike<{ data: StoreSlug[] | null; error: { message?: string } | null }>,
    ),
    supabase
      .from('categories')
      .select('id, slug, parent_id')
      .limit(200),
  ]);

  const approvedSellerIds = ((storesRes.data ?? []) as StoreSlug[]).map((s) => s.id);
  // #93 — Duemila negozi passati tutti nell'indirizzo della richiesta fanno
  // settantaquattromila caratteri: il server risponde 414 e qui si legge
  // «nessun prodotto». La sitemap continuerebbe a rispondere, vuota, e Google
  // smetterebbe di indicizzare il catalogo senza che nessuno se ne accorga.
  // 12/11/2026 (R06-006) — Una sola richiesta per blocco con `.limit(5000)` tornava al
  // massimo mille prodotti: oltre, i piu' vecchi sparivano dalla mappa senza dirlo.
  // Dentro ogni blocco di negozi si legge a finestre di mille finche' finiscono.
  const products = await leggiInBlocchiTutte<ProductSlug>(approvedSellerIds, (blocco, da, a) =>
    supabase
      .from('products')
      .select('id, created_at, seller_id, category_id')
      .eq('status', 'available')
      .in('seller_id', blocco)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(da, a) as unknown as PromiseLike<{ data: ProductSlug[] | null; error: { message?: string } | null }>,
  );
  // Il tetto dei 5000 indirizzi di prodotto resta, ma quando scatta si dice.
  if (products.troncato || (products.data ?? []).length > 5000 || storesRes.troncato) {
    logger.warn('[sitemap] tetto raggiunto: la mappa non elenca tutti i prodotti o tutti i negozi', {
      prodotti: (products.data ?? []).length,
      negozi: (storesRes.data ?? []).length,
    });
  }

  const stores = storesRes;
  const categories = categoriesRes;

  const productEntries: MetadataRoute.Sitemap = ((products.data ?? []) as unknown as ProductSlug[])
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, 5000)
    .map((p) => ({
      url: `${APP_URL}/product/${p.id}`,
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    }));

  const storeEntries: MetadataRoute.Sitemap = ((stores.data ?? []) as StoreSlug[]).map((s) => ({
    url: `${APP_URL}/store/${s.id}`,
    priority: 0.8,
    changeFrequency: 'weekly' as const,
  }));

  // 31/10/2026 — A GOOGLE SOLO LE CATEGORIE CON QUALCOSA DENTRO. Qui c'erano tutte: 72 indirizzi
  // di categoria, e solo 3 avevano un prodotto. Ognuna era una pagina vuota mandata da indicizzare.
  // Adesso una categoria entra se ha almeno un prodotto disponibile di un negozio approvato, suo o
  // di una sua sottocategoria. Se la lettura dei prodotti fallisce si tengono tutte, come prima:
  // un errore di rete non deve togliere da Google le categorie vere.
  const tutteLeCategorie = (categories.data ?? []) as CategorySlug[];
  // 5/11/2026 — Anche se cade la lettura dei NEGOZI si tengono tutte: senza negozi l'elenco dei
  // prodotti esce vuoto «senza errore», e prima la mappa toglieva a Google ogni categoria.
  const conProdotti = products.error || stores.error ? null : categorieConProdotti(tutteLeCategorie, (products.data ?? []) as ProductSlug[]);
  const categorieDaMandare = conProdotti ? tutteLeCategorie.filter((c) => conProdotti.has(c.id)) : tutteLeCategorie;

  const categoryEntries: MetadataRoute.Sitemap = categorieDaMandare.map((c) => ({
    url: `${APP_URL}/category/${c.slug}`,
    priority: 0.6,
    changeFrequency: 'weekly' as const,
  }));

  return [...staticEntries, ...categoryEntries, ...storeEntries, ...productEntries];
}
