'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { TrendingUp, ArrowRight, Flame } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';

type Trending = {
  product_id: string;
  view_count: number;
  product: {
    id: string;
    name: string;
    price: number;
    images: string[] | null;
    profiles: { store_name: string | null; is_approved: boolean } | null;
  };
};

/**
 * "Trending ora": top 8 prodotti più visualizzati nelle ultime 24h.
 * Aggrega `product_views` (vedi migration 027), in fallback mostra
 * gli ultimi prodotti pubblicati se non ci sono ancora views.
 */
export default function TrendingNow() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.home.trendingNow,
    queryFn: async (): Promise<Trending[]> => {
      // Top prodotti per views nelle ultime 24h: aggregazione lato DB (RPC 052)
      // invece di scaricare fino a 500 righe di product_views e contare nel browser.
      const { data: trending } = await supabase.rpc('trending_product_ids_24h', { p_limit: 8 });
      const rows = (trending ?? []) as { product_id: string; view_count: number | string }[];

      if (rows.length === 0) {
        // Fallback: ultimi 8 prodotti disponibili
        const { data } = await supabase
          .from('products')
          .select(`
            id, name, price, images,
            profiles!products_seller_id_fkey ( store_name, is_approved )
          `)
          .eq('status', 'available')
          .order('created_at', { ascending: false })
          .limit(8);
        type ProdRow = {
          id: string; name: string; price: string | number; images: string[] | null;
          profiles: { store_name: string | null; is_approved: boolean } | null;
        };
        return ((data ?? []) as unknown as ProdRow[])
          .filter((p) => p.profiles?.is_approved)
          .map((p) => ({
            product_id: p.id,
            view_count: 0,
            product: { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: p.profiles },
          }));
      }

      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.product_id, Number(r.view_count));
      const topIds = rows.map((r) => r.product_id);

      const { data: products } = await supabase
        .from('products')
        .select(`
          id, name, price, images,
          profiles!products_seller_id_fkey ( store_name, is_approved )
        `)
        .in('id', topIds)
        .eq('status', 'available');

      type ProdRow2 = {
        id: string; name: string; price: string | number; images: string[] | null;
        profiles: { store_name: string | null; is_approved: boolean } | null;
      };
      return ((products ?? []) as unknown as ProdRow2[])
        .filter((p) => p.profiles?.is_approved)
        .map((p) => ({
          product_id: p.id,
          view_count: counts.get(p.id) ?? 0,
          product: { id: p.id, name: p.name, price: Number(p.price), images: p.images, profiles: p.profiles },
        }))
        .sort((a, b) => b.view_count - a.view_count);
    },
    refetchInterval: 5 * 60_000, // ogni 5 minuti
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="h-44 rounded-xl skeleton" aria-hidden />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <span className="inline-flex items-center gap-1.5 text-primary-700 text-xs font-bold uppercase tracking-wider">
            <TrendingUp size={14} strokeWidth={2.4} />
            Trending ora
          </span>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
            Quello che gira oggi a Piacenza
          </h2>
        </div>
        <Link href="/search" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
          Vedi tutto <ArrowRight size={16} strokeWidth={2.4} />
        </Link>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((it, i) => {
          const p = it.product;
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <Link
              key={p.id}
              href={`/product/${p.id}`}
              className="group relative bg-white rounded-xl border border-cream-300 overflow-hidden card-hover"
            >
              <div className="relative aspect-square bg-cream-100 overflow-hidden">
                {img ? (
                  <Image
                    src={sizedImage(img, 'card')}
                    alt={p.name}
                    fill
                    sizes="(min-width: 1024px) 16vw, (min-width: 640px) 25vw, 33vw"
                    unoptimized
                    className="object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-5xl text-cream-300">🛍️</div>
                )}
                {/* Rank badge per i primi 3 */}
                {i < 3 && (
                  <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 ${
                    i === 0 ? 'bg-accent-500 text-ink-900' :
                    i === 1 ? 'bg-cream-300 text-ink-900' :
                              'bg-primary-200 text-primary-800'
                  }`}>
                    <Flame size={10} strokeWidth={2.4} />
                    #{i + 1}
                  </div>
                )}
                {it.view_count > 5 && (
                  <div className="absolute bottom-2 right-2 bg-ink-900/80 backdrop-blur text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    👀 {it.view_count}
                  </div>
                )}
              </div>
              <div className="p-2.5 space-y-0.5">
                <p className="text-[11px] text-ink-500 truncate">{p.profiles?.store_name}</p>
                <p className="text-xs font-semibold text-ink-900 line-clamp-2 min-h-[2rem] leading-snug">{p.name}</p>
                <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
