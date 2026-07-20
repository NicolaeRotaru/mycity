'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BadgeCheck, Bell, Star, Store, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';
import { useFollowStore } from '@/components/hooks/useFollowStore';
import { isVerifiedStore } from '@/lib/store-trust';

/**
 * Scheda venditore della PDP: avatar, nome, badge verificato, valutazione,
 * "membro dal", conteggio follower e statistica "consegne in tempo", con link al
 * negozio e toggle "Segui".
 *
 * DATI REALI:
 * - valutazione/conteggio → tabella `store_reviews` (stessa fonte della vetrina).
 * - "membro dal" → `profiles.created_at`.
 * - logo → `profiles.store_logo`.
 * - follow / follower count → hook `useFollowStore` (`follows` + RPC
 *   `store_follower_count`).
 * - "% in tempo" → derivata dagli ordini del negozio: ordini DELIVERED consegnati
 *   entro 48h dalla creazione / totale DELIVERED. Renderizzata SOLO con un campione
 *   minimo (≥5 ordini consegnati e timestamp `delivered_at` disponibili); altrimenti
 *   omessa — niente numero inventato.
 * Ogni pezzo è renderizzato SOLO se il dato esiste (graceful).
 */

// Soglia minima di ordini consegnati prima di mostrare la % puntuale (significatività).
const ONTIME_MIN_SAMPLE = 5;
// Finestra "in tempo": consegnato entro 48h dalla creazione dell'ordine.
const ONTIME_WINDOW_MS = 48 * 60 * 60 * 1000;

type SellerStats = {
  store_logo: string | null;
  created_at: string | null;
  verified: boolean;
  rating: number | null;
  reviewCount: number;
  onTimePct: number | null;
};

export function SellerCard({
  sellerId,
  storeName,
}: {
  sellerId: string;
  storeName: string;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.stores.sellerCard(sellerId),
    queryFn: async (): Promise<SellerStats> => {
      const [profileRes, reviewsRes, ordersRes] = await Promise.all([
        supabase
          .from('seller_public_profiles')
          .select('store_logo, created_at, is_approved, stripe_charges_enabled, stripe_payouts_enabled')
          .eq('id', sellerId)
          .maybeSingle(),
        supabase.from('store_reviews').select('rating').eq('store_id', sellerId),
        // Ordini consegnati del negozio: bastano created_at + delivered_at per la
        // derivazione "in tempo" (entro 48h). Query leggera, capata a 200 righe.
        supabase
          .from('orders')
          .select('created_at, delivered_at')
          .eq('seller_id', sellerId)
          .eq('delivery_status', 'DELIVERED')
          .limit(200),
      ]);
      const reviews = (reviewsRes.data ?? []) as { rating: number }[];
      const reviewCount = reviews.length;
      const rating = reviewCount > 0
        ? reviews.reduce((s, r) => s + Number(r.rating), 0) / reviewCount
        : null;

      // % puntuale: solo sugli ordini con entrambi i timestamp; mostrata solo se
      // il campione è abbastanza grande (ONTIME_MIN_SAMPLE), altrimenti null.
      const delivered = (ordersRes.data ?? []) as { created_at: string | null; delivered_at: string | null }[];
      const timed = delivered.filter((o) => o.created_at && o.delivered_at);
      let onTimePct: number | null = null;
      if (timed.length >= ONTIME_MIN_SAMPLE) {
        const onTime = timed.filter(
          (o) => new Date(o.delivered_at as string).getTime() - new Date(o.created_at as string).getTime() <= ONTIME_WINDOW_MS,
        ).length;
        onTimePct = Math.round((onTime / timed.length) * 100);
      }

      return {
        store_logo: profileRes.data?.store_logo ?? null,
        created_at: profileRes.data?.created_at ?? null,
        verified: isVerifiedStore(profileRes.data),
        rating,
        reviewCount,
        onTimePct,
      };
    },
    staleTime: 60_000,
  });

  const { isFollowing, followerCount, toggle } = useFollowStore(sellerId);

  const memberSince = data?.created_at ? new Date(data.created_at).getFullYear() : null;

  const handleFollow = () => {
    toggle.mutate(undefined, {
      onError: (err: unknown) => {
        if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
          toast.error('Accedi per seguire il negozio');
        }
      },
    });
  };

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
          {data?.verified && <BadgeCheck size={16} className="shrink-0 text-primary-600" aria-hidden />}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-500">
          {data?.rating != null && (
            <span className="inline-flex items-center gap-1">
              <Star size={12} className="fill-accent-400 text-accent-500" aria-hidden />
              <strong className="text-ink-700">{data.rating.toFixed(1)}</strong>
              <span>({data.reviewCount})</span>
            </span>
          )}
          {data?.onTimePct != null && (
            <span className="inline-flex items-center gap-1">
              <Clock size={12} className="text-olive-600" aria-hidden />
              <strong className="text-ink-700">{data.onTimePct}%</strong> in tempo
            </span>
          )}
          {followerCount > 0 && <span>· {followerCount} follower</span>}
          {memberSince && <span>· dal {memberSince}</span>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-stretch gap-1.5">
        {/* Toggle "Segui" — accanto al link "Vai al negozio" (che resta). */}
        <button
          type="button"
          onClick={handleFollow}
          aria-pressed={isFollowing}
          aria-label={isFollowing ? `Smetti di seguire ${storeName}` : `Segui ${storeName}`}
          className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors ${
            isFollowing
              ? 'border border-primary-600 bg-primary-50 text-primary-700 hover:bg-primary-100'
              : 'border border-cream-300 bg-white text-ink-700 hover:border-primary-300 hover:bg-primary-50'
          }`}
        >
          <Bell size={14} strokeWidth={2.4} fill={isFollowing ? 'currentColor' : 'none'} aria-hidden />
          {isFollowing ? 'Segui già' : 'Segui'}
        </button>

        <Link
          href={`/store/${sellerId}`}
          className="inline-flex items-center justify-center gap-1 rounded-full border border-cream-300 bg-white px-3 py-1.5 text-[13px] font-bold text-primary-700 transition-colors hover:border-primary-300 hover:bg-primary-50"
        >
          Vai al negozio <ArrowRight size={14} strokeWidth={2.4} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
