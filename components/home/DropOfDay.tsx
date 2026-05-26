'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { Flame, Clock, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatPrice } from '@/lib/format';
import { sizedImage } from '@/lib/image-url';
import { queryKeys } from '@/lib/queries/keys';

type Drop = {
  id: string;
  drop_date: string;
  discount_percent: number;
  original_price: number;
  drop_price: number;
  headline: string | null;
  product: {
    id: string;
    name: string;
    description: string | null;
    images: string[] | null;
    profiles: { id: string; store_name: string | null } | null;
  } | null;
};

function useCountdown(targetIso: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(targetIso).getTime() - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1000);
  return { h, m, s, done: diff === 0 };
}

function endOfTodayIso() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

/**
 * Drop del giorno — singolo prodotto in offerta a tempo (mezzanotte).
 * Tecnica psicologica: scarcity + countdown + FOMO + "evento ricorrente"
 * → crea habit di tornare ogni sera per vedere il nuovo drop.
 */
export default function DropOfDay() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: drop, isLoading } = useQuery({
    queryKey: queryKeys.home.dailyDrop(today),
    queryFn: async (): Promise<Drop | null> => {
      const { data } = await supabase
        .from('daily_drops')
        .select(`
          id, drop_date, discount_percent, original_price, drop_price, headline,
          product:products!daily_drops_product_id_fkey (
            id, name, description, images,
            profiles!products_seller_id_fkey ( id, store_name )
          )
        `)
        .eq('drop_date', today)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  const { h, m, s, done } = useCountdown(endOfTodayIso());

  if (isLoading) {
    return <div className="h-72 rounded-2xl skeleton" aria-hidden />;
  }

  if (!drop || !drop.product) {
    return null; // nessun drop oggi: il blocco è opzionale
  }

  const img = Array.isArray(drop.product.images) && drop.product.images[0]
    ? drop.product.images[0]
    : 'https://placehold.co/600x600/FBF7F0/C0492C?text=Drop';
  const savings = Math.round(drop.original_price - drop.drop_price);

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 via-primary-600 to-secondary-700 text-white shadow-warm-lg">
      {/* Pattern decorativo */}
      <div aria-hidden className="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle at 20% 30%, white 1px, transparent 1px), radial-gradient(circle at 80% 70%, white 1px, transparent 1px)',
        backgroundSize: '48px 48px, 64px 64px',
      }} />

      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 p-6 md:p-10 items-center">
        <div className="space-y-4">
          <div className="inline-flex items-center gap-2 bg-accent-500 text-ink-900 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
            <Flame size={14} strokeWidth={2.4} />
            Drop del giorno
          </div>

          <h2 className="text-3xl md:text-4xl font-serif font-bold leading-tight">
            {drop.headline ?? drop.product.name}
          </h2>

          <p className="text-white/90 text-sm md:text-base max-w-prose">
            {drop.product.description?.slice(0, 140) ?? 'Solo per oggi a prezzo speciale.'}
          </p>

          <div className="flex items-baseline gap-3 pt-2">
            <span className="text-4xl md:text-5xl font-extrabold text-accent-300">
              {formatPrice(drop.drop_price)}
            </span>
            <span className="text-lg line-through opacity-60">
              {formatPrice(drop.original_price)}
            </span>
            <span className="bg-white text-primary-700 px-2 py-0.5 rounded-full text-sm font-bold">
              -{drop.discount_percent}%
            </span>
          </div>

          <p className="text-xs opacity-90">
            Risparmi <strong>{formatPrice(savings)}</strong>{drop.product.profiles?.store_name && ` · da ${drop.product.profiles.store_name}`}
          </p>

          {!done && (
            <div className="flex items-center gap-3 pt-3">
              <Clock size={20} className="text-accent-300" />
              <div className="flex items-center gap-1.5 text-xl font-bold font-mono">
                <span className="bg-white/15 px-2.5 py-1 rounded-lg">{String(h).padStart(2, '0')}</span>
                <span>:</span>
                <span className="bg-white/15 px-2.5 py-1 rounded-lg">{String(m).padStart(2, '0')}</span>
                <span>:</span>
                <span className="bg-white/15 px-2.5 py-1 rounded-lg">{String(s).padStart(2, '0')}</span>
              </div>
              <span className="text-xs opacity-80 hidden sm:inline">prima del prossimo drop</span>
            </div>
          )}

          <Link
            href={`/product/${drop.product.id}`}
            className="inline-flex items-center gap-2 bg-accent-500 hover:bg-accent-400 text-ink-900 px-6 py-3 rounded-full font-bold mt-3 transition-colors shadow-lg"
          >
            Acquista subito
            <ArrowRight size={18} strokeWidth={2.4} />
          </Link>
        </div>

        <div className="relative w-full max-w-md mx-auto">
          <div className="relative aspect-square bg-white rounded-2xl overflow-hidden shadow-warm-xl">
            <Image
              src={sizedImage(img, 'detail')}
              alt={drop.product.name}
              fill
              sizes="(min-width: 768px) 400px, 100vw"
              unoptimized
              className="object-cover"
            />
            <div className="absolute top-4 left-4 bg-accent-500 text-ink-900 px-3 py-1 rounded-full text-sm font-bold">
              -{drop.discount_percent}%
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
