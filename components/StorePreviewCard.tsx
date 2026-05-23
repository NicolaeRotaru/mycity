'use client';

import Link from 'next/link';
import StoreAvatar from './StoreAvatar';
import StoreMediaCarousel, { type StoreMediaItem } from './StoreMediaCarousel';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
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
  /** se true mostra solo elementi essenziali */
  compact?: boolean;
}

const StarsRow = ({ avg, count }: { avg: number; count: number }) => {
  const filled = Math.round(avg);
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="text-amber-400 tracking-tight">
        {'★'.repeat(filled)}
        <span className="text-gray-300">{'★'.repeat(5 - filled)}</span>
      </span>
      <span className="font-bold text-gray-900">{avg.toFixed(1)}</span>
      <span className="text-xs text-gray-400">({count})</span>
    </div>
  );
};

const StarsEmpty = () => (
  <div className="flex items-center gap-1.5 text-sm">
    <span className="text-gray-300 tracking-tight">☆☆☆☆☆</span>
    <span className="text-xs text-gray-400">Nessuna recensione</span>
  </div>
);

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
  const media = Array.isArray(store.store_media) ? store.store_media : [];

  return (
    <Link
      href={`/store/${store.id}`}
      className="group bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-xl hover:border-indigo-300 hover:-translate-y-0.5 transition-all flex flex-col"
    >
      {/* Cover con media + logo posizionato DENTRO la cover (sovrapposto) */}
      <div className="relative">
        <StoreMediaCarousel
          media={media}
          heightClass={compact ? 'h-32' : 'h-36 sm:h-44'}
          fallbackClass="bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500"
        />

        {/* Overlay scuro graduale in basso per dare contrasto al logo */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />

        {/* Logo: fully visible IN CIMA al cover, in basso a sinistra */}
        <div className="absolute bottom-2 left-3 z-20 ring-4 ring-white rounded-full bg-white shadow-lg">
          <StoreAvatar
            logoUrl={store.store_logo}
            storeName={store.store_name}
            size={compact ? 'md' : 'lg'}
          />
        </div>

        {/* Badge aperto/chiuso */}
        <span
          className={`absolute top-2 right-2 sm:top-3 sm:right-3 z-20 inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold shadow ${
            open ? 'bg-emerald-500 text-white' : 'bg-black/60 text-white'
          }`}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          {open ? 'Aperto' : 'Chiuso'}
        </span>

        {reviews && reviews.avg >= 4.5 && (
          <span className="absolute top-2 left-2 sm:top-3 sm:left-3 z-20 inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold bg-amber-400 text-gray-900 shadow">
            🏆 Top
          </span>
        )}
        {distanceKm !== undefined && distanceKm !== null && (
          <span className="absolute bottom-2 right-2 sm:bottom-3 sm:right-3 z-20 inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-bold bg-white/95 text-gray-900 shadow">
            📍 {distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`}
          </span>
        )}
      </div>

      <div className="px-4 sm:px-5 pt-3 pb-4 sm:pb-5 flex-1 flex flex-col">
        {/* Nome + rating sempre visibile */}
        <div className="mb-2">
          <h3 className="font-extrabold text-base sm:text-lg text-gray-900 group-hover:text-indigo-600 transition-colors truncate">
            {store.store_name}
          </h3>
          {reviews ? <StarsRow avg={reviews.avg} count={reviews.count} /> : <StarsEmpty />}
        </div>

        {/* Indirizzo + orario */}
        <div className="text-xs text-gray-500 mb-3 flex flex-wrap gap-x-3 gap-y-1">
          {street && <span className="truncate">📍 {street}</span>}
          <span className={open ? 'text-emerald-600 font-semibold' : 'text-gray-500'}>
            🕒 {todayLabel}
          </span>
        </div>

        {/* Preview prodotti — nome + prezzo */}
        {showPreview && (
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {products.slice(0, 4).map((p) => (
              <div key={p.id} className="min-w-0">
                <div className="aspect-square rounded-lg overflow-hidden bg-gray-100 mb-1">
                  {p.images?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={sizedImage(p.images[0], 'thumb')}
                      alt={p.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300 text-xl">📦</div>
                  )}
                </div>
                <p
                  className="text-[10px] leading-tight text-gray-700 line-clamp-2 min-h-[2.2em]"
                  title={p.name}
                >
                  {p.name}
                </p>
                <p className="text-[11px] font-bold text-gray-900 leading-none mt-0.5">
                  {formatPrice(p.price)}
                </p>
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
