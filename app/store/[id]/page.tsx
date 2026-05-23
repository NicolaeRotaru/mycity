'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';
import StoreAvatar from '@/components/StoreAvatar';
import StoreMediaCarousel, { type StoreMediaItem } from '@/components/StoreMediaCarousel';
import { formatToday, isOpenNow, streetFromAddress, type StoreHours } from '@/lib/store-hours';

const DAYS: { key: keyof StoreHours; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

const DAY_KEYS: (keyof StoreHours)[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export default function StorePage({ params }: { params: { id: string } }) {
  const { id } = params;

  const { data: store, isLoading } = useQuery({
    queryKey: ['store', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_address, store_lat, store_lng, is_approved, store_logo, store_hours, store_media, store_description')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: reviews = [] } = useQuery({
    queryKey: ['store-reviews', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('store_reviews')
        .select('id, rating, comment, created_at')
        .eq('store_id', id)
        .order('created_at', { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const avgRating = reviews.length > 0
    ? reviews.reduce((s: number, r: any) => s + r.rating, 0) / reviews.length
    : 0;

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-gray-500">
        Caricamento...
      </div>
    );
  }
  if (!store?.store_name || !store.is_approved) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-gray-500">
        Negozio non trovato.
      </div>
    );
  }

  const street = streetFromAddress(store.store_address);
  const mapsQuery = store.store_address
    ? encodeURIComponent(store.store_address)
    : store.store_lat && store.store_lng
      ? `${store.store_lat},${store.store_lng}`
      : null;

  const hours = (store.store_hours ?? {}) as StoreHours;
  const todayKey = DAY_KEYS[new Date().getDay()];
  const todayIntervals = hours[todayKey] ?? [];
  const openNow = isOpenNow(todayIntervals);
  const todayLabel = formatToday(todayIntervals);
  const hasHours = DAYS.some((d) => Array.isArray(hours[d.key]));

  const media = (Array.isArray(store.store_media) ? store.store_media : []) as StoreMediaItem[];

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-6">
      {/* Hero card: COVER con media carousel + logo che NON viene tagliato */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <StoreMediaCarousel
          media={media}
          heightClass="h-48 sm:h-72"
          fallbackClass="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"
        />
        <div className="px-6 pb-6 -mt-12 sm:-mt-14 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <div className="ring-4 ring-white rounded-full bg-white inline-block shadow-lg">
              <StoreAvatar logoUrl={store.store_logo} storeName={store.store_name} size="xl" />
            </div>
            <div className="flex-1 sm:pb-2 min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate">
                  {store.store_name}
                </h1>
                {hasHours && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                      openNow
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        openNow ? 'bg-emerald-500' : 'bg-gray-400'
                      }`}
                    />
                    {openNow ? 'Aperto ora' : 'Chiuso ora'}
                  </span>
                )}
              </div>
              {street && (
                <p className="text-gray-500 text-sm mt-1.5">{street}</p>
              )}
              {store.store_description && (
                <p className="text-gray-700 text-sm mt-3 leading-relaxed">{store.store_description}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <a
          href={`tel:${store.store_phone}`}
          className="bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-lg">
              📞
            </div>
            <div className="min-w-0">
              <div className="text-xs text-gray-500 font-medium">Telefono</div>
              <div className="text-gray-900 font-medium truncate">{store.store_phone}</div>
            </div>
          </div>
        </a>

        {mapsQuery && (
          <a
            href={`https://www.google.com/maps?q=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center text-lg">
                📍
              </div>
              <div className="min-w-0">
                <div className="text-xs text-gray-500 font-medium">Indirizzo</div>
                <div className="text-gray-900 font-medium truncate">
                  {street ?? store.store_address ?? '—'}
                </div>
              </div>
            </div>
          </a>
        )}

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center text-lg">
              🕒
            </div>
            <div className="min-w-0">
              <div className="text-xs text-gray-500 font-medium">Oggi</div>
              <div className="text-gray-900 font-medium truncate">{todayLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Full hours */}
      {hasHours && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-lg text-gray-900 mb-4">Orari di apertura</h2>
          <ul className="divide-y divide-gray-100">
            {DAYS.map((d) => {
              const intervals = hours[d.key];
              const closed = !intervals || intervals.length === 0;
              const isToday = d.key === todayKey;
              return (
                <li
                  key={d.key}
                  className={`flex justify-between items-center py-2.5 text-sm ${
                    isToday ? 'font-semibold text-gray-900' : 'text-gray-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {d.label}
                    {isToday && (
                      <span className="text-[10px] uppercase tracking-wider bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                        Oggi
                      </span>
                    )}
                  </span>
                  <span className={closed ? 'text-gray-400' : ''}>
                    {closed ? 'Chiuso' : intervals.map(([o, c]) => `${o} – ${c}`).join(' · ')}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* RECENSIONI */}
      {reviews.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="font-semibold text-lg text-gray-900">⭐ Recensioni clienti</h2>
            <div className="flex items-center gap-1">
              <span className="text-amber-400 text-lg">
                {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
              </span>
              <span className="text-sm text-gray-600 font-medium">
                {avgRating.toFixed(1)} ({reviews.length})
              </span>
            </div>
          </div>
          <ul className="space-y-3">
            {reviews.slice(0, 5).map((r: any) => (
              <li key={r.id} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-400 text-sm">
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                  </span>
                  <span className="text-xs text-gray-400">
                    {new Date(r.created_at).toLocaleDateString('it-IT')}
                  </span>
                </div>
                {r.comment && <p className="text-sm text-gray-700">{r.comment}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Products */}
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4">
          Prodotti del negozio
        </h2>
        <ProductGrid sellerId={store.id} />
      </section>
    </div>
  );
}
