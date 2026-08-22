'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import StorePreviewCard, { type ProductPreview, type StoreCardData } from '@/components/StorePreviewCard';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';
import { LoadingState } from '@/components/ui/LoadingState';
import { ErrorState } from '@/components/ui/ErrorState';
import { queryKeys } from '@/lib/queries/keys';
import { leggiInBlocchi } from '@/lib/supabase/blocchi';
import { conRipiegoSchema, senzaColonne, stessaFormaDi, COLONNE_124_VISTA } from '@/lib/db/migrazione-124';

type Store = StoreCardData & {
  store_phone: string | null;
  store_lat: number | null;
  store_lng: number | null;
};

type ProductLite = ProductPreview & { seller_id: string; category_id: string | null };

type Category = { id: string; slug: string; name: string; parent_id: string | null; icon: string | null };

type SortMode = 'rating' | 'name' | 'most-products';

const fetchStoresData = async () => {
  // 22/8/2026 — vedi near/page: senza ripiego, su un database indietro di una
  // migrazione l'elenco dei negozi esce vuoto invece che senza due bandierine.
  const SELECT_STORES =
    'id, store_name, store_phone, store_address, store_lat, store_lng, store_logo, store_hours, store_media, is_approved, stripe_charges_enabled, stripe_payouts_enabled';
  const conBandierine = () =>
    supabase.from('seller_public_profiles').select(SELECT_STORES).order('store_name');
  const { data: storesRaw, error } = await conRipiegoSchema(
    'stores/page:seller_public_profiles',
    conBandierine,
    () =>
      stessaFormaDi<Awaited<ReturnType<typeof conBandierine>>>(
        supabase
          .from('seller_public_profiles')
          .select(senzaColonne(SELECT_STORES, COLONNE_124_VISTA))
          .order('store_name'),
      ),
  );
  if (error) throw error;

  const stores = (storesRaw ?? []) as Store[];
  const storeIds = stores.map((s) => s.id);
  if (storeIds.length === 0) {
    return { stores: [], productsByStore: {}, reviewsByStore: {}, countByStore: {}, categoriesByStore: {}, categories: [] };
  }

  /**
   * 22/8/2026 — IL RIPIEGO GIRAVA SEMPRE, ANCHE QUANDO NON SERVIVA.
   *
   * Qui si scaricavano fino a seicento prodotti interi — nome, prezzo,
   * immagini — e poi, poche righe più sotto, si chiamava `store_cards`, che
   * dà la stessa cosa fatta meglio. Quando la seconda rispondeva, la prima
   * veniva buttata via: il download c'era stato lo stesso, su ogni visita di
   * ogni persona.
   *
   * Adesso si chiede prima quella buona. Il ripiego resta scritto — serve il
   * giorno in cui la migrazione 122 non è applicata su un ambiente — ma gira
   * solo quando serve davvero.
   */
  const [schedeRes, reviewsRes, categoriesRes, categoriePerNegozioRes] = await Promise.all([
    supabase.rpc('store_cards', { p_per_store: 4, p_limit: 500 }),
    supabase.rpc('store_review_stats', { p_store_ids: storeIds }),
    supabase
      .from('categories')
      .select('id, slug, name, parent_id, icon')
      .is('parent_id', null)
      .order('name'),
    // Le categorie di ogni negozio le dice il database. Prima si deducevano
    // dal mucchio di prodotti scaricati, e siccome quel mucchio era capato a
    // seicento IN TUTTO, i negozi che non pubblicavano da un po' sparivano dal
    // filtro pur avendo il catalogo pieno.
    supabase.rpc('categorie_per_negozio'),
  ]);

  const schede = (schedeRes.data ?? []) as Array<{
    seller_id: string;
    prodotti: ProductLite[];
    totale: number;
  }>;

  // Il ripiego: solo se la funzione non ha risposto.
  const productsRes =
    schede.length > 0
      ? { data: [] as ProductLite[], error: null }
      : await leggiInBlocchi<ProductLite>(storeIds, (blocco) =>
          supabase
            .from('products')
            .select('id, name, price, images, seller_id, category_id')
            .in('seller_id', blocco)
            .eq('status', 'available')
            .order('created_at', { ascending: false })
            .limit(600) as unknown as PromiseLike<{ data: ProductLite[] | null; error: { message?: string } | null }>,
        );

  // #89 — Il conteggio vero, negozio per negozio.
  //
  // Prima si scaricavano al massimo 600 prodotti IN TUTTO, ordinati dal piu'
  // recente, e da quel mucchio si contava quanti ne aveva ciascun negozio.
  // Effetto: i negozi che non avevano pubblicato di recente comparivano in
  // vetrina con «0 prodotti» pur avendone il catalogo pieno. Il negoziante
  // apre la sua pagina, si vede a zero, e pensa che il sito sia rotto — o che
  // sia stato messo da parte.
  //
  // `store_cards` (migrazione 122) prende i primi quattro prodotti DI OGNI
  // negozio piu' il conteggio vero. Se non e' ancora applicata, si continua col
  // giro di prima: meno preciso, ma niente si rompe.
  const contiVeri = new Map<string, number>();
  const prodottiPerNegozio = new Map<string, ProductLite[]>();
  for (const riga of schede) {
    contiVeri.set(riga.seller_id, riga.totale);
    prodottiPerNegozio.set(riga.seller_id, riga.prodotti ?? []);
  }

  const products = (productsRes.data ?? []) as ProductLite[];
  const reviewRows = (reviewsRes.data ?? []) as { store_id: string; avg: number | string; count: number }[];
  const categories = (categoriesRes.data ?? []) as Category[];

  const productsByStore: Record<string, ProductLite[]> = {};
  const countByStore: Record<string, number> = {};
  const categoriesByStore: Record<string, Set<string>> = {};
  // Le categorie arrivano dal database, complete: non più dedotte da un
  // campione di prodotti che tagliava fuori chi non pubblicava da un po'.
  for (const riga of (categoriePerNegozioRes.data ?? []) as Array<{
    seller_id: string;
    categorie: string[] | null;
  }>) {
    if (riga.categorie?.length) categoriesByStore[riga.seller_id] = new Set(riga.categorie);
  }
  for (const p of products) {
    (productsByStore[p.seller_id] ??= []).push(p);
    countByStore[p.seller_id] = (countByStore[p.seller_id] ?? 0) + 1;
    if (p.category_id) {
      (categoriesByStore[p.seller_id] ??= new Set()).add(p.category_id);
    }
  }
  // Dove la funzione ha risposto, il suo conteggio vince: e' quello vero.
  for (const [sellerId, totale] of contiVeri) {
    countByStore[sellerId] = totale;
    const prodotti = prodottiPerNegozio.get(sellerId);
    if (prodotti && prodotti.length > 0 && (productsByStore[sellerId]?.length ?? 0) === 0) {
      productsByStore[sellerId] = prodotti;
      for (const p of prodotti) {
        if (p.category_id) (categoriesByStore[sellerId] ??= new Set()).add(p.category_id);
      }
    }
  }

  const reviewsByStore: Record<string, { avg: number; count: number }> = {};
  for (const r of reviewRows) {
    reviewsByStore[r.store_id] = { avg: Number(r.avg), count: Number(r.count) };
  }

  return { stores, productsByStore, reviewsByStore, countByStore, categoriesByStore, categories };
};

export default function StoresPage() {
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [sort, setSort] = useState<SortMode>('rating');
  const [categoryId, setCategoryId] = useState<string>('');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.stores.page,
    queryFn: fetchStoresData,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });

  // useMemo per stabilizzare reference: fallback `?? []` / `?? {}` produce
  // un nuovo oggetto ad ogni render senza memo, che fa schizzare le deps
  // dei useMemo dipendenti (lint warning react-hooks/exhaustive-deps).
  const stores = useMemo(() => data?.stores ?? [], [data?.stores]);
  const productsByStore = useMemo(() => data?.productsByStore ?? {}, [data?.productsByStore]);
  const reviewsByStore = useMemo(() => data?.reviewsByStore ?? {}, [data?.reviewsByStore]);
  const countByStore = useMemo(() => data?.countByStore ?? {}, [data?.countByStore]);
  const categoriesByStore = useMemo(() => data?.categoriesByStore ?? {}, [data?.categoriesByStore]);
  const categories = data?.categories ?? [];

  const filtered = useMemo(() => {
    const todayKey = DAY_KEYS[new Date().getDay()];
    let result = stores.filter((s) => {
      if (search && !s.store_name?.toLowerCase().includes(search.toLowerCase())) return false;
      if (onlyOpen) {
        const hours = (s.store_hours ?? {}) as StoreHours;
        if (!isOpenNow(hours[todayKey])) return false;
      }
      if (categoryId) {
        const cats = categoriesByStore[s.id];
        if (!cats || !cats.has(categoryId)) return false;
      }
      return true;
    });

    if (sort === 'name') {
      result = [...result].sort((a, b) => (a.store_name ?? '').localeCompare(b.store_name ?? ''));
    } else if (sort === 'rating') {
      result = [...result].sort((a, b) => {
        const ra = reviewsByStore[a.id]?.avg ?? 0;
        const rb = reviewsByStore[b.id]?.avg ?? 0;
        if (rb !== ra) return rb - ra;
        return (countByStore[b.id] ?? 0) - (countByStore[a.id] ?? 0);
      });
    } else if (sort === 'most-products') {
      result = [...result].sort((a, b) => (countByStore[b.id] ?? 0) - (countByStore[a.id] ?? 0));
    }
    return result;
  }, [stores, search, onlyOpen, sort, categoryId, reviewsByStore, countByStore, categoriesByStore]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        <ErrorState
          title="Impossibile caricare i negozi"
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-ink-900">
          Negozi di Piacenza
        </h1>
        <p className="text-ink-500 mt-1">
          {stores.length} negozi locali pronti a consegnarti a casa
        </p>
      </div>

      {/* Filtri */}
      <div className="bg-white border border-cream-300 rounded-xl p-3 mb-6 shadow-sm space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome negozio…"
            className="flex-1 min-w-[160px] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-700"
          />
          <button
            onClick={() => setOnlyOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
              onlyOpen ? 'bg-olive-500 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${onlyOpen ? 'bg-white' : 'bg-olive-500'}`} aria-hidden />
            Aperti ora
          </button>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="border rounded-lg px-3 py-2 text-sm bg-white font-semibold"
          >
            <option value="rating">Più amati</option>
            <option value="most-products">Più assortiti</option>
            <option value="name">A-Z</option>
          </select>
        </div>
        {categories.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setCategoryId('')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                categoryId === '' ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
              }`}
            >
              Tutti i settori
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setCategoryId(c.id === categoryId ? '' : c.id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  c.id === categoryId ? 'bg-primary-700 text-white' : 'bg-cream-100 text-ink-700 hover:bg-cream-200'
                }`}
              >
                {c.icon} {c.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-ink-500 bg-white border rounded-xl">
          <Search size={48} strokeWidth={1.5} className="mx-auto mb-3 text-ink-300" aria-hidden />
          <p className="font-semibold">Nessun negozio trovato con questi filtri.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((s) => (
            <StorePreviewCard
              key={s.id}
              store={s}
              products={productsByStore[s.id] ?? []}
              reviews={reviewsByStore[s.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
