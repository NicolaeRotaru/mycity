'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Percent, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import ProductCard from '@/components/ProductCard';
import { queryKeys } from '@/lib/queries/keys';

type Row = {
  product_id: string;
  name: string;
  price: number | string;
  images: string[] | null;
  seller_id: string | null;
  store_name: string | null;
  discount_percent: number;
};

/**
 * Sezione home "Promozioni": prodotti con uno sconto attivo (da seller_promotions),
 * via RPC active_promo_products. Si nasconde se non ci sono promo in corso.
 */
export default function PromoDeals() {
  const { data: items = [] } = useQuery({
    queryKey: queryKeys.promotions.home,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc('active_promo_products', { p_limit: 12 });
      if (error) return [];
      return (data ?? []) as Row[];
    },
    refetchInterval: 5 * 60_000,
  });

  if (items.length === 0) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <span className="inline-flex items-center gap-1.5 text-rose-600 text-xs font-bold uppercase tracking-wider">
            <Percent size={14} strokeWidth={2.4} />
            Promozioni
          </span>
          <h2 className="text-2xl md:text-3xl font-serif font-bold text-ink-900 mt-1">
            Sconti attivi a Piacenza
          </h2>
        </div>
        <Link href="/promozioni" className="inline-flex items-center gap-1 text-primary-700 hover:text-primary-800 font-semibold text-sm">
          Vedi tutte <ArrowRight size={16} strokeWidth={2.4} />
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {items.map((it, i) => (
          <ProductCard
            key={it.product_id}
            id={it.product_id}
            name={it.name}
            price={Number(it.price)}
            images={Array.isArray(it.images) ? it.images : []}
            storeName={it.store_name ?? undefined}
            sellerId={it.seller_id ?? undefined}
            discountPercent={it.discount_percent}
            priority={i < 4}
          />
        ))}
      </div>
    </section>
  );
}
