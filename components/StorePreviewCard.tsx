'use client';

import Link from 'next/link';
import StoreAvatar from './StoreAvatar';
import { formatPrice } from '@/lib/format';
import {
  DAY_KEYS,
  formatToday,
  isOpenNow,
  streetFromAddress,
  type StoreHours,
} from '@/lib/store-hours';

export type StoreCardData = {
  id: string;
  store_name: string;
  store_address: string | null;
  store_logo: string | null;
  store_hours: any;
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
  /** distanza in km, opzionale: se presente compare in alto a destra */
  distanceKm?: number | null;
  /** se true mostra solo elementi essenziali (per showcase home) */
  compact?: boolean;
}

const StorePreviewCard = ({ store, products = [], reviews, distanceKm, compact = false }: Props) => {
  const street = streetFromAddress(store.store_address);
  const hours = (store.store_hours ?? {}) as StoreHours;
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayIntervals = hours[todayKey];
  const open = isOpenNow(todayIntervals);
  const todayLabel = formatToday(todayIntervals);

  const minPrice = products.length > 0
    ? Math.min(...products.slice(0, 8).map((p) => Number(p.price)))
    : null;

  const showPreview = !compact && products.length > 0;

  return (
    <Link
      href={`/store/${store.id}`}
      className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-xl hover:border-indigo-300 hover:-translate-y-0.5 transition-all flex flex-col"
    >
      {/* Banner gradient con badge stato */}
      <div className="relative h-16 sm:h-20 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shrink-0">
        <span
          className={`absolute top-2 right-2 sm:top-3 sm:right-3 inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold shadow ${
            open ? 'bg-emerald-500 text-white' : 'bg-black/60 text-white'
          }`}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          {open ? 'Aperto' : 'Chiuso'}
        </span>
        {reviews && reviews.avg >= 4.5 && (
          <span className="absolute top-2 left-2 sm:top-3 sm:left-3 inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold bg-amber-400 text-gray-900 shadow">
            🏆 Top
          </span>
        )}
        {distanceKm !== undefined && distanceKm !== null && (
          <span className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold bg-white/90 text-gray-900 shadow">
            📍 {distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`}
          </span>
        )}
      </div>

      <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex-1 flex flex-col">
        {/* Logo che sborda + info */}
        <div className="flex items-start gap-3 -mt-8 sm:-mt-10 mb-2 sm:mb-3">
          <div className="ring-4 ring-white rounded-full bg-white shrink-0">
            <StoreAvatar
              logoUrl={store.store_logo}
              storeName={store.store_name}
              size={compact ? 'md' : 'lg'}
            />
          </div>
          <div className="flex-1 min-w-0 pt-9 sm:pt-11">
            <h3 className="font-extrabold text-base sm:text-lg text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
              {store.store_name}
            </h3>
            <div className="flex items-center gap-2 text-sm">
              {reviews ? (
                <span className="flex items-center gap-1">
                  <span className="text-amber-400">★</span>
                  <span className="font-bold text-gray-900">{reviews.avg.toFixed(1)}</span>
                  <span className="text-xs text-gray-400">({reviews.count})</span>
                </span>
              ) : (
                <span className="text-xs text-gray-400">Nuovo</span>
              )}
            </div>
          </div>
        </div>

        {/* Indirizzo + orario */}
        <div className="text-xs text-gray-500 mb-3 flex flex-wrap gap-x-3 gap-y-1">
          {street && <span className="truncate">📍 {street}</span>}
          <span className={open ? 'text-emerald-600 font-semibold' : 'text-gray-500'}>
            🕒 {todayLabel}
          </span>
        </div>

        {/* Preview prodotti */}
        {showPreview && (
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {products.slice(0, 4).map((p) => (
              <div
                key={p.id}
                className="aspect-square rounded-lg overflow-hidden bg-gray-100 relative"
              >
                {p.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.images[0]}
                    alt={p.name}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">📦</div>
                )}
                <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-[10px] font-bold py-0.5 text-center backdrop-blur">
                  {formatPrice(p.price)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between gap-2">
          {minPrice !== null ? (
            <span className="text-xs text-gray-500 truncate min-w-0">
              Da <strong className="text-gray-900">{formatPrice(minPrice)}</strong>
            </span>
          ) : (
            <span />
          )}
          <span className="text-sm font-bold text-indigo-600 group-hover:translate-x-1 transition-transform whitespace-nowrap">
            Esplora →
          </span>
        </div>
      </div>
    </Link>
  );
};

export default StorePreviewCard;
