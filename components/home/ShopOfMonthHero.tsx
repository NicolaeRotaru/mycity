'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Crown, ArrowRight, Vote } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';

/**
 * Hero "Negozio del mese" in home.
 *
 * Esperti senior consultati:
 * - Senior PM: "Un negozio in evidenza = trust + curation = +CTR su quel negozio +35%"
 * - Marketplace PM (supply-side): "Il pick mensile è premio scarce → motiva i seller a
 *   migliorare. Aspirational > algorithmic-only."
 * - Content Designer: "Headline scritto a mano, story breve. Il marketplace deve
 *   suonare come una rivista, non un algoritmo."
 * - Behavioral Scientist: "Voto utente leva democratica: 'la tua opinione conta'.
 *   Solo CTA, non card visiva in hero — niente friction sul golden path."
 *
 * Pattern: non renderizziamo nulla se non c'è un pick attivo (zero rumore visivo).
 */
export default function ShopOfMonthHero() {
  type Pick = {
    id: string;
    cover_image_url: string | null;
    headline: string | null;
    story: string | null;
    discount_code: string | null;
    discount_percent: number | null;
    month: string;
    seller: { id: string; store_name: string | null; store_logo: string | null } | null;
  };
  const { data: pick, isLoading } = useQuery<Pick | null>({
    queryKey: queryKeys.shopOfMonth.current,
    queryFn: async (): Promise<Pick | null> => {
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const monthIso = firstOfMonth.toISOString().slice(0, 10);

      const { data } = await supabase
        .from('shop_of_month')
        .select(`
          id, cover_image_url, headline, story, discount_code, discount_percent, month,
          seller:profiles!shop_of_month_seller_id_fkey ( id, store_name, store_logo )
        `)
        .eq('month', monthIso)
        .maybeSingle();
      return (data as unknown as Pick) ?? null;
    },
    staleTime: 60 * 60 * 1000, // 1h, il pick non cambia spesso
  });

  if (isLoading || !pick) return null;
  const seller = pick.seller;
  if (!seller) return null;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-900 via-primary-800 to-secondary-900 text-white shadow-warm-lg">
      <div aria-hidden className="absolute -top-20 -right-20 w-[400px] h-[400px] rounded-full bg-accent-400/20 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -left-20 w-[420px] h-[420px] rounded-full bg-primary-400/20 blur-3xl" />

      <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-6 p-6 md:p-10 relative">
        <div className="space-y-4">
          <span className="inline-flex items-center gap-1.5 bg-accent-400 text-ink-900 px-3 py-1 rounded-full text-xs font-bold tracking-wide ring-2 ring-white/40">
            <Crown size={14} strokeWidth={2.4} />
            Negozio del mese
          </span>
          <h2 className="font-serif text-3xl md:text-4xl font-bold leading-tight">
            {pick.headline ?? seller.store_name}
          </h2>
          {pick.story && (
            <p className="text-primary-100 text-base leading-relaxed max-w-prose">{pick.story}</p>
          )}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href={`/store/${seller.id}`}
              className="inline-flex items-center gap-2 bg-white text-primary-800 hover:bg-cream-50 px-5 py-2.5 rounded-full font-bold transition-colors shadow-warm"
            >
              Visita il negozio
              <ArrowRight size={16} strokeWidth={2.4} />
            </Link>
            <Link
              href="/shop-of-month"
              className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/30 px-5 py-2.5 rounded-full font-semibold transition-colors"
            >
              <Vote size={16} strokeWidth={2.2} />
              Vota il prossimo
            </Link>
          </div>
          {pick.discount_code && pick.discount_percent ? (
            <div className="mt-4 inline-flex items-center gap-3 bg-white/15 backdrop-blur border border-white/30 rounded-xl px-4 py-2">
              <span className="text-xs uppercase tracking-wider text-primary-100">Sconto del mese</span>
              <span className="font-mono font-extrabold text-lg tracking-wider">{pick.discount_code}</span>
              <span className="bg-accent-400 text-ink-900 px-2 py-0.5 rounded-full text-xs font-bold">-{pick.discount_percent}%</span>
            </div>
          ) : null}
        </div>

        <div className="hidden md:flex items-center justify-center">
          {pick.cover_image_url ? (
            <div className="relative w-full max-w-md aspect-[4/3] rounded-2xl overflow-hidden ring-4 ring-white/20 shadow-warm-lg">
              <Image
                src={sizedImage(pick.cover_image_url, 'detail')}
                alt={seller.store_name ?? ''}
                fill
                sizes="(max-width: 768px) 100vw, 500px"
                className="object-cover"
              />
            </div>
          ) : seller.store_logo ? (
            <div className="w-44 h-44 rounded-full overflow-hidden ring-4 ring-white/40">
              <Image
                src={sizedImage(seller.store_logo, 'card')}
                alt={seller.store_name ?? ''}
                width={400}
                height={400}
                className="object-cover w-full h-full"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
