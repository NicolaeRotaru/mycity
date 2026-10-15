'use client';

import Link from 'next/link';
import Image from 'next/image';
import caricatoreFotoRemote from '@/lib/image-loader';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';
import { leggiVistiDiRecente, type VistoDiRecente } from '@/lib/queries/fasce-prodotti';
import { useUtente } from '@/components/hooks/useUtente';

type Item = VistoDiRecente;

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
  // #88 — Dalla cache condivisa, non da una chiamata di rete propria.
  const { userId } = useUtente();

  const { data: items = [] } = useQuery({
    queryKey: queryKeys.home.recentlyViewed(userId ?? ''),
    enabled: !!userId,
    // 15/10/2026 (R3) — La lettura vive in lib/queries/fasce-prodotti.ts: agganciava il
    // negozio a `profiles`, che dopo la migrazione 161 un cliente non legge piu'.
    queryFn: (): Promise<Item[]> => leggiVistiDiRecente(supabase, { userId: userId!, excludeId }),
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
                    src={sizedImage(img, 160, { quadrato: true })}
                    alt={p.name}
                    fill
                    sizes="160px"
                    loader={caricatoreFotoRemote}
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
