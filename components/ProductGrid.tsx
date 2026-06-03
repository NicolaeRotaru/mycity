'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowRight, SearchX } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from './ProductCard';
import { queryKeys } from '@/lib/queries/keys';
import SkeletonCard, { SkeletonGrid } from './SkeletonCard';
import { DAY_KEYS, isOpenNow, type StoreHours } from '@/lib/store-hours';
import { trackSearchPerformed } from '@/lib/analytics/events';

export type SortOption = 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'rating';

interface Props {
  categoryId?: string;
  /** Più categorie (es. categoria padre + sottocategorie): usa IN al posto di EQ. */
  categoryIds?: string[];
  sellerId?: string;
  search?: string;
  limit?: number;
  maxPrice?: number;
  minPrice?: number;
  onlyOpenStores?: boolean;
  minRating?: number;
  sort?: SortOption;
  /** Layout "rail" orizzontale scrollabile (per le righe curate della home). */
  rail?: boolean;
  /** Modalità "sezione" (solo con `rail`): mostra un'intestazione "titolo + Vedi tutto"
   *  sopra la rail e si auto-nasconde quando non ci sono prodotti. Usata nelle pagine
   *  categoria-hub, una rail per sottocategoria. */
  title?: string;
  titleHref?: string;
  seeAllHref?: string;
}

const ProductGrid = ({ categoryId, categoryIds, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores, minRating, sort = 'relevance', rail, title, titleHref, seeAllHref }: Props) => {
  const { data: products = [], isLoading } = useQuery({
    queryKey: queryKeys.products.grid({ categoryId, categoryIds, sellerId, search, limit, maxPrice, minPrice, onlyOpenStores, minRating, sort }),
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select(`
          id, name, description, price, images, stock, created_at, seller_id, category_id,
          profiles!products_seller_id_fkey!inner ( store_name, store_hours, is_approved )
        `)
        .eq('status', 'available')
        .eq('profiles.is_approved', true);

      // Ordinamento dinamico (default: created_at desc)
      switch (sort) {
        case 'price_asc':  q = q.order('price', { ascending: true }); break;
        case 'price_desc': q = q.order('price', { ascending: false }); break;
        case 'newest':     q = q.order('created_at', { ascending: false }); break;
        default:           q = q.order('created_at', { ascending: false });
      }

      if (categoryIds && categoryIds.length > 0) q = q.in('category_id', categoryIds);
      else if (categoryId) q = q.eq('category_id', categoryId);
      if (sellerId)   q = q.eq('seller_id', sellerId);
      if (search) {
        const safe = search.replace(/[%_]/g, '\\$&').slice(0, 100);
        q = q.ilike('name', `%${safe}%`);
      }
      if (maxPrice !== undefined) q = q.lte('price', maxPrice);
      if (minPrice !== undefined) q = q.gte('price', minPrice);
      if (limit)      q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  // Carica rating aggregato per i prodotti visibili (per filtro/ordinamento per rating)
  type Prod = {
    id: string; name: string; description: string | null; price: string | number;
    images: string[] | null; stock: number | null; created_at: string;
    seller_id: string | null; category_id: string | null;
    profiles?: { store_name: string | null; is_approved?: boolean; store_hours?: unknown } | null;
  };
  const prods = products as unknown as Prod[];
  type RatingMap = Record<string, { avg: number; count: number }>;
  const { data: ratings = {} as RatingMap } = useQuery<RatingMap>({
    queryKey: queryKeys.products.ratings(prods.map((p) => p.id).sort().join(',')),
    enabled: (minRating !== undefined && minRating > 0) || sort === 'rating',
    queryFn: async (): Promise<RatingMap> => {
      if (prods.length === 0) return {};
      const ids = prods.map((p) => p.id);
      // Aggregazione media/conteggio lato DB (RPC 052) invece di scaricare ogni
      // recensione e mediare in loop nel browser.
      const { data } = await supabase.rpc('product_rating_stats', { p_product_ids: ids });
      const map: RatingMap = {};
      type StatRow = { product_id: string; avg: number | string; count: number };
      for (const r of (data ?? []) as StatRow[]) {
        map[r.product_id] = { avg: Number(r.avg), count: Number(r.count) };
      }
      return map;
    },
  });

  // Sconti promo del negozio: calcolati solo in vetrina (quando filtriamo per sellerId).
  type PromoRow = { discount_percent: number; scope: string; category_id: string | null; product_ids: string[] | null };
  const { data: promos = [] } = useQuery<PromoRow[]>({
    queryKey: queryKeys.promotions.byStore(sellerId ?? ''),
    enabled: !!sellerId,
    queryFn: async (): Promise<PromoRow[]> => {
      const nowIso = new Date().toISOString();
      const { data } = await supabase
        .from('seller_promotions')
        .select('discount_percent, scope, category_id, product_ids')
        .eq('seller_id', sellerId!)
        .eq('status', 'active')
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso);
      return (data ?? []) as PromoRow[];
    },
    staleTime: 60_000,
  });

  const discountFor = (p: Prod): number => {
    if (!sellerId || promos.length === 0) return 0;
    let best = 0;
    for (const promo of promos) {
      const applies =
        promo.scope === 'store' ||
        (promo.scope === 'category' && promo.category_id === p.category_id) ||
        (promo.scope === 'products' && Array.isArray(promo.product_ids) && promo.product_ids.includes(p.id));
      if (applies && promo.discount_percent > best) best = promo.discount_percent;
    }
    return best;
  };

  // Filtro client-side: orari aperti, rating minimo, ordinamento per rating
  const filtered = useMemo(() => {
    let arr = prods;
    if (onlyOpenStores) {
      const todayKey = DAY_KEYS[new Date().getDay()];
      arr = arr.filter((p) => {
        const hours = (p.profiles?.store_hours ?? {}) as StoreHours;
        return isOpenNow(hours[todayKey]);
      });
    }
    if (minRating !== undefined && minRating > 0) {
      arr = arr.filter((p) => (ratings[p.id]?.avg ?? 0) >= minRating);
    }
    if (sort === 'rating') {
      arr = [...arr].sort((a, b) => {
        const ra = ratings[a.id]?.avg ?? 0;
        const rb = ratings[b.id]?.avg ?? 0;
        return rb - ra;
      });
    }
    return arr;
  }, [prods, onlyOpenStores, minRating, ratings, sort]);

  // Funnel: emette `search_performed` (PostHog + GA4) quando una ricerca
  // testuale si risolve. Solo in contesto ricerca (prop `search` valorizzata),
  // una volta per termine (no inflation da refetch/re-render).
  const lastTrackedSearch = useRef<string | null>(null);
  useEffect(() => {
    const term = search?.trim();
    if (!term || isLoading) return;
    if (lastTrackedSearch.current === term) return;
    lastTrackedSearch.current = term;
    trackSearchPerformed(term, prods.length);
  }, [search, isLoading, prods.length]);

  // Sezione = rail con intestazione: si comporta come un blocco autonomo
  // (titolo + "Vedi tutto") e scompare del tutto quando è vuota.
  const isSection = !!rail && !!title;
  const sectionHeader = title ? (
    <div className="mb-4 flex items-end justify-between gap-4">
      {titleHref ? (
        <Link href={titleHref} className="group min-w-0">
          <h2 className="truncate font-serif text-xl font-bold text-ink-900 transition-colors group-hover:text-primary-700 md:text-2xl">
            {title}
          </h2>
        </Link>
      ) : (
        <h2 className="truncate font-serif text-xl font-bold text-ink-900 md:text-2xl">{title}</h2>
      )}
      {seeAllHref && (
        <Link
          href={seeAllHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary-700 hover:text-primary-800"
        >
          Vedi tutto <ArrowRight size={16} strokeWidth={2.4} aria-hidden />
        </Link>
      )}
    </div>
  ) : null;

  if (isLoading) {
    // Sezione: intestazione + rail di skeleton, così la forma non cambia al load.
    if (isSection) {
      return (
        <section>
          {sectionHeader}
          <div className="-mx-4 flex gap-3 overflow-hidden px-4 pb-2 sm:-mx-6 sm:px-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="w-40 shrink-0 sm:w-44">
                <SkeletonCard />
              </div>
            ))}
          </div>
        </section>
      );
    }
    return <SkeletonGrid count={limit ?? 8} />;
  }

  if (filtered.length === 0) {
    // Le sezioni per-sottocategoria spariscono quando non hanno prodotti.
    if (isSection) return null;
    return (
      <div className="text-center py-16 bg-white border border-cream-300 rounded-xl">
        <SearchX size={48} strokeWidth={1.5} className="mx-auto text-ink-300 mb-3" />
        <p className="text-ink-700 font-semibold mb-1">Nessun prodotto trovato</p>
        <p className="text-sm text-ink-400">Prova a modificare i filtri o cerca qualcos&apos;altro</p>
      </div>
    );
  }

  const renderCard = (p: Prod, i: number) => (
    <ProductCard
      id={p.id}
      name={p.name}
      description={p.description ?? ''}
      price={Number(p.price)}
      images={Array.isArray(p.images) ? p.images : []}
      stock={p.stock ?? undefined}
      createdAt={p.created_at}
      storeName={p.profiles?.store_name ?? undefined}
      sellerId={p.seller_id ?? undefined}
      discountPercent={discountFor(p)}
      priority={i < 4}
    />
  );

  // Rail: riga orizzontale scrollabile (home + sezioni categoria). Bleed ai bordi.
  if (rail) {
    const railRow = (
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scrollbar-hide px-4 pb-2 sm:-mx-6 sm:px-6">
        {filtered.map((p, i) => (
          <div key={p.id} className="w-40 shrink-0 snap-start sm:w-44">
            {renderCard(p, i)}
          </div>
        ))}
      </div>
    );
    if (!isSection) return railRow;
    return (
      <section>
        {sectionHeader}
        {railRow}
      </section>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {filtered.map((p, i) => (
        <div key={p.id}>{renderCard(p, i)}</div>
      ))}
    </div>
  );
};

export default ProductGrid;
