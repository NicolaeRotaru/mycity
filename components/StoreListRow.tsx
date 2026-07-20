'use client';

import Link from 'next/link';
import { Star, ChevronRight, Package } from 'lucide-react';
import StoreAvatar from './StoreAvatar';
import { VerifiedBadge } from './ui/VerifiedBadge';
import { isVerifiedStore } from '@/lib/store-trust';
import { sizedImage } from '@/lib/image-url';
import { DAY_KEYS, isOpenNow, streetFromAddress, type StoreHours } from '@/lib/store-hours';
import type { StoreCardData, ProductPreview } from './StorePreviewCard';

interface Props {
  store: StoreCardData;
  products?: ProductPreview[];
  reviews?: { avg: number; count: number };
  distanceKm?: number | null;
}

/**
 * Riga-lista negozio (modello B) per le pagine con tanti negozi (/stores, /near):
 * stessa identità della card vetrina, ma layout orizzontale compatto, così se ne
 * scorrono molti in poco spazio (stile Glovo/Deliveroo).
 */
const StoreListRow = ({ store, products = [], reviews, distanceKm }: Props) => {
  const hours = (store.store_hours ?? {}) as StoreHours;
  const open = isOpenNow(hours[DAY_KEYS[new Date().getDay()]]);
  const street = streetFromAddress(store.store_address);
  const thumbs = products.slice(0, 3);
  const href = `/store/${store.id}`;
  const km =
    distanceKm == null ? null : distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${distanceKm.toFixed(1)} km`;

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl border border-surface-200 bg-white p-3 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary-200 hover:shadow-warm sm:gap-4"
    >
      <div className="shrink-0">
        <StoreAvatar logoUrl={store.store_logo} storeName={store.store_name} size="lg" />
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="inline-flex items-center gap-1.5 truncate text-[15px] font-bold text-ink-900 group-hover:text-primary-700">
          <span className="truncate">{store.store_name}</span>
          {isVerifiedStore(store) && <VerifiedBadge size="sm" />}
        </h3>
        {street && <p className="truncate text-xs text-ink-400">{street}</p>}
        <div className="mt-1 flex items-center gap-3 text-xs">
          {reviews ? (
            <span className="inline-flex items-center gap-1 font-bold text-ink-800">
              <Star size={13} className="fill-accent-500 text-accent-500" aria-hidden />
              {reviews.avg.toFixed(1)}
              <span className="font-normal text-ink-400">({reviews.count})</span>
            </span>
          ) : (
            <span className="text-ink-400">Nuovo</span>
          )}
          <span className={`inline-flex items-center gap-1.5 font-semibold ${open ? 'text-olive-700' : 'text-ink-400'}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${open ? 'bg-olive-600' : 'bg-ink-300'}`} />
            {open ? 'Aperto' : 'Chiuso'}
          </span>
        </div>
      </div>

      {thumbs.length > 0 && (
        <div className="hidden shrink-0 gap-1.5 sm:flex">
          {thumbs.map((p) => (
            <div key={p.id} className="h-11 w-11 overflow-hidden rounded-lg bg-cream-100">
              {p.images?.[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sizedImage(p.images[0], 'thumb')}
                  alt={p.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-cream-400">
                  <Package size={16} strokeWidth={1.6} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {km && <span className="text-[13px] font-bold text-ink-900">{km}</span>}
        <span className="rounded-full bg-olive-100 px-2 py-0.5 text-[11px] font-bold text-olive-700">consegna oggi</span>
        <ChevronRight size={16} className="text-ink-300" aria-hidden />
      </div>
    </Link>
  );
};

export default StoreListRow;
