'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';

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
        .select('id, name, description, price, images')
        .eq('status', 'available')
        .order('created_at', { ascending: false });
      if (categoryId) q = q.eq('category_id', categoryId);
      if (sellerId) q = q.eq('seller_id', sellerId);
      if (search) q = q.ilike('name', `%${search}%`);
      if (maxPrice) q = q.lte('price', maxPrice);
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="text-center text-gray-500 py-8">Caricamento prodotti...</div>;
  if (products.length === 0) return <div className="text-center text-gray-500 py-8">Nessun prodotto trovato.</div>;

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
        />
      ))}
    </div>
  );
};

export default ProductGrid;
