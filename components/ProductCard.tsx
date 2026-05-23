'use client';

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { FREE_SHIPPING_THRESHOLD, LOW_STOCK_THRESHOLD, NEW_PRODUCT_DAYS } from '@/lib/constants';
import { useFavorites } from './hooks/useFavorites';

interface ProductCardProps {
  id: string;
  name: string;
  description?: string;
  price: number;
  images?: string[];
  rating?: number;
  reviewCount?: number;
  stock?: number;
  createdAt?: string;
  storeName?: string;
  sellerId?: string;
}

const ProductCard = ({
  id, name, description, price, images, rating, reviewCount = 0,
  stock, createdAt, storeName, sellerId,
}: ProductCardProps) => {
  const img = images?.[0] ?? 'https://placehold.co/400x400/eef2ff/6366f1?text=Foto';
  const { favorites, toggle } = useFavorites();
  const isFav = favorites.has(id);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart({ id, name, price, image: img, sellerId, storeName });
    toast.success(`${name} aggiunto al carrello`, { duration: 2000 });
  };

  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggle.mutate(id, {
      onError: (err: any) => {
        if (err?.message === 'AUTH_REQUIRED') toast.error('Accedi per salvare nei preferiti');
        else toast.error('Errore');
      },
    });
  };

  const isNew = createdAt
    ? (Date.now() - new Date(createdAt).getTime()) / 86400000 < NEW_PRODUCT_DAYS
    : false;
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  const isOutOfStock = stock === 0;
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;

  return (
    <Link
      href={`/product/${id}`}
      className="group bg-white border rounded-xl overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 flex flex-col relative"
    >
      {/* Badges in alto a sinistra */}
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        {isNew && (
          <span className="bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
            Nuovo
          </span>
        )}
        {isOutOfStock && (
          <span className="bg-gray-700 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
            Esaurito
          </span>
        )}
        {isLowStock && !isOutOfStock && (
          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
            Ultimi {stock}!
          </span>
        )}
      </div>

      {/* Immagine + favorite button */}
      <div className="relative w-full h-48 bg-gradient-to-br from-gray-50 to-gray-100 overflow-hidden">
        <Image
          src={img}
          alt={name}
          fill
          sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
          loading="lazy"
          unoptimized
          className="object-cover group-hover:scale-110 transition-transform duration-300"
        />
        <button
          type="button"
          onClick={handleFav}
          aria-label={isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow flex items-center justify-center text-lg transition-transform hover:scale-110"
        >
          <span className={isFav ? 'text-rose-500' : 'text-gray-300'}>
            {isFav ? '♥' : '♡'}
          </span>
        </button>
      </div>

      <div className="p-3 flex flex-col flex-1">
        {storeName && (
          <p className="text-[11px] text-gray-400 uppercase tracking-wide truncate">
            {storeName}
          </p>
        )}
        <h3 className="font-semibold text-gray-800 line-clamp-2 mb-1 group-hover:text-indigo-600 transition-colors">
          {name}
        </h3>

        {/* Rating */}
        <div className="flex items-center gap-1 mb-1 text-xs">
          <span className="text-yellow-500">
            {rating !== undefined && rating > 0
              ? `${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))}`
              : '☆☆☆☆☆'}
          </span>
          <span className="text-gray-400">({reviewCount})</span>
        </div>

        {description && (
          <p className="text-gray-500 text-xs line-clamp-1 mb-2">{description}</p>
        )}

        <div className="mt-auto pt-2">
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-xl font-extrabold text-gray-900">{formatPrice(price)}</span>
            {freeShipping && (
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                SPED. GRATIS
              </span>
            )}
          </div>
          <button
            onClick={handleAdd}
            disabled={isOutOfStock}
            className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:bg-gray-300 disabled:cursor-not-allowed text-gray-900 text-xs font-bold py-2 rounded-full transition-colors shadow-sm"
          >
            {isOutOfStock ? 'Non disponibile' : '🛒 Aggiungi al carrello'}
          </button>
        </div>
      </div>
    </Link>
  );
};

export default memo(ProductCard);
