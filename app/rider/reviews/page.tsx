'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, Bike, Trophy, Lightbulb } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatDate } from '@/lib/format';
import { LoadingState } from '@/components/ui/LoadingState';
import { queryKeys } from '@/lib/queries/keys';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { full_name: string | null } | null;
};

const Stars = ({ rating, size = 14 }: { rating: number; size?: number }) => {
  const full = Math.round(rating);
  return (
    <span className="inline-flex" aria-label={`${rating.toFixed(1)} su 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= full ? 'text-accent-500' : 'text-ink-300'}
          fill={i <= full ? 'currentColor' : 'none'}
          aria-hidden
        />
      ))}
    </span>
  );
};

export default function RiderReviewsPage() {
  const [filter, setFilter] = useState<'all' | 5 | 4 | 3 | 2 | 1>('all');

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: queryKeys.rider.reviews,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('rider_reviews')
        .select(`
          id, rating, comment, created_at,
          reviewer:profiles!rider_reviews_reviewer_id_fkey ( full_name )
        `)
        .eq('rider_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      type RiderReviewRow = { id: string; rating: number; comment: string | null; created_at: string; reviewer: { full_name: string | null } | null };
      return (data ?? []) as unknown as RiderReviewRow[];
    },
  });

  const stats = useMemo(() => {
    if (reviews.length === 0) return { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] };
    const distribution = [0, 0, 0, 0, 0];
    let sum = 0;
    for (const r of reviews) {
      sum += r.rating;
      const idx = Math.min(5, Math.max(1, Math.round(r.rating))) - 1;
      distribution[4 - idx] += 1;
    }
    return { avg: sum / reviews.length, count: reviews.length, distribution };
  }, [reviews]);

  const filtered = filter === 'all'
    ? reviews
    : reviews.filter((r) => Math.round(r.rating) === filter);

  return (
    <div className="pb-5">
      {/* Header con back */}
      <div className="px-5 pb-2 pt-4">
        <h1 className="font-serif text-[26px] font-extrabold text-ink-900">Le mie recensioni</h1>
        <p className="mt-0.5 text-[13px] text-ink-500">Cosa pensano i clienti delle tue consegne</p>
      </div>

      <div className="px-4">
        {isLoading ? (
          <LoadingState />
        ) : reviews.length === 0 ? (
          <div className="rounded-xl border border-cream-300 bg-surface-0 p-10 text-center">
            <Bike size={44} strokeWidth={1.5} className="mx-auto mb-3 text-ink-300" aria-hidden />
            <p className="font-semibold text-ink-700">Nessuna recensione ancora</p>
            <p className="mt-1 text-sm text-ink-500">
              Dopo ogni consegna il cliente può lasciarti una valutazione. Più consegni, più feedback ricevi.
            </p>
          </div>
        ) : (
          <>
            {/* Media serif + distribuzione */}
            <div className="mb-3.5 rounded-xl border border-accent-200 bg-accent-100 p-4">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="font-serif text-[34px] font-extrabold leading-none text-ink-900">{stats.avg.toFixed(1).replace('.', ',')}</p>
                  <div className="mt-1"><Stars rating={stats.avg} size={14} /></div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink-900">{stats.avg >= 4.5 ? 'Ottimo lavoro!' : 'Continua così'}</p>
                  <p className="mt-0.5 text-[13px] text-ink-600">Su {stats.count} {stats.count === 1 ? 'recensione' : 'recensioni'}.</p>
                  {stats.avg >= 4.5 && (
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-3 py-1 text-xs font-bold text-ink-900">
                      <Trophy size={14} strokeWidth={2.2} aria-hidden /> Top rider
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {stats.distribution.map((count, i) => {
                  const star = 5 - i;
                  const pct = stats.count > 0 ? (count / stats.count) * 100 : 0;
                  return (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setFilter(filter === star ? 'all' : (star as 5 | 4 | 3 | 2 | 1))}
                      className={`flex w-full items-center gap-3 rounded px-1.5 py-1 transition-colors hover:bg-white/50 ${filter === star ? 'bg-white/70' : ''}`}
                    >
                      <span className="w-8 text-right text-xs font-semibold">{star}★</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/40">
                        <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-7 text-xs text-ink-700">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {filter !== 'all' && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-accent-200 bg-accent-50 px-3.5 py-2 text-sm">
                <span>Filtro: {filter}★</span>
                <button onClick={() => setFilter('all')} className="font-semibold text-accent-700 hover:underline">Mostra tutte</button>
              </div>
            )}

            {/* Lista recensioni */}
            <div className="flex flex-col gap-2.5">
              {filtered.map((r) => (
                <article key={r.id} className="rounded-lg border border-cream-300 bg-surface-0 px-3.5 py-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <strong className="text-[13px] text-ink-900">{r.reviewer?.full_name ?? 'Cliente'}</strong>
                    <Stars rating={r.rating} size={12} />
                  </div>
                  {r.comment && <p className="text-[13px] leading-relaxed text-ink-600">{r.comment}</p>}
                  <p className="mt-1 text-[11px] text-ink-400">{formatDate(r.created_at)}</p>
                </article>
              ))}
            </div>
          </>
        )}

        {/* Tips */}
        <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900">
          <h3 className="mb-2 flex items-center gap-1.5 font-bold">
            <Lightbulb size={16} strokeWidth={2.2} aria-hidden /> Come migliorare il rating
          </h3>
          <ul className="space-y-1 text-[13px]">
            <li>• Saluta sempre con un sorriso e mostra il volto</li>
            <li>• Avvisa via app quando sei a 2 minuti dalla consegna</li>
            <li>• Maneggia con cura prodotti fragili o caldi</li>
            <li>• Sii puntuale: niente fa più piacere di una consegna in orario</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
