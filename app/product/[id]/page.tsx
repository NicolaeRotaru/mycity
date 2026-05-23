'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { FREE_SHIPPING_THRESHOLD, LOW_STOCK_THRESHOLD } from '@/lib/constants';
import ProductGrid from '@/components/ProductGrid';
import { findLabelForKey, formatAttributeValue } from '@/lib/category-attributes';

export default function ProductPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [quantity, setQuantity] = useState(1);
  const [activeImg, setActiveImg] = useState(0);

  const { data: product, isLoading } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('products').select(`
        *, categories ( slug, name ), profiles!products_seller_id_fkey ( id, store_name )
      `).eq('id', id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['reviews', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('reviews')
        .select('id, rating, comment, created_at').eq('product_id', id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-pulse">
          <div className="bg-gray-200 h-96 rounded-xl" />
          <div className="space-y-3">
            <div className="h-6 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
            <div className="h-10 bg-gray-200 rounded w-1/3" />
            <div className="h-24 bg-gray-100 rounded" />
            <div className="h-12 bg-gray-200 rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) return <div className="container mx-auto p-8 text-center">Prodotto non trovato.</div>;

  const images: string[] = Array.isArray(product.images) && product.images.length > 0
    ? (product.images as string[])
    : ['https://placehold.co/600x600/eef2ff/6366f1?text=Foto+prodotto'];

  const avgRating = reviews.length
    ? reviews.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviews.length
    : 0;

  const price = Number(product.price);
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;
  const stock: number | undefined = product.stock ?? undefined;
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  const isOutOfStock = stock === 0;

  const sellerProfile = Array.isArray(product.profiles) ? product.profiles[0] : product.profiles;

  const handleAdd = () => {
    addToCart({
      id: product.id,
      name: product.name,
      price,
      image: images[0],
      quantity,
      sellerId: product.seller_id ?? sellerProfile?.id ?? undefined,
      storeName: sellerProfile?.store_name ?? undefined,
    });
    toast.success(`${product.name} aggiunto al carrello`, { duration: 2000 });
  };

  return (
    <div className="container mx-auto px-4 sm:px-6 py-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:underline">Home</Link>
        {product.categories && (
          <>
            <span className="mx-1">›</span>
            <Link href={`/category/${product.categories.slug}`} className="hover:underline">
              {product.categories.name}
            </Link>
          </>
        )}
        <span className="mx-1">›</span>
        <span className="text-gray-700">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1fr_320px] gap-6">
        {/* GALLERIA */}
        <div className="space-y-3">
          <div className="relative w-full aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl overflow-hidden border">
            <Image src={images[activeImg]} alt={product.name} fill className="object-contain p-4" unoptimized />
            {isOutOfStock && (
              <div className="absolute top-4 left-4 bg-gray-900 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                ESAURITO
              </div>
            )}
            {isLowStock && !isOutOfStock && (
              <div className="absolute top-4 left-4 bg-red-500 text-white text-xs font-bold px-3 py-1.5 rounded-full animate-pulse">
                🔥 SOLO {stock} DISPONIBILI
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {images.slice(0, 5).map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImg(i)}
                  className={`relative aspect-square bg-gray-100 rounded-lg overflow-hidden border-2 transition ${
                    activeImg === i ? 'border-indigo-500' : 'border-transparent hover:border-gray-300'
                  }`}
                >
                  <Image src={img} alt="" fill className="object-cover" unoptimized />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* INFO */}
        <div className="space-y-4">
          {product.profiles && (
            <Link
              href={`/store/${product.profiles.id}`}
              className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline bg-indigo-50 px-3 py-1.5 rounded-full"
            >
              🏪 {product.profiles.store_name}
            </Link>
          )}

          <h1 className="text-2xl md:text-3xl font-extrabold text-gray-900">{product.name}</h1>

          {/* Rating */}
          <div className="flex items-center gap-3 flex-wrap">
            {reviews.length > 0 ? (
              <>
                <span className="text-yellow-500 text-lg">
                  {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
                </span>
                <span className="text-sm text-gray-600 underline cursor-pointer">
                  {reviews.length} recensioni
                </span>
              </>
            ) : (
              <span className="text-sm text-gray-400">Sii il primo a recensire questo prodotto</span>
            )}
          </div>

          <div className="border-y py-4">
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-4xl font-extrabold text-gray-900">{formatPrice(price)}</span>
              <span className="text-sm text-gray-400">IVA inclusa</span>
            </div>
            {freeShipping ? (
              <p className="text-emerald-600 font-semibold text-sm">
                ✓ <strong>Spedizione GRATUITA</strong> · Consegna in 24-48h
              </p>
            ) : (
              <p className="text-gray-600 text-sm">
                Aggiungi <strong>{formatPrice(FREE_SHIPPING_THRESHOLD - price)}</strong> per la spedizione gratuita
              </p>
            )}
          </div>

          <div>
            <h3 className="font-bold text-sm uppercase tracking-wide text-gray-500 mb-2">Descrizione</h3>
            <p className="text-gray-700 leading-relaxed whitespace-pre-line">{product.description}</p>
          </div>

          {/* Caratteristiche */}
          {product.attributes &&
            typeof product.attributes === 'object' &&
            Object.keys(product.attributes).length > 0 && (
              <div>
                <h3 className="font-bold text-sm uppercase tracking-wide text-gray-500 mb-2">
                  Caratteristiche
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  {Object.entries(product.attributes as Record<string, unknown>).map(
                    ([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between items-baseline gap-3 py-1.5 border-b border-gray-100"
                      >
                        <dt className="text-sm text-gray-500">{findLabelForKey(key)}</dt>
                        <dd className="text-sm text-gray-800 font-medium text-right">
                          {formatAttributeValue(value)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </div>
            )}

          {/* Trust signals */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            {[
              { icon: '💰', label: 'Pagamento alla consegna' },
              { icon: '🚚', label: 'Consegna in 24-48h' },
              { icon: '↩️', label: 'Reso entro 14 giorni' },
              { icon: '🏘️', label: 'Venditore locale' },
            ].map((t) => (
              <div key={t.label} className="flex items-center gap-2 text-xs text-gray-700 bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-lg">{t.icon}</span>
                <span className="font-medium">{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* CTA STICKY */}
        <div className="lg:sticky lg:top-32 h-fit">
          <div className="bg-white border-2 border-yellow-300 rounded-xl p-5 shadow-lg space-y-3">
            <div className="text-2xl font-extrabold text-gray-900">{formatPrice(price)}</div>
            {freeShipping && (
              <p className="text-emerald-600 text-xs font-bold">SPEDIZIONE GRATUITA</p>
            )}
            <p className="text-xs">
              {isOutOfStock ? (
                <span className="text-red-600 font-bold">❌ Esaurito</span>
              ) : isLowStock ? (
                <span className="text-red-600 font-bold">🔥 Solo {stock} disponibili — affrettati!</span>
              ) : (
                <span className="text-emerald-600 font-bold">✓ Disponibile · pronto per la spedizione</span>
              )}
            </p>

            <div className="flex items-center gap-3 pt-2">
              <label className="text-sm font-medium">Q.tà:</label>
              <div className="flex items-center border rounded-lg">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-9 h-9 hover:bg-gray-50 rounded-l-lg"
                >−</button>
                <span className="w-10 text-center font-semibold">{quantity}</span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="w-9 h-9 hover:bg-gray-50 rounded-r-lg"
                >+</button>
              </div>
            </div>

            <button
              onClick={handleAdd}
              disabled={isOutOfStock}
              className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-900 py-3 rounded-lg font-bold shadow-md hover:shadow-lg transition-all"
            >
              {isOutOfStock ? 'Non disponibile' : '🛒 Aggiungi al carrello'}
            </button>

            <Link
              href="/cart"
              className="block w-full text-center bg-gray-900 hover:bg-gray-800 text-white py-3 rounded-lg font-bold"
            >
              Acquista ora
            </Link>

            <div className="pt-3 border-t space-y-1.5 text-xs text-gray-500">
              <p>📦 Venduto e spedito da <strong className="text-gray-700">{product.profiles?.store_name}</strong></p>
              <p>🔒 Acquisto protetto al 100%</p>
            </div>
          </div>
        </div>
      </div>

      {/* RECENSIONI */}
      <section className="mt-12">
        <h2 className="text-2xl font-extrabold mb-4">Recensioni dei clienti</h2>
        {reviews.length === 0 ? (
          <div className="bg-white border rounded-xl p-8 text-center">
            <p className="text-4xl mb-2">⭐</p>
            <p className="text-gray-600 font-medium">Nessuna recensione ancora</p>
            <p className="text-sm text-gray-400">Sii il primo a condividere la tua esperienza</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {reviews.map((r: any) => (
              <div key={r.id} className="bg-white border rounded-xl p-5">
                <p className="text-yellow-500 mb-2 text-lg">
                  {'★'.repeat(Math.round(Number(r.rating)))}{'☆'.repeat(5 - Math.round(Number(r.rating)))}
                </p>
                <p className="text-gray-700">{r.comment}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* CORRELATI */}
      {product.category_id && (
        <section className="mt-12">
          <h2 className="text-2xl font-extrabold mb-4">Potrebbe piacerti anche</h2>
          <ProductGrid categoryId={product.category_id} limit={4} />
        </section>
      )}
    </div>
  );
}
