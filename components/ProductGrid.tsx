'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';
import { queryKeys } from '@/lib/queries/keys';
import { SkeletonGrid } from './SkeletonCard';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';

export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating';

interface Props {
  categoryId?: string;
  sellerId?: string;
  search?: string;
  limit?: number;
  maxPrice?: number;
  minPrice?: number;
  onlyOpenStores?: boolean;
  minRating?: number;
  sort?: SortOption;
}

const ProductGrid = ({ categoryId, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores, minRating, sort = 'relevance' }: Props) => {
  const { data: products = [], isLoading } = useQuery({
    queryKey: queryKeys.products.grid({ categoryId, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores, minRating, sort }),
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select(`
          id, name, description, price, images, stock, created_at, seller_id,
          profiles!products_seller_id_fkey!inner ( store_name, store_hours, is_approved )
        `)
        .eq('status', 'available')
        .eq('profiles.is_approved', true);

      // Ordinamento dinamico (default: created_at desc)
      switch (sort) {
        case 'price_asc':  q = q.order('price', { ascending: true }); break;
        case 'price_desc': q = q.order('price', { ascending: false }); break;
        case 'newest':     q = q.order('created_at', { ascending: false }); break;
        default:           q = q.order('created_at', { ascending: false });
      }

      if (categoryId) q = q.eq('category_id', categoryId);
      if (sellerId)   q = q.eq('seller_id', sellerId);
      if (search) {
        const safe = search.replace(/[%_]/g, '\\$&').slice(0, 100);
        q = q.ilike('name', `%${safe}%`);
      }
      if (maxPrice !== undefined) q = q.lte('price', maxPrice);
      if (minPrice !== undefined) q = q.gte('price', minPrice);
      if (limit)      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Carica rating aggregato per i prodotti visibili (per filtro/ordinamento per rating)
  type Prod = {
    id: string; name: string; description: string | null; price: string | number;
    images: string[] | null; stock: number | null; created_at: string;
    seller_id: string | null;
    profiles?: { store_name: string | null; is_approved?: boolean; store_hours?: unknown } | null;
  };
  const prods = products as unknown as Prod[];
  const { data: ratings = {} } = useQuery({
    queryKey: queryKeys.products.ratings(prods.map((p) => p.id).sort().join(',')),
    enabled: (minRating !== undefined && minRating > 0) || sort === 'rating',
    queryFn: async () => {
      if (prods.length === 0) return {};
      const ids = prods.map((p) => p.id);
      const { data } = await supabase
        .from('reviews')
        .select('product_id, rating')
        .in('product_id', ids);
      const map: Record<string, { avg: number; count: number }> = {};
      type ReviewRow = { product_id: string; rating: number };
      for (const r of (data ?? []) as ReviewRow[]) {
        const ex = map[r.product_id];
        if (ex) { ex.avg = (ex.avg * ex.count + r.rating) / (ex.count + 1); ex.count += 1; }
        else map[r.product_id] = { avg: r.rating, count: 1 };
      }
      return map;
    },
  });

  // Filtro client-side: orari aperti, rating minimo, ordinamento per rating
  const filtered = useMemo(() => {
    let arr = prods;
    if (onlyOpenStores) {
      const todayKey = DAY_KEYS[new Date().getDay()];
      arr = arr.filter((p) => {
        const hours = (p.profiles?.store_hours ?? {}) as StoreHours;
        return isOpenNow(hours[todayKey]);
      });
    }
    if (minRating !== undefined && minRating > 0) {
      arr = arr.filter((p) => (ratings as any)[p.id]?.avg >= minRating);
    }
    if (sort === 'rating') {
      arr = [...arr].sort((a, b) => {
        const ra = (ratings as any)[a.id]?.avg ?? 0;
        const rb = (ratings as any)[b.id]?.avg ?? 0;
        return rb - ra;
      });
    }
    return arr;
  }, [products, onlyOpenStores, minRating, ratings, sort]);

  if (isLoading) return <SkeletonGrid count={limit ?? 8} />;

  if (filtered.length === 0) {
    return (
      <div className="text-center py-16 bg-white border border-cream-300 rounded-xl">
        <SearchX size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" />
        <p className="text-ink-700 font-semibold mb-1">Nessun prodotto trovato</p>
        <p className="text-sm text-ink-400">Prova a modificare i filtri o cerca qualcos&apos;altro</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {filtered.map((p) => (
        <ProductCard
          key={p.id}
          id={p.id}
          name={p.name}
          description={p.description ?? ''}
          price={Number(p.price)}
          images={Array.isArray(p.images) ? p.images : []}
          stock={p.stock ?? undefined}
          createdAt={p.created_at}
          storeName={p.profiles?.store_name ?? undefined}
          sellerId={p.seller_id ?? undefined}
        />
      ))}
    </div>
  );
};

export default ProductGrid;
