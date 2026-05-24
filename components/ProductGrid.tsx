'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';
import { SkeletonGrid } from './SkeletonCard';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';

interface Props {
  categoryId?: string;
  sellerId?: string;
  search?: string;
  limit?: number;
  maxPrice?: number;
  minPrice?: number;
  onlyOpenStores?: boolean;
}

const ProductGrid = ({ categoryId, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores }: Props) => {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', { categoryId, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores }],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select(`
          id, name, description, price, images, stock, created_at, seller_id,
          profiles!products_seller_id_fkey!inner ( store_name, store_hours, is_approved )
        `)
        .eq('status', 'available')
        // Filtra i prodotti dei negozi sospesi/rifiutati/non approvati.
        // !inner sopra rende l'eq sul campo profili effettivo.
        .eq('profiles.is_approved', true)
        .order('created_at', { ascending: false });
      if (categoryId) q = q.eq('category_id', categoryId);
      if (sellerId)   q = q.eq('seller_id', sellerId);
      // ilike: scappa i wildcard SQL nel termine di ricerca per evitare DoS
      // con pattern tipo "%%%%" su tabelle grandi.
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

  // Memoizza il filtro client-side per non rifiltrare a ogni render del parent.
  const filtered = useMemo(() => {
    if (!onlyOpenStores) return products;
    const todayKey = DAY_KEYS[new Date().getDay()];
    return products.filter((p: any) => {
      const hours = (p.profiles?.store_hours ?? {}) as StoreHours;
      return isOpenNow(hours[todayKey]);
    });
  }, [products, onlyOpenStores]);

  if (isLoading) return <SkeletonGrid count={limit ?? 8} />;

  if (filtered.length === 0) {
    return (
      <div className="text-center py-16 bg-white border rounded-xl">
        <p className="text-5xl mb-3">🔍</p>
        <p className="text-gray-600 font-semibold mb-1">Nessun prodotto trovato</p>
        <p className="text-sm text-gray-400">Prova a modificare i filtri o cerca qualcos'altro</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {filtered.map((p: any) => (
        <ProductCard
          key={p.id}
          id={p.id}
          name={p.name}
          description={p.description ?? ''}
          price={Number(p.price)}
          images={Array.isArray(p.images) ? p.images : []}
          stock={p.stock}
          createdAt={p.created_at}
          storeName={p.profiles?.store_name ?? undefined}
          sellerId={p.seller_id ?? undefined}
        />
      ))}
    </div>
  );
};

export default ProductGrid;
