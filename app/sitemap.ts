import type { MetadataRoute } from 'next';
import { creaClientAnonimo } from '@/lib/supabase/anonimo';
import { leggiInBlocchi } from '@/lib/supabase/blocchi';
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
];

/**
 * Sitemap dinamica: statiche + tutte le categorie + tutti i prodotti
 * disponibili di seller approvati + tutti gli store approvati. Letta da
 * Googlebot, Bingbot ecc. La cache è gestita da Next con `revalidate = 3600`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Un solo posto decide l'indirizzo del sito (lib/env.ts). Con la copia locale
  // che ripiegava su localhost, ogni riga della sitemap indicava a Google una
  // pagina irraggiungibile: nessuna di quelle pagine poteva essere indicizzata.
  const APP_URL = env.appUrl();
  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((s) => ({
    url: `${APP_URL}${s.path}`,
    lastModified: now,
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

  type ProductSlug = { id: string; created_at?: string | null; seller_id?: string };
  type StoreSlug = { id: string; created_at?: string | null };
  type CategorySlug = { slug: string };

  const [storesRes, categoriesRes] = await Promise.all([
    supabase
      .from('seller_public_profiles')
      .select('id, created_at')
      .limit(2000),
    supabase
      .from('categories')
      .select('slug')
      .limit(200),
  ]);

  const approvedSellerIds = ((storesRes.data ?? []) as StoreSlug[]).map((s) => s.id);
  // #93 — Duemila negozi passati tutti nell'indirizzo della richiesta fanno
  // settantaquattromila caratteri: il server risponde 414 e qui si legge
  // «nessun prodotto». La sitemap continuerebbe a rispondere, vuota, e Google
  // smetterebbe di indicizzare il catalogo senza che nessuno se ne accorga.
  const products = await leggiInBlocchi<ProductSlug>(approvedSellerIds, (blocco) =>
    supabase
      .from('products')
      .select('id, created_at, seller_id')
      .eq('status', 'available')
      .in('seller_id', blocco)
      .order('created_at', { ascending: false })
      .limit(5000) as unknown as PromiseLike<{ data: ProductSlug[] | null; error: { message?: string } | null }>,
  );

  const stores = storesRes;
  const categories = categoriesRes;

  const productEntries: MetadataRoute.Sitemap = ((products.data ?? []) as unknown as ProductSlug[])
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
    .slice(0, 5000)
    .map((p) => ({
      url: `${APP_URL}/product/${p.id}`,
      lastModified: p.created_at ? new Date(p.created_at) : now,
      priority: 0.7,
      changeFrequency: 'weekly' as const,
    }));

  const storeEntries: MetadataRoute.Sitemap = ((stores.data ?? []) as StoreSlug[]).map((s) => ({
    url: `${APP_URL}/store/${s.id}`,
    lastModified: s.created_at ? new Date(s.created_at) : now,
    priority: 0.8,
    changeFrequency: 'weekly' as const,
  }));

  const categoryEntries: MetadataRoute.Sitemap = ((categories.data ?? []) as CategorySlug[]).map((c) => ({
    url: `${APP_URL}/category/${c.slug}`,
    lastModified: now,
    priority: 0.6,
    changeFrequency: 'weekly' as const,
  }));

  return [...staticEntries, ...categoryEntries, ...storeEntries, ...productEntries];
}
