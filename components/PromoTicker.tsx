'use client';

import Link from 'next/link';
import { Tag } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { useBranding } from './hooks/useBranding';
import { wedgeIcon } from '@/lib/site-branding';

/**
 * Striscia in cima: la promessa di MyCity (il "wedge"), gestita dall'admin via
 * /admin/branding (site_settings.branding, con fallback ai testi di default), più
 * UNO slot promo che si accende solo se ci sono promozioni reali attive E il link
 * è abilitato nel branding.
 */
export default function PromoTicker() {
  const branding = useBranding();

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

  const showPromo = hasPromo && branding.announcement.promoLinkEnabled;

  return (
    <div className="border-b border-ink-800 bg-ink-900 text-xs text-ink-100 sm:text-sm">
      <div className="container mx-auto flex items-center gap-x-4 overflow-x-auto scrollbar-hide whitespace-nowrap px-4 py-2 sm:justify-center sm:gap-x-5">
        {branding.announcement.items.map((it, i) => {
          const Icon = wedgeIcon(it.icon);
          return (
            <span key={i} className="flex shrink-0 items-center gap-1.5">
              <Icon size={14} strokeWidth={2.2} className="text-accent-400" />
              <span className="font-medium">{it.text}</span>
            </span>
          );
        })}
        {showPromo && (
          <Link
            href="/promozioni"
            className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent-500 px-3 py-0.5 font-bold text-ink-900 transition-colors hover:bg-accent-400"
          >
            <Tag size={13} strokeWidth={2.6} />
            Promozioni attive · Scopri
          </Link>
        )}
      </div>
    </div>
  );
}
