'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';

type Item = {
  viewed_at: string;
  product: {
    id: string;
    name: string;
    price: number;
    images: string[] | null;
    profiles: { store_name: string | null; is_approved: boolean } | null;
  };
};

type Props = {
  /** Esclude un prodotto dal carosello (utile su scheda prodotto stesso) */
  excludeId?: string;
  className?: string;
};

/**
 * Carosello "Ultimi visti" per utente loggato. Riduce il friction nel ritrovare
 * un prodotto visto poco fa. Si nasconde se l'utente non è loggato o ha < 2
 * prodotti visti.
 */
export default function RecentlyViewed({ excludeId, className = '' }: Props) {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const { data: items = [] } = useQuery({
    queryKey: ['recently-viewed', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Item[]> => {
      const { data } = await supabase
        .from('recently_viewed')
        .select(`
          viewed_at,
          product:products!recently_viewed_product_id_fkey (
            id, name, price, images,
            profiles!products_seller_id_fkey ( store_name, is_approved )
          )
        `)
        .eq('user_id', userId!)
        .order('viewed_at', { ascending: false })
        .limit(12);
      return ((data ?? []) as unknown as Item[])
        .filter((it) => it.product?.profiles?.is_approved && it.product.id !== excludeId);
    },
  });

  if (!userId || items.length < 2) return null;

  return (
    <section className={className}>
      <h2 className="text-lg md:text-xl font-serif font-bold text-ink-900 mb-3 flex items-center gap-2">
        <Clock size={18} className="text-primary-600" />
        Ultimi visti
      </h2>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory">
        {items.map((it) => {
          const p = it.product;
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <Link
              key={p.id}
              href={`/product/${p.id}`}
              className="snap-start shrink-0 w-36 sm:w-40 bg-white border border-cream-200 rounded-xl overflow-hidden card-hover"
            >
              <div className="relative w-full aspect-square bg-cream-100">
                {img && (
                  <Image
                    src={sizedImage(img, 'thumb')}
                    alt={p.name}
                    fill
                    sizes="160px"
                    unoptimized
                    className="object-cover"
                  />
                )}
              </div>
              <div className="p-2 space-y-0.5">
                <p className="text-xs text-ink-500 truncate">{p.profiles?.store_name}</p>
                <p className="text-sm font-semibold text-ink-900 line-clamp-2 leading-snug min-h-[2.5rem]">{p.name}</p>
                <p className="text-sm font-bold text-primary-700">{formatPrice(p.price)}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
