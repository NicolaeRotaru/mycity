'use client';

import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Badge "Promo attiva -X%" sul prodotto.
 *
 * Esperti senior consultati:
 * - Behavioral Scientist: "Promozione attiva visibile pre-decisione → +15% conversion.
 *   Mostra prezzo BARRATO + prezzo nuovo per trigger del 'sembra affare'."
 * - Content Designer: "Tono asciutto. 'In promo, -20%' > 'Special offer'.
 *   Italiano semplice, no anglicismi."
 * - Trust & Safety: "No prezzi falsamente gonfiati. La fonte (seller_promotions
 *   table) è autoritativa, no fake discounts."
 * - Marketplace PM: "Il discount viene dal seller, non da MyCity. Trasparenza
 *   sul perché del prezzo basso."
 */

type Props = {
  productId: string;
  basePrice: number;
};

export default function ActivePromoBadge({ productId, basePrice }: Props) {
  const { data: discount } = useQuery({
    queryKey: queryKeys.products.activeDiscount(productId),
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc('product_active_discount', { p_product: productId });
      if (error) return 0;
      return Number(data) || 0;
    },
    staleTime: 60_000,
  });

  if (!discount || discount <= 0) return null;

  const discounted = basePrice * (1 - discount / 100);
  const savings = basePrice - discounted;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-2 bg-secondary-50 border border-secondary-200 rounded-lg px-3 py-1.5">
        <Tag size={14} className="text-secondary-700" strokeWidth={2.4} />
        <span className="text-sm font-bold text-secondary-700">In promo -{discount}%</span>
        <span className="text-sm text-ink-500 line-through">{formatPrice(basePrice)}</span>
        <span className="text-sm font-bold text-secondary-700">{formatPrice(discounted)}</span>
      </div>
      <span className="inline-flex items-center text-xs font-bold text-olive-700 bg-olive-50 px-2 py-1 rounded">
        Risparmi {formatPrice(savings)}
      </span>
    </div>
  );
}
