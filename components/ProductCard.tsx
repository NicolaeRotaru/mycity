'use client';

import { memo, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Heart, Plus, Truck } from 'lucide-react';
import { addToCart } from '@/lib/cart';
import { toast } from 'sonner';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { FREE_SHIPPING_THRESHOLD, LOW_STOCK_THRESHOLD, NEW_PRODUCT_DAYS } from '@/lib/constants';
import { Badge } from './ui/Badge';
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

/**
 * Card prodotto "compatta": la FOTO è l'elemento dominante (~3/5 della card),
 * sotto un corpo essenziale (negozio · titolo · prezzo). Niente stelle vuote,
 * niente bottone a tutta larghezza: un "+" discreto aggiunge al carrello.
 * Pensata sia per la griglia verticale (catalogo) sia per le rail orizzontali (home).
 */
const ProductCard = ({
  id, name, price, images,
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
  // Iniziali del negozio per il mini-logo (modello negozi-first): "Salumeria Verdi" → "SV"
  const initials = (storeName ?? '').trim().split(/\s+/).map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase();

  return (
    <Link
      href={`/product/${id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-surface-200 bg-white transition-all duration-200 hover:-translate-y-1 hover:border-primary-200 hover:shadow-warm-lg"
    >
      {/* Badge in alto a sinistra */}
      <div className="absolute top-2 left-2 z-10 flex flex-col gap-1">
        {hasDiscount && <Badge variant="discount">-{discountPercent}%</Badge>}
        {isNew && <Badge variant="new">Nuovo</Badge>}
        {isOutOfStock && <Badge variant="soldout">Esaurito</Badge>}
        {isLowStock && !isOutOfStock && <Badge variant="lowstock">Ultimi {stock}</Badge>}
      </div>

      {/* FOTO dominante (~3/5) */}
      <div className="relative aspect-square w-full overflow-hidden bg-surface-50">
        <Image
          src={img}
          alt={name}
          fill
          sizes="(min-width: 1024px) 220px, (min-width: 640px) 33vw, 45vw"
          priority={priority}
          loading={priority ? undefined : 'lazy'}
          unoptimized
          className="object-cover transition-transform duration-300 group-hover:scale-110"
        />
        <button
          type="button"
          onClick={handleFav}
          aria-label={isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}
          className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/95 shadow transition-transform hover:scale-110 hover:bg-white"
        >
          <Heart
            size={14}
            strokeWidth={2}
            className={`${isFav ? 'fill-secondary-500 text-secondary-500' : 'text-ink-400'} ${heartBeat ? 'animate-heart-beat' : ''}`}
          />
        </button>
      </div>

      {/* Corpo compatto */}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        {storeName && (
          <div className="flex items-center gap-1.5">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-500 to-primary-700 text-[8px] font-bold text-white">
              {initials}
            </span>
            <span className="truncate text-[10px] font-semibold text-ink-500">{storeName}</span>
          </div>
        )}
        <h3 className="line-clamp-2 min-h-[2.4em] text-xs font-semibold leading-snug text-ink-900 transition-colors group-hover:text-primary-700">
          {name}
        </h3>

        <div className="mt-auto flex items-center gap-1.5 pt-1">
          {hasDiscount ? (
            <>
              <span className="text-base font-extrabold text-secondary-600">{formatPrice(discountedPrice)}</span>
              <span className="text-[11px] text-ink-400 line-through">{formatPrice(price)}</span>
            </>
          ) : (
            <span className="text-base font-extrabold text-ink-900">{formatPrice(price)}</span>
          )}
          <button
            type="button"
            onClick={handleAdd}
            disabled={isOutOfStock}
            aria-label={`Aggiungi ${name} al carrello`}
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-600 text-white shadow-sm transition-all hover:bg-primary-700 active:scale-95 disabled:cursor-not-allowed disabled:bg-cream-200 disabled:text-ink-400 disabled:active:scale-100"
          >
            <Plus size={16} strokeWidth={2.6} aria-hidden />
          </button>
        </div>

        {freeShipping && (
          <span className="inline-flex w-fit items-center gap-0.5 rounded bg-olive-50 px-1.5 py-0.5 text-[10px] font-semibold text-olive-700">
            <Truck size={10} strokeWidth={2.4} aria-hidden />
            Sped. gratis
          </span>
        )}
      </div>
    </Link>
  );
};

export default memo(ProductCard);
