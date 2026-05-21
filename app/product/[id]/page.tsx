'use client';

import { use, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import ProductGrid from '@/components/ProductGrid';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [quantity, setQuantity] = useState(1);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          *,
          categories ( slug, name ),
          profiles!products_seller_id_fkey ( id, store_name )
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviews', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reviews')
        .select('id, rating, comment, created_at')
        .eq('product_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (!product) return <div className="container mx-auto p-8 text-center">Prodotto non trovato.</div>;

  const images: string[] =
    Array.isArray(product.images) && product.images.length > 0
      ? (product.images as string[])
      : ['https://placehold.co/600x600/eee/aaa?text=Foto+prodotto'];

  const avgRating = reviews.length
    ? reviews.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviews.length
    : 0;

  const handleAdd = () => {
    addToCart({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      image: images[0],
      quantity,
    });
    toast.success(`${product.name} aggiunto al carrello`);
  };

  return (
    <div className="container mx-auto px-6 py-8">
      <nav className="text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:underline">Home</Link> /{' '}
        {product.categories && (
          <>
            <Link href={`/category/${product.categories.slug}`} className="hover:underline">
              {product.categories.name}
            </Link>{' '}/{' '}
          </>
        )}
        <span className="text-gray-700">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <div className="relative w-full h-96 bg-gray-100 rounded-lg overflow-hidden">
            <Image src={images[0]} alt={product.name} fill className="object-contain" unoptimized />
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-4 gap-2 mt-3">
              {images.slice(1, 5).map((img, i) => (
                <div key={i} className="relative aspect-square bg-gray-100 rounded">
                  <Image src={img} alt="" fill className="object-cover rounded" unoptimized />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <h1 className="text-3xl font-bold text-gray-900">{product.name}</h1>

          {product.profiles && (
            <Link
              href={`/store/${product.profiles.id}`}
              className="text-sm text-indigo-600 hover:underline inline-block"
            >
              Venduto da {product.profiles.store_name}
            </Link>
          )}

          {reviews.length > 0 && (
            <p className="text-yellow-500">
              {'★'.repeat(Math.round(avgRating))}
              {'☆'.repeat(5 - Math.round(avgRating))}{' '}
              <span className="text-gray-500 text-sm">({reviews.length} recensioni)</span>
            </p>
          )}

          <div className="text-4xl font-bold text-indigo-700">{formatPrice(Number(product.price))}</div>

          <p className="text-gray-600 leading-relaxed whitespace-pre-line">{product.description}</p>

          <div className="bg-gray-50 border rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-4">
              <label className="text-sm font-medium">Quantità:</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-8 h-8 border rounded hover:bg-gray-100"
                >−</button>
                <span className="w-10 text-center font-semibold">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-8 h-8 border rounded hover:bg-gray-100"
                >+</button>
              </div>
            </div>
            <button
              onClick={handleAdd}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-gray-900 py-3 rounded-lg font-bold transition-colors"
            >
              🛒 Aggiungi al carrello
            </button>
            <p className="text-xs text-gray-500 text-center">
              💳 Pagamento alla consegna · 🚚 Spedito da venditori locali
            </p>
          </div>
        </div>
      </div>

      <section className="mt-12">
        <h2 className="text-2xl font-bold mb-4">Recensioni</h2>
        {reviews.length === 0 ? (
          <p className="text-gray-500">Nessuna recensione ancora.</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r: any) => (
              <div key={r.id} className="bg-white border rounded-lg p-4">
                <p className="text-yellow-500 mb-1">
                  {'★'.repeat(Math.round(Number(r.rating)))}
                  {'☆'.repeat(5 - Math.round(Number(r.rating)))}
                </p>
                <p className="text-gray-700">{r.comment}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {product.category_id && (
        <section className="mt-12">
          <h2 className="text-2xl font-bold mb-4">Potrebbe piacerti anche</h2>
          <ProductGrid categoryId={product.category_id} limit={4} />
        </section>
      )}
    </div>
  );
}
