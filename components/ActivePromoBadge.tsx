'use client';

import { useQuery } from '@tanstack/react-query';
import { Tag } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { scontoMostrato } from '@/lib/sconto-mostrato';
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
      // 12/11/2026 (R02-011) — Una lettura caduta non è «nessuno sconto»: con `return 0` lo zero
      // restava in memoria per un minuto (stessa chiave della scheda) e si mostrava il prezzo pieno,
      // mentre la cassa applica lo sconto. Si lancia: React Query riprova, e non si salva lo zero.
      if (error) throw error;
      return Number(data) || 0;
    },
    staleTime: 60_000,
    // R02-011 (dopo il collaudo) — Stessa chiave della scheda: gli stessi nuovi tentativi.
    retry: 3,
  });

  if (!discount || discount <= 0) return null;

  // R16-012 — Lo scontato si calcola con la funzione della cassa (`discountedUnitCents`: al centesimo,
  // sconto fra 0 e 70), come il prezzo grande della scheda. La formula a mano non arrotondava:
  // 1,15 € al -10% il bollino scriveva 1,04 € e la cassa faceva pagare 1,03 €.
  // R16-006 — La percentuale che il prezzo applica davvero (tetto 70 di `discountedUnitCents`), come
  // il bollino di ProductCard: su 100 € lo scontato in centesimi dice lo sconto applicato.
  // R10-004 (onda 2) — La regola unica di `scontoMostrato`: sotto lo 0,5% la percentuale arrotondata
  // è 0 e il bollino scriveva «In promo -0%»; se al centesimo il prezzo non cambia (1,00 € al -0,3%)
  // il bollino barrava 1,00 € accanto a 1,00 € con «Risparmi 0,00 €». Ora: nessun bollino se il
  // prezzo non cambia, e «In promo» senza percentuale se il prezzo cambia ma la percentuale è 0.
  const sconto = scontoMostrato({ prezzo: basePrice, scontoPercento: discount });
  if (sconto.origine !== 'promo' || sconto.barratoCents === null) return null;
  const discounted = sconto.prezzoCents / 100;
  const savings = (sconto.barratoCents - sconto.prezzoCents) / 100;
  const appliedPct = sconto.percento;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-2 bg-secondary-50 border border-secondary-200 rounded-lg px-3 py-1.5">
        <Tag size={14} className="text-secondary-700" strokeWidth={2.4} />
        <span className="text-sm font-bold text-secondary-700">In promo{appliedPct !== null ? ` -${appliedPct}%` : ''}</span>
        <span className="text-sm text-ink-500 line-through">{formatPrice(basePrice)}</span>
        <span className="text-sm font-bold text-secondary-700">{formatPrice(discounted)}</span>
      </div>
      <span className="inline-flex items-center text-xs font-bold text-olive-700 bg-olive-50 px-2 py-1 rounded">
        Risparmi {formatPrice(savings)}
      </span>
    </div>
  );
}
