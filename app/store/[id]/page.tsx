'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import ProductGrid from '@/components/ProductGrid';
import StoreAvatar from '@/components/StoreAvatar';

type HoursInterval = [string, string];
type StoreHours = Partial<Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', HoursInterval[]>>;

const DAYS: { key: keyof StoreHours; label: string }[] = [
  { key: 'mon', label: 'Lunedì' },
  { key: 'tue', label: 'Martedì' },
  { key: 'wed', label: 'Mercoledì' },
  { key: 'thu', label: 'Giovedì' },
  { key: 'fri', label: 'Venerdì' },
  { key: 'sat', label: 'Sabato' },
  { key: 'sun', label: 'Domenica' },
];

// "Via Calzolai 12, Piacenza" -> "Via Calzolai 12"
function streetFromAddress(address?: string | null) {
  if (!address) return null;
  const street = address.split(',')[0]?.trim();
  return street && street.length > 0 ? street : null;
}

function formatIntervals(intervals?: HoursInterval[]) {
  if (!intervals || intervals.length === 0) return 'Chiuso';
  return intervals.map(([o, c]) => `${o} – ${c}`).join(' · ');
}

export default function StorePage({ params }: { params: { id: string } }) {
  const { id } = params;

  const { data: store, isLoading } = useQuery({
    queryKey: ['store', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, store_name, store_phone, store_address, store_lat, store_lng, is_approved, store_logo, store_hours')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <div className="container mx-auto p-8 text-center">Caricamento...</div>;
  if (!store?.store_name || !store.is_approved) {
    return <div className="container mx-auto p-8 text-center">Negozio non trovato.</div>;
  }

  const street = streetFromAddress(store.store_address);
  const mapsQuery = store.store_address
    ? encodeURIComponent(store.store_address)
    : store.store_lat && store.store_lng
      ? `${store.store_lat},${store.store_lng}`
      : null;

  const hours = (store.store_hours ?? {}) as StoreHours;
  const hasHours = DAYS.some((d) => Array.isArray(hours[d.key]));

  return (
    <div className="container mx-auto px-6 py-8 space-y-8">
      <header className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl p-8 flex flex-col sm:flex-row items-center sm:items-start gap-6">
        <StoreAvatar logoUrl={store.store_logo} storeName={store.store_name} size="xl" />
        <div className="text-center sm:text-left space-y-1">
          <h1 className="text-3xl font-bold">{store.store_name}</h1>
          <p className="text-indigo-100">📞 {store.store_phone}</p>
          {mapsQuery && (
            <a
              href={`https://www.google.com/maps?q=${mapsQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/90 hover:text-white text-sm underline inline-block"
            >
              📍 {street ?? store.store_address ?? 'Apri su Google Maps'}
            </a>
          )}
        </div>
      </header>

      {hasHours && (
        <section className="bg-white border rounded-xl p-6">
          <h2 className="text-xl font-bold mb-4">🕒 Orari di apertura</h2>
          <ul className="divide-y">
            {DAYS.map((d) => {
              const intervals = hours[d.key];
              const closed = !intervals || intervals.length === 0;
              return (
                <li key={d.key} className="flex justify-between py-2 text-sm">
                  <span className="font-medium text-gray-700">{d.label}</span>
                  <span className={closed ? 'text-gray-400' : 'text-gray-900'}>
                    {formatIntervals(intervals)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-2xl font-bold mb-4">Prodotti del negozio</h2>
        <ProductGrid sellerId={store.id} />
      </section>
    </div>
  );
}
