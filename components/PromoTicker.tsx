'use client';

import Link from 'next/link';
import { Banknote, Zap, MapPin, Tag } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';

const WEDGE = [
  { icon: Banknote, text: 'Paghi alla consegna' },
  { icon: Zap, text: 'Consegna in 24-48h' },
  { icon: MapPin, text: 'Negozi veri di Piacenza' },
];

/**
 * Striscia in cima: la promessa FISSA di MyCity (il "wedge") sempre presente,
 * più UNO slot promo che si accende solo se ci sono promozioni reali attive
 * (scaffold-scalato: niente slot vuoto se non c'è davvero nulla da dire).
 */
export default function PromoTicker() {
  const { data: hasPromo = false } = useQuery({
    queryKey: ['promotions', 'active-any'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<boolean> => {
      const nowIso = new Date().toISOString();
      const { count } = await supabase
        .from('seller_promotions')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .lte('starts_at', nowIso)
        .gte('ends_at', nowIso);
      return (count ?? 0) > 0;
    },
  });

  return (
    <div className="border-b border-ink-800 bg-ink-900 text-xs text-ink-100 sm:text-sm">
      <div className="container mx-auto flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 py-2 text-center">
        {WEDGE.map(({ icon: Icon, text }) => (
          <span key={text} className="flex items-center gap-1.5">
            <Icon size={14} strokeWidth={2.2} className="text-accent-400" />
            <span className="font-medium">{text}</span>
          </span>
        ))}
        {hasPromo && (
          <Link
            href="/promozioni"
            className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-3 py-0.5 font-bold text-ink-900 transition-colors hover:bg-accent-400"
          >
            <Tag size={13} strokeWidth={2.6} />
            Promozioni attive · Scopri
          </Link>
        )}
      </div>
    </div>
  );
}
