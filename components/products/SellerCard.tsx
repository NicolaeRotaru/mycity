'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Star, Store } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Scheda venditore della PDP: avatar, nome, badge verificato, valutazione e
 * "membro dal", con link al negozio.
 *
 * DATI REALI:
 * - valutazione/conteggio → tabella `store_reviews` (stessa fonte della vetrina).
 * - "membro dal" → `profiles.created_at`.
 * - logo → `profiles.store_logo`.
 * Ogni pezzo è renderizzato SOLO se il dato esiste (graceful).
 *
 * OMESSO di proposito: la percentuale "puntuale" — non esiste un campo che la
 * tracci nello schema, quindi NON la inventiamo.
 *
 * Il "follow" del negozio non ha un endpoint dedicato in questo codebase: al suo
 * posto offriamo l'azione reale disponibile, "Vai al negozio".
 */

type SellerStats = {
  store_logo: string | null;
  created_at: string | null;
  rating: number | null;
  reviewCount: number;
};

export function SellerCard({
  sellerId,
  storeName,
  verified,
}: {
  sellerId: string;
  storeName: string;
  verified?: boolean;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.stores.sellerCard(sellerId),
    queryFn: async (): Promise<SellerStats> => {
      const [profileRes, reviewsRes] = await Promise.all([
        supabase.from('profiles').select('store_logo, created_at').eq('id', sellerId).maybeSingle(),
        supabase.from('store_reviews').select('rating').eq('store_id', sellerId),
      ]);
      const reviews = (reviewsRes.data ?? []) as { rating: number }[];
      const reviewCount = reviews.length;
      const rating = reviewCount > 0
        ? reviews.reduce((s, r) => s + Number(r.rating), 0) / reviewCount
        : null;
      return {
        store_logo: profileRes.data?.store_logo ?? null,
        created_at: profileRes.data?.created_at ?? null,
        rating,
        reviewCount,
      };
    },
    staleTime: 60_000,
  });

  const memberSince = data?.created_at ? new Date(data.created_at).getFullYear() : null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-cream-300 bg-white px-3 py-3">
      <Link
        href={`/store/${sellerId}`}
        aria-label={`Vai al negozio ${storeName}`}
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cream-100"
      >
        {data?.store_logo ? (
          <Image
            src={sizedImage(data.store_logo, 'thumb')}
            alt={storeName}
            width={48}
            height={48}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <Store size={20} className="text-ink-400" aria-hidden />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/store/${sellerId}`} className="flex items-center gap-1.5 hover:underline">
          <span className="truncate font-semibold text-ink-900">{storeName}</span>
          {verified && <BadgeCheck size={16} className="shrink-0 text-primary-600" aria-hidden />}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-500">
          {data?.rating != null && (
            <span className="inline-flex items-center gap-1">
              <Star size={12} className="fill-accent-400 text-accent-500" aria-hidden />
              <strong className="text-ink-700">{data.rating.toFixed(1)}</strong>
              <span>({data.reviewCount})</span>
            </span>
          )}
          {memberSince && <span>· dal {memberSince}</span>}
        </div>
      </div>

      <Link
        href={`/store/${sellerId}`}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-cream-300 bg-white px-3 py-1.5 text-[13px] font-bold text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
      >
        Vai al negozio <ArrowRight size={14} strokeWidth={2.4} aria-hidden />
      </Link>
    </div>
  );
}
