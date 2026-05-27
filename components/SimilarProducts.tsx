'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';

type Item = {
  id: string;
  name: string;
  price: number;
  images: string[] | null;
  profiles: { store_name: string | null; is_approved: boolean } | null;
};

type Props = {
  productId: string;
  categoryId?: string;
  sellerId?: string;
};

/**
 * Recommendations "Potrebbe piacerti": prima cerca nello stesso negozio,
 * poi nella stessa categoria, escludendo il prodotto corrente. Massimo 6.
 *
 * Versione MVP — quando avremo dati di comportamento sufficienti
 * (product_views + acquisti correlati), si può evolvere in un sistema
 * collaborative filtering basato su "chi ha visto X ha visto anche Y".
 */
export default function SimilarProducts({ productId, categoryId, sellerId }: Props) {
  const { data: items = [], isLoading } = useQuery({
    queryKey: queryKeys.products.similar(productId, categoryId, sellerId),
    queryFn: async (): Promise<Item[]> => {
      const collected = new Map<string, Item>();

      // 1) Stesso seller (priorità più alta — cross-sell del negozio)
      if (sellerId) {
        const { data } = await supabase
          .from('products')
          .select(`
            id, name, price, images,
            profiles!products_seller_id_fkey ( store_name, is_approved )
          `)
          .eq('seller_id', sellerId)
          .eq('status', 'available')
          .neq('id', productId)
          .limit(6);
        for (const p of (data ?? []) as unknown as Item[]) {
          if (p.profiles?.is_approved) collected.set(p.id, p as Item);
        }
      }

      // 2) Stessa categoria (fill fino a 6)
      if (categoryId && collected.size < 6) {
        const { data } = await supabase
          .from('products')
          .select(`
            id, name, price, images,
            profiles!products_seller_id_fkey ( store_name, is_approved )
          `)
          .eq('category_id', categoryId)
          .eq('status', 'available')
          .neq('id', productId)
          .limit(12);
        for (const p of (data ?? []) as unknown as Item[]) {
          if (collected.size >= 6) break;
          if (collected.has(p.id)) continue;
          if (!p.profiles?.is_approved) continue;
          collected.set(p.id, p as Item);
        }
      }

      return Array.from(collected.values()).slice(0, 6);
    },
    enabled: !!productId,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => <div key={i} className="aspect-[3/4] rounded-xl skeleton" />)}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl md:text-2xl font-serif font-bold text-ink-900 mb-4 flex items-center gap-2">
        <Sparkles size={20} className="text-accent-600" />
        Potrebbe piacerti
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {items.map((p) => {
          const img = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
          return (
            <Link
              key={p.id}
              href={`/product/${p.id}`}
              className="bg-white border border-cream-200 rounded-xl overflow-hidden card-hover"
            >
              <div className="relative w-full aspect-square bg-cream-100">
                {img && (
                  <Image
                    src={sizedImage(img, 'thumb')}
                    alt={p.name}
                    fill
                    sizes="(min-width: 768px) 160px, 50vw"
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
