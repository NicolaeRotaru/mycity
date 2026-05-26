'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';
import StoreAvatar from '@/components/StoreAvatar';
import StoreMediaCarousel, { type StoreMediaItem } from '@/components/StoreMediaCarousel';
import { formatToday, isOpenNow, streetFromAddress, type StoreHours } from '@/lib/store-hours';
import { LoadingState } from '@/components/ui/LoadingState';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { VerifiedBadge } from '@/components/ui/VerifiedBadge';

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
      <div className="container mx-auto px-4 py-16">
        <LoadingState />
      </div>
    );
  }
  if (!store?.store_name || !store.is_approved) {
    return (
      <div className="container mx-auto px-4 py-16 text-center text-ink-500">
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

  // Schema.org LocalBusiness JSON-LD — critical per SEO local
  // Esperti: SEO Specialist: "Senza Schema LocalBusiness sei invisibile su
  // Google local pack e Maps. Ogni store page deve averlo."
  const localBusinessSchema = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: store.store_name,
    description: store.store_description ?? undefined,
    image: store.store_logo ?? undefined,
    telephone: store.store_phone ?? undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: store.store_address ?? undefined,
      addressLocality: 'Piacenza',
      addressRegion: 'PC',
      addressCountry: 'IT',
    },
    geo: (store.store_lat && store.store_lng) ? {
      '@type': 'GeoCoordinates',
      latitude: store.store_lat,
      longitude: store.store_lng,
    } : undefined,
    aggregateRating: reviews.length > 0 ? {
      '@type': 'AggregateRating',
      ratingValue: (reviews.reduce((s: number, r: any) => s + Number(r.rating), 0) / reviews.length).toFixed(1),
      reviewCount: reviews.length,
    } : undefined,
    url: typeof window !== 'undefined' ? window.location.href : undefined,
  };

  return (
    <div className="container mx-auto px-4 py-6 max-w-5xl space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
      />
      <Breadcrumb items={[
        { label: 'Home', href: '/' },
        { label: 'Negozi', href: '/stores' },
        { label: store.store_name },
      ]} />
      {/* Hero card: COVER con media + logo DENTRO la cover (fully visible) */}
      <div className="bg-white border border-cream-300 rounded-2xl overflow-hidden shadow-sm">
        <div className="relative">
          <StoreMediaCarousel
            media={media}
            heightClass="h-48 sm:h-72"
            fallbackClass="bg-gradient-to-r from-primary-500 via-purple-500 to-pink-500"
          />
          {/* Overlay scuro per contrasto logo + nome */}
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
          {/* Logo posizionato in basso a sinistra, dentro la cover */}
          <div className="absolute bottom-4 left-4 z-20 ring-4 ring-white rounded-full bg-white shadow-2xl">
            <StoreAvatar logoUrl={store.store_logo} storeName={store.store_name} size="xl" />
          </div>
          {/* Badge stato in alto a destra */}
          {hasHours && (
            <span
              className={`absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold shadow ${
                openNow ? 'bg-olive-500 text-white' : 'bg-black/60 text-white'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              {openNow ? 'Aperto ora' : 'Chiuso ora'}
            </span>
          )}
        </div>

        {/* Info principali sotto la cover */}
        <div className="px-6 py-5">
          <h1 className="text-2xl sm:text-3xl font-bold text-ink-900 flex items-center gap-2 flex-wrap">
            <span className="truncate">{store.store_name}</span>
            {store.is_approved && <VerifiedBadge size="md" showLabel />}
          </h1>
          {street && <p className="text-ink-500 text-sm mt-1">{street}</p>}
          {store.store_description && (
            <p className="text-ink-700 text-sm mt-3 leading-relaxed">{store.store_description}</p>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <a
          href={`tel:${store.store_phone}`}
          className="bg-white border border-cream-300 rounded-xl p-4 hover:border-primary-300 hover:shadow-sm transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center text-lg">
              📞
            </div>
            <div className="min-w-0">
              <div className="text-xs text-ink-500 font-medium">Telefono</div>
              <div className="text-ink-900 font-medium truncate">{store.store_phone}</div>
            </div>
          </div>
        </a>

        {mapsQuery && (
          <a
            href={`https://www.google.com/maps?q=${mapsQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white border border-cream-300 rounded-xl p-4 hover:border-primary-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center text-lg">
                📍
              </div>
              <div className="min-w-0">
                <div className="text-xs text-ink-500 font-medium">Indirizzo</div>
                <div className="text-ink-900 font-medium truncate">
                  {street ?? store.store_address ?? '—'}
                </div>
              </div>
            </div>
          </a>
        )}

        <div className="bg-white border border-cream-300 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-50 text-accent-600 flex items-center justify-center text-lg">
              🕒
            </div>
            <div className="min-w-0">
              <div className="text-xs text-ink-500 font-medium">Oggi</div>
              <div className="text-ink-900 font-medium truncate">{todayLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Full hours */}
      {hasHours && (
        <div className="bg-white border border-cream-300 rounded-xl p-6">
          <h2 className="font-semibold text-lg text-ink-900 mb-4">Orari di apertura</h2>
          <ul className="divide-y divide-cream-100">
            {DAYS.map((d) => {
              const intervals = hours[d.key];
              const closed = !intervals || intervals.length === 0;
              const isToday = d.key === todayKey;
              return (
                <li
                  key={d.key}
                  className={`flex justify-between items-center py-2.5 text-sm ${
                    isToday ? 'font-semibold text-ink-900' : 'text-ink-700'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {d.label}
                    {isToday && (
                      <span className="text-[10px] uppercase tracking-wider bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded">
                        Oggi
                      </span>
                    )}
                  </span>
                  <span className={closed ? 'text-ink-400' : ''}>
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
        <div className="bg-white border border-cream-300 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="font-semibold text-lg text-ink-900">⭐ Recensioni clienti</h2>
            <div className="flex items-center gap-1">
              <span className="text-accent-400 text-lg">
                {'★'.repeat(Math.round(avgRating))}{'☆'.repeat(5 - Math.round(avgRating))}
              </span>
              <span className="text-sm text-ink-600 font-medium">
                {avgRating.toFixed(1)} ({reviews.length})
              </span>
            </div>
          </div>
          <ul className="space-y-3">
            {reviews.slice(0, 5).map((r: any) => (
              <li key={r.id} className="border-b border-cream-200 last:border-0 pb-3 last:pb-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-accent-400 text-sm">
                    {'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}
                  </span>
                  <span className="text-xs text-ink-400">
                    {new Date(r.created_at).toLocaleDateString('it-IT')}
                  </span>
                </div>
                {r.comment && <p className="text-sm text-ink-700">{r.comment}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Products */}
      <section>
        <h2 className="text-xl sm:text-2xl font-bold text-ink-900 mb-4">
          Prodotti del negozio
        </h2>
        <ProductGrid sellerId={store.id} />
      </section>
    </div>
  );
}
