'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';

type Props = {
  placement: 'home_top' | 'search_top' | 'category_top';
  categorySlug?: string;
};

type SponsoredItem = {
  id: string;
  product_id: string;
  product: {
    id: string;
    name: string;
    price: number;
    images: string[] | null;
    profiles: { store_name: string | null; is_approved: boolean } | null;
  } | null;
};

/**
 * Carosello "Sponsored" — placement-aware. Mostra prodotti dei seller
 * che hanno comprato il listing sponsored per quel placement.
 *
 * Niente visualizzazione se 0 sponsorizzati attivi.
 * Badge "Sponsored" visibile per trasparenza (richiesto da legge UE).
 */
export default function SponsoredCarousel({ placement, categorySlug }: Props) {
  const { data: items = [] } = useQuery({
    queryKey: ['sponsored', placement, categorySlug],
    queryFn: async (): Promise<SponsoredItem[]> => {
      const today = new Date().toISOString().slice(0, 10);
      let q = supabase
        .from('sponsored_listings')
        .select(`
          id, product_id,
          product:products!sponsored_listings_product_id_fkey (
            id, name, price, images,
            profiles!products_seller_id_fkey ( store_name, is_approved )
          )
        `)
        .eq('placement', placement)
        .eq('status', 'active')
        .lte('start_date', today)
        .gte('end_date', today)
        .limit(8);
      if (placement === 'category_top' && categorySlug) {
        q = q.eq('category_slug', categorySlug);
      }
      const { data } = await q;
      return ((data ?? []) as unknown as SponsoredItem[]).filter(
        (it) => it.product && it.product.profiles?.is_approved,
      );
    },
  });

  if (items.length === 0) return null;

  return (
    <section className="bg-accent-50 border border-accent-200 rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif font-bold text-ink-900 inline-flex items-center gap-2">
          <Sparkles size={16} className="text-accent-700" />
          In primo piano
        </h3>
        <span className="text-[10px] uppercase tracking-wider font-bold text-ink-400">Sponsored</span>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-1">
        {items.map((it) => {
          const p = it.product!;
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <Link
              key={it.id}
              href={`/product/${p.id}`}
              className="shrink-0 w-32 sm:w-36 snap-start bg-white border border-cream-200 rounded-xl overflow-hidden card-hover"
            >
              <div className="relative aspect-square bg-cream-100">
                {img && <Image src={sizedImage(img, 'thumb')} alt={p.name} fill sizes="144px" unoptimized className="object-cover" />}
              </div>
              <div className="p-2">
                <p className="text-xs text-ink-500 truncate">{p.profiles?.store_name}</p>
                <p className="text-sm font-semibold text-ink-900 line-clamp-2 min-h-[2.5rem]">{p.name}</p>
                <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
