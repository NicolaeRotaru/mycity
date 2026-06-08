'use client';

import { Phone, MapPin } from 'lucide-react';
import { streetFromAddress } from '@/lib/store-hours';
import type { SectionContext } from './SectionContext';

/** Contatti: telefono (tel:) e indirizzo (Google Maps). */
export default function ContactSection({ ctx }: { ctx: SectionContext }) {
  const { store } = ctx;
  const street = streetFromAddress(store.store_address);
  const mapsQuery = store.store_address
    ? encodeURIComponent(store.store_address)
    : store.store_lat && store.store_lng
      ? `${store.store_lat},${store.store_lng}`
      : null;

  if (!store.store_phone && !mapsQuery) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {store.store_phone && (
        <a
          href={`tel:${store.store_phone}`}
          className="bg-white border border-cream-300 rounded-2xl p-3 hover:border-primary-300 hover:shadow-warm transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">
              <Phone size={18} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-ink-500 font-medium">Telefono</div>
              <div className="text-ink-900 font-medium truncate">{store.store_phone}</div>
            </div>
          </div>
        </a>
      )}

      {mapsQuery && (
        <a
          href={`https://www.google.com/maps?q=${mapsQuery}`}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-white border border-cream-300 rounded-2xl p-3 hover:border-primary-300 hover:shadow-warm transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <MapPin size={18} aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-ink-500 font-medium">Indirizzo</div>
              <div className="text-ink-900 font-medium truncate">{street ?? store.store_address ?? '—'}</div>
            </div>
          </div>
        </a>
      )}
    </div>
  );
}
