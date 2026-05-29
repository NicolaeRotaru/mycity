import type { MetadataRoute } from 'next';
import { createClient } from '@supabase/supabase-js';

export const revalidate = 3600; // sitemap rigenerato ogni ora

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');

const STATIC_PATHS: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
  { path: '/',          priority: 1.0, changeFrequency: 'daily'   },
  { path: '/near',      priority: 0.9, changeFrequency: 'daily'   },
  { path: '/stores',    priority: 0.9, changeFrequency: 'daily'   },
  { path: '/groups',    priority: 0.7, changeFrequency: 'daily'   },
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const now = new Date();
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((s) => ({
    url: `${APP_URL}${s.path}`,
    lastModified: now,
    priority: s.priority,
    changeFrequency: s.changeFrequency,
  }));

  // Senza chiavi DB, restituiamo solo le statiche (es. in build locale).
  if (!url || !key) return staticEntries;

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [products, stores, categories] = await Promise.all([
    supabase
      .from('products')
      .select('id, created_at, profiles!products_seller_id_fkey ( is_approved )')
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase
      .from('profiles')
      .select('id, created_at')
      .eq('role', 'seller')
      .eq('is_approved', true)
      .limit(2000),
    supabase
      .from('categories')
      .select('slug')
      .limit(200),
  ]);

  type ProductSlug = { id: string; created_at?: string | null; profiles?: { is_approved?: boolean } | null };
  type StoreSlug = { id: string; created_at?: string | null };
  type CategorySlug = { slug: string };

  const productEntries: MetadataRoute.Sitemap = ((products.data ?? []) as unknown as ProductSlug[])
    .filter((p) => p.profiles?.is_approved)
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
