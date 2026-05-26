'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';

type Props = {
  productId: string;
  categoryId: string | null;
  currentPrice: number;
};

/**
 * Compara il prezzo del prodotto con la media della sua categoria.
 * Mostra "Sotto la media -X%" o "Sopra la media +X%" con icona colorata.
 * Trust signal forte per il buyer.
 */
export default function PriceComparison({ productId, categoryId, currentPrice }: Props) {
  const { data: avg } = useQuery({
    queryKey: ['category-avg-price', categoryId],
    enabled: !!categoryId,
    queryFn: async () => {
      if (!categoryId) return null;
      const { data } = await supabase
        .from('products')
        .select('price')
        .eq('category_id', categoryId)
        .eq('status', 'available')
        .neq('id', productId)
        .limit(200);
      const arr = (data ?? []) as { price: number }[];
      if (arr.length < 3) return null; // serve almeno 3 prodotti per dare un confronto significativo
      const sum = arr.reduce((s, p) => s + Number(p.price), 0);
      return sum / arr.length;
    },
  });

  if (!avg) return null;

  const diff = currentPrice - avg;
  const pct = Math.abs((diff / avg) * 100);
  const isBelow = diff < 0;
  const isClose = pct < 5; // entro ±5% è "nella media"

  if (isClose) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-ink-500 bg-cream-50 px-2.5 py-1 rounded-full">
        <Minus size={12} />
        <span>Nella media (~{formatPrice(avg)})</span>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
      isBelow ? 'bg-olive-100 text-olive-800' : 'bg-accent-100 text-accent-800'
    }`}>
      {isBelow ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
      <span>
        {isBelow ? `Sotto la media -${pct.toFixed(0)}%` : `Sopra la media +${pct.toFixed(0)}%`}
        <span className="opacity-70 ml-1">(media {formatPrice(avg)})</span>
      </span>
    </div>
  );
}
