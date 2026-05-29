'use client';

import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Heart, ShoppingCart, Truck } from 'lucide-react';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
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
  /** Sconto promo attivo in percentuale (0-100): mostra prezzo barrato + badge. */
  discountPercent?: number;
  /** true per le prime immagini above-the-fold (LCP): eager + fetchPriority alta. */
  priority?: boolean;
}

const ProductCard = ({
  id, name, description, price, images, rating, reviewCount = 0,
  stock, createdAt, storeName, sellerId, discountPercent, priority,
}: ProductCardProps) => {
  const hasDiscount = !!discountPercent && discountPercent > 0;
  const discountedPrice = hasDiscount ? price * (1 - (discountPercent as number) / 100) : price;
  const rawImg = images?.[0] ?? 'https://placehold.co/400x400/FBF7F0/C0492C?text=Foto';
  const img = sizedImage(rawImg, 'card');
  const { favorites, toggle } = useFavorites();
  const isFav = favorites.has(id);
  const [heartBeat, setHeartBeat] = useState(false);

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    addToCart({ id, name, price, image: img, sellerId, storeName });
    toast.success(`${name} aggiunto al carrello`, { duration: 2000 });
  };

  const handleFav = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Trigger animazione heart-beat ad ogni click (anche unfavorite)
    setHeartBeat(true);
    setTimeout(() => setHeartBeat(false), 600);
    toggle.mutate(id, {
      onError: (err: unknown) => {
        if (err instanceof Error && err.message === 'AUTH_REQUIRED') toast.error('Accedi per salvare nei preferiti');
        else toast.error('Errore');
      },
    });
  };

  // isNew calcolato post-hydration: Date.now() differisce server/client e
  // su prodotti creati vicino al limite NEW_PRODUCT_DAYS causa mismatch.
  const [isNew, setIsNew] = useState(false);
  useEffect(() => {
    if (!createdAt) return;
    const age = (Date.now() - new Date(createdAt).getTime()) / 86400000;
    setIsNew(age < NEW_PRODUCT_DAYS);
  }, [createdAt]);
  const isLowStock = stock !== undefined && stock > 0 && stock <= LOW_STOCK_THRESHOLD;
  const isOutOfStock = stock === 0;
  const freeShipping = price >= FREE_SHIPPING_THRESHOLD;

  return (
    <Link
      href={`/product/${id}`}
      className="group bg-white border border-cream-200 rounded-2xl overflow-hidden hover:shadow-warm-lg hover:-translate-y-1 hover:border-primary-200 transition-all duration-200 flex flex-col relative"
    >
      {/* Badges in alto a sinistra */}
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        {hasDiscount && (
          <span className="bg-rose-600 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">
            -{discountPercent}%
          </span>
        )}
        {isNew && (
          <span className="bg-olive-600 text-white text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide">
            Nuovo
          </span>
        )}
        {isOutOfStock && (
          <span className="bg-ink-700 text-white text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide">
            Esaurito
          </span>
        )}
        {isLowStock && !isOutOfStock && (
          <span className="bg-secondary-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wide">
            Ultimi {stock}
          </span>
        )}
      </div>

      {/* Immagine + favorite button */}
      <div className="relative w-full h-48 bg-gradient-to-br from-cream-50 to-cream-200 overflow-hidden">
        <Image
          src={img}
          alt={name}
          fill
          sizes="(min-width: 1024px) 240px, (min-width: 640px) 33vw, 50vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          unoptimized
          className="object-cover group-hover:scale-110 transition-transform duration-300"
        />
        <button
          type="button"
          onClick={handleFav}
          aria-label={isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
          className="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-white/95 hover:bg-white shadow flex items-center justify-center transition-transform hover:scale-110"
        >
          <Heart
            size={16}
            strokeWidth={2}
            className={`${isFav ? 'text-secondary-500 fill-secondary-500' : 'text-ink-400'} ${heartBeat ? 'animate-heart-beat' : ''}`}
          />
        </button>
      </div>

      <div className="p-3 flex flex-col flex-1">
        {storeName && (
          <p className="text-[11px] text-ink-400 uppercase tracking-wide truncate">
            {storeName}
          </p>
        )}
        <h3 className="font-semibold text-ink-800 line-clamp-2 mb-1 group-hover:text-primary-700 transition-colors">
          {name}
        </h3>

        {/* Rating */}
        <div className="flex items-center gap-1 mb-1 text-xs">
          <span className="text-accent-500">
            {rating !== undefined && rating > 0
              ? `${'★'.repeat(Math.round(rating))}${'☆'.repeat(5 - Math.round(rating))}`
              : '☆☆☆☆☆'}
          </span>
          <span className="text-ink-400">({reviewCount})</span>
        </div>

        {description && (
          <p className="text-ink-500 text-xs line-clamp-1 mb-2">{description}</p>
        )}

        <div className="mt-auto pt-2">
          <div className="flex items-baseline gap-2 mb-2 flex-wrap">
            {hasDiscount ? (
              <>
                <span className="text-xl font-bold text-rose-700">{formatPrice(discountedPrice)}</span>
                <span className="text-sm text-ink-400 line-through">{formatPrice(price)}</span>
              </>
            ) : (
              <span className="text-xl font-bold text-ink-900">{formatPrice(price)}</span>
            )}
            {freeShipping && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-olive-700 bg-olive-50 px-1.5 py-0.5 rounded">
                <Truck size={10} strokeWidth={2.4} aria-hidden />
                Sped. gratis
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={isOutOfStock}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-primary-600 hover:bg-primary-700 active:scale-[0.98] disabled:bg-cream-200 disabled:text-ink-400 disabled:cursor-not-allowed disabled:active:scale-100 text-white text-[13px] font-semibold py-2.5 rounded-full shadow-sm hover:shadow-warm transition-all duration-150"
          >
            {isOutOfStock ? (
              'Non disponibile'
            ) : (
              <>
                <ShoppingCart size={15} strokeWidth={2.4} aria-hidden />
                Aggiungi
              </>
            )}
          </button>
        </div>
      </div>
    </Link>
  );
};

export default memo(ProductCard);
