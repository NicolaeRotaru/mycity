'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { List, Map as MapIcon, MapPin, RadioTower } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import StoreListRow from '@/components/StoreListRow';
import NearbyStoresMapLazy, { type NearbyStore } from '@/components/NearbyStoresMapLazy';
import { type ProductPreview, type StoreCardData } from '@/components/StorePreviewCard';
import CollectionHeader from '@/components/CollectionHeader';
import { haversineKm } from '@/lib/geo';
import { queryKeys } from '@/lib/queries/keys';

type Store = StoreCardData & {
  store_phone: string | null;
  store_lat: number | null;
  store_lng: number | null;
};

type ProductLite = ProductPreview & { seller_id: string };

const fetchNearData = async () => {
  const { data: storesRaw } = await supabase
    .from('profiles')
    .select('id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours, store_media')
    .eq('is_approved', true)
    .not('store_name', 'is', null);

  const stores = (storesRaw ?? []) as Store[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) return { stores: [], productsByStore: {}, reviewsByStore: {} };

  const [productsRes, reviewsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, images, seller_id')
      .in('seller_id', storeIds)
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(400),
    supabase
      .from('store_reviews')
      .select('store_id, rating')
      .in('store_id', storeIds),
  ]);

  const productsByStore: Record<string, ProductLite[]> = {};
  for (const p of (productsRes.data ?? []) as ProductLite[]) {
    (productsByStore[p.seller_id] ??= []).push(p);
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of (reviewsRes.data ?? []) as { store_id: string; rating: number }[]) {
    const ex = reviewsByStore[r.store_id];
    if (ex) {
      ex.avg = (ex.avg * ex.count + r.rating) / (ex.count + 1);
      ex.count += 1;
    } else {
      reviewsByStore[r.store_id] = { avg: r.rating, count: 1 };
    }
  }

  return { stores, productsByStore, reviewsByStore };
};

export default function NearMePage() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [radiusKm, setRadiusKm] = useState(5);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPermError('Geolocalizzazione non supportata dal browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => setPermError('Impossibile ottenere la posizione: ' + err.message),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.stores.nearV2,
    queryFn: fetchNearData,
  });

  // Riferimento stabile (evita di ricalcolare i useMemo a ogni render quando data è undefined).
  const stores = useMemo<Store[]>(() => data?.stores ?? [], [data]);
  const productsByStore = data?.productsByStore ?? {};
  const reviewsByStore = data?.reviewsByStore ?? {};

  // Calcola distanza (se abbiamo la posizione) e ordina per vicinanza.
  const ranked = useMemo(
    () =>
      stores
        .map((s) => ({
          store: s,
          distance:
            pos && s.store_lat != null && s.store_lng != null
              ? haversineKm(pos.lat, pos.lng, Number(s.store_lat), Number(s.store_lng))
              : null,
        }))
        .sort((a, b) => {
          if (a.distance == null) return b.distance == null ? 0 : 1;
          if (b.distance == null) return -1;
          return a.distance - b.distance;
        }),
    [stores, pos],
  );

  // Con la posizione filtriamo per raggio; senza, mostriamo tutti i negozi.
  const filtered = useMemo(
    () => (pos ? ranked.filter((x) => x.distance != null && x.distance <= radiusKm) : ranked),
    [ranked, pos, radiusKm],
  );

  const mapStores: NearbyStore[] = useMemo(
    () =>
      filtered
        .filter((x) => x.store.store_lat != null && x.store.store_lng != null)
        .map((x) => ({
          id: x.store.id,
          name: x.store.store_name,
          lat: Number(x.store.store_lat),
          lng: Number(x.store.store_lng),
        })),
    [filtered],
  );

  // Attendi i dati e l'esito della geolocalizzazione (posizione o errore).
  if (isLoading || (!pos && !permError)) {
    return (
      <div className="container mx-auto p-8 text-center text-ink-500 flex items-center justify-center gap-2">
        <RadioTower size={18} strokeWidth={2.2} aria-hidden /> Calcolo distanze…
      </div>
    );
  }

  const toggleBtn = (target: 'list' | 'map', label: string, Icon: typeof List) => (
    <button
      type="button"
      onClick={() => setView(target)}
      aria-pressed={view === target}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
        view === target ? 'bg-primary-700 text-white shadow-warm-sm' : 'text-ink-600 hover:bg-cream-50'
      }`}
    >
      <Icon size={16} strokeWidth={2.2} aria-hidden /> {label}
    </button>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <CollectionHeader
        icon={MapPin}
        eyebrow="Negozi vicini"
        title="Vicino a te"
        blurb="I negozi della tua zona a Piacenza, con consegna locale rapida."
        breadcrumb={[{ label: 'Home', href: '/' }, { label: 'Vicino a te' }]}
      />

      <p className="mb-4 text-ink-500">
        {filtered.length} {filtered.length === 1 ? 'negozio' : 'negozi'}
        {pos ? ` entro ${radiusKm} km` : ' a Piacenza'}
      </p>

      {permError && (
        <div className="mb-4 flex gap-2 rounded-xl border border-accent-200 bg-accent-50 px-4 py-3 text-sm text-ink-700">
          <MapPin size={18} strokeWidth={2.2} className="mt-0.5 shrink-0 text-accent-500" aria-hidden />
          <span>{permError}. Mostriamo i negozi di Piacenza; abilita la geolocalizzazione per ordinarli per distanza e
          filtrare per raggio.</span>
        </div>
      )}

      {/* Controlli: toggle Lista/Mappa + slider raggio */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-xl border border-surface-200 bg-white p-1 shadow-card">
          {toggleBtn('list', 'Lista', List)}
          {toggleBtn('map', 'Mappa', MapIcon)}
        </div>

        {pos && (
          <label className="flex items-center gap-3 text-sm text-ink-600">
            <span className="whitespace-nowrap font-semibold">Raggio: {radiusKm} km</span>
            <input
              type="range"
              min={1}
              max={20}
              step={1}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="h-2 w-40 cursor-pointer accent-primary-600 sm:w-56"
              aria-label="Raggio di ricerca in km"
            />
          </label>
        )}
      </div>

      {view === 'map' ? (
        mapStores.length > 0 || pos ? (
          <NearbyStoresMapLazy userPos={pos} stores={mapStores} radiusKm={radiusKm} />
        ) : (
          <div className="rounded-2xl border border-surface-200 bg-cream-50 p-8 text-center text-ink-500">
            Nessun negozio con posizione da mostrare sulla mappa.
          </div>
        )
      ) : filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map(({ store, distance }) => (
            <StoreListRow
              key={store.id}
              store={store}
              products={productsByStore[store.id] ?? []}
              reviews={reviewsByStore[store.id]}
              distanceKm={distance}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-surface-200 bg-cream-50 p-8 text-center text-ink-500">
          Nessun negozio entro {radiusKm} km. Aumenta il raggio per vederne di più.
        </div>
      )}
    </div>
  );
}
