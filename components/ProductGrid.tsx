'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';
import { SkeletonGrid } from './SkeletonCard';

interface Props {
  categoryId?: string;
  sellerId?: string;
  search?: string;
  limit?: number;
  maxPrice?: number;
}

const ProductGrid = ({ categoryId, sellerId, search, limit, maxPrice }: Props) => {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', { categoryId, sellerId, search, limit, maxPrice }],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select(`
          id, name, description, price, images, stock, created_at, seller_id,
          profiles!products_seller_id_fkey ( store_name )
        `)
        .eq('status', 'available')
        .order('created_at', { ascending: false });
      if (categoryId) q = q.eq('category_id', categoryId);
      if (sellerId)   q = q.eq('seller_id', sellerId);
      if (search)     q = q.ilike('name', `%${search}%`);
      if (maxPrice)   q = q.lte('price', maxPrice);
      if (limit)      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <SkeletonGrid count={limit ?? 8} />;

  if (products.length === 0) {
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
      {products.map((p: any) => (
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
