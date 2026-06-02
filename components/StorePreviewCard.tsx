'use client';

import Link from 'next/link';
import { MapPin, Star, ChevronRight, Package } from 'lucide-react';
import StoreAvatar from './StoreAvatar';
import StoreMediaCarousel, { type StoreMediaItem } from './StoreMediaCarousel';
import { VerifiedBadge } from './ui/VerifiedBadge';
import { sizedImage } from '@/lib/image-url';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';

export type StoreCardData = {
  id: string;
  store_name: string;
  store_address: string | null;
  store_logo: string | null;
  store_hours: StoreHours | null;
  store_media?: StoreMediaItem[] | null;
};

export type ProductPreview = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
};

interface Props {
  store: StoreCardData;
  products?: ProductPreview[];
  reviews?: { avg: number; count: number };
  /** distanza in km, opzionale: badge in alto a destra sopra il cover */
  distanceKm?: number | null;
  /** se true rende il cover un filo più basso */
  compact?: boolean;
}

/**
 * Card negozio "Vetrina pulita" (modello A) — un'unica identità coerente:
 * cover reale, logo, nome (sans), un solo stato ("Aperto · consegna oggi"),
 * rating con stella, 3 anteprime ordinate, un solo CTA. Usata nelle rail
 * orizzontali (home). Per le pagine-lista lunghe c'è invece StoreListRow.
 */
const StorePreviewCard = ({ store, products = [], reviews, distanceKm, compact = false }: Props) => {
  const hours = (store.store_hours ?? {}) as StoreHours;
  const todayKey = DAY_KEYS[new Date().getDay()];
  const open = isOpenNow(hours[todayKey]);
  const media = Array.isArray(store.store_media) ? store.store_media : [];
  const storeHref = `/store/${store.id}`;
  const thumbs = products.slice(0, 3);

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-warm-lg">
      {/* Cover + logo + (distanza) → link al negozio */}
      <Link href={storeHref} aria-label={`Apri ${store.store_name}`} className="relative block">
        <StoreMediaCarousel
          media={media}
          heightClass={compact ? 'h-24' : 'h-28'}
          fallbackClass="bg-gradient-to-br from-primary-500 via-primary-600 to-secondary-600"
        />
        {distanceKm !== undefined && distanceKm !== null && (
          <span className="absolute right-2.5 top-2.5 z-20 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-0.5 text-[11px] font-bold text-ink-900 shadow-warm">
            <MapPin size={11} strokeWidth={2.4} />
            {distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`}
          </span>
        )}
        {/* Logo a cavallo del cover, in basso a sinistra */}
        <div className="absolute -bottom-5 left-4 z-20 rounded-full bg-white shadow-warm-lg ring-4 ring-white">
          <StoreAvatar logoUrl={store.store_logo} storeName={store.store_name} size="md" />
        </div>
      </Link>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-7">
        <Link href={storeHref} className="block">
          <h3 className="inline-flex items-center gap-1.5 truncate text-[15px] font-bold text-ink-900 transition-colors group-hover:text-primary-700">
            <span className="truncate">{store.store_name}</span>
            <VerifiedBadge size="sm" />
          </h3>
        </Link>

        {/* Rating (solo se ci sono recensioni vere) */}
        <div className="mt-1 text-xs">
          {reviews ? (
            <span className="inline-flex items-center gap-1 font-semibold text-ink-800">
              <Star size={13} className="fill-accent-500 text-accent-500" aria-hidden />
              {reviews.avg.toFixed(1)}
              <span className="font-normal text-ink-400">({reviews.count})</span>
            </span>
          ) : (
            <span className="text-ink-400">Nuovo negozio</span>
          )}
        </div>

        {/* Un solo stato chiaro */}
        <span className={`mt-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${open ? 'bg-olive-100 text-olive-700' : 'bg-ink-100 text-ink-500'}`}>
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${open ? 'animate-pulse-soft bg-olive-600' : 'bg-ink-400'}`} />
          {open ? 'Aperto · consegna oggi' : 'Chiuso ora'}
        </span>

        {/* 3 anteprime prodotti ordinate */}
        {thumbs.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {thumbs.map((p) => (
              <div key={p.id} className="aspect-square overflow-hidden rounded-lg bg-cream-100">
                {p.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sizedImage(p.images[0], 'thumb')}
                    alt={p.name}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-cream-400">
                    <Package size={18} strokeWidth={1.6} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Link
          href={storeHref}
          className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink-900 px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-ink-800"
        >
          Vedi negozio
          <ChevronRight size={15} strokeWidth={2.4} />
        </Link>
      </div>
    </article>
  );
};

export default StorePreviewCard;
