'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase/client';
import { formatDate } from '@/lib/format';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { full_name: string | null } | null;
};

const Stars = ({ rating }: { rating: number }) => (
  <span className="text-accent-500 tracking-tight">
    {'★'.repeat(Math.round(rating))}
    <span className="text-ink-300">{'★'.repeat(5 - Math.round(rating))}</span>
  </span>
);

export default function RiderReviewsPage() {
  const [filter, setFilter] = useState<'all' | 5 | 4 | 3 | 2 | 1>('all');

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: ['rider-reviews'],
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
      return (data ?? []) as any;
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold text-ink-900">⭐ Le tue recensioni</h1>
        <p className="text-sm text-ink-500">Cosa pensano i clienti delle tue consegne</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-ink-400">Caricamento…</div>
      ) : reviews.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center">
          <div className="text-5xl mb-3">🛵</div>
          <p className="font-semibold text-ink-700">Nessuna recensione ancora</p>
          <p className="text-sm text-ink-500 mt-1">
            Dopo ogni consegna il cliente può lasciarti una valutazione. Più consegni, più feedback ricevi.
          </p>
        </div>
      ) : (
        <>
          <section className="bg-gradient-to-br from-accent-50 to-orange-50 border border-accent-200 rounded-xl p-6 grid md:grid-cols-[200px_1fr] gap-6">
            <div className="text-center">
              <div className="text-6xl font-extrabold text-accent-900">{stats.avg.toFixed(1)}</div>
              <Stars rating={stats.avg} />
              <p className="text-sm text-accent-800 mt-1">{stats.count} recensioni</p>
              {stats.avg >= 4.5 && (
                <span className="inline-block mt-2 bg-accent-500 text-white text-xs font-bold px-3 py-1 rounded-full">
                  🏆 Top rider
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {stats.distribution.map((count, i) => {
                const star = 5 - i;
                const pct = stats.count > 0 ? (count / stats.count) * 100 : 0;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setFilter(filter === star ? 'all' : (star as 5 | 4 | 3 | 2 | 1))}
                    className={`w-full flex items-center gap-3 px-2 py-1 rounded hover:bg-white/50 transition-colors ${
                      filter === star ? 'bg-white/70' : ''
                    }`}
                  >
                    <span className="text-xs font-semibold w-10 text-right">{star}★</span>
                    <div className="flex-1 bg-white/40 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-accent-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-accent-900 w-10">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {filter !== 'all' && (
            <div className="flex items-center justify-between bg-accent-50 border border-accent-200 rounded-lg px-4 py-2 text-sm">
              <span>Filtro: solo recensioni a {filter} stelle</span>
              <button onClick={() => setFilter('all')} className="text-accent-700 font-semibold hover:underline">
                Mostra tutte
              </button>
            </div>
          )}

          <div className="space-y-3">
            {filtered.map((r) => {
              const initial = r.reviewer?.full_name?.[0]?.toUpperCase() ?? '?';
              return (
                <article key={r.id} className="bg-white border rounded-xl p-5">
                  <header className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-accent-100 text-accent-700 font-bold flex items-center justify-center shrink-0">
                      {initial}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="font-semibold text-ink-900">{r.reviewer?.full_name ?? 'Cliente'}</p>
                        <span className="text-xs text-ink-400">{formatDate(r.created_at)}</span>
                      </div>
                      <Stars rating={r.rating} />
                    </div>
                  </header>
                  {r.comment && (
                    <p className="text-sm text-ink-700 leading-relaxed mt-2 pl-13">{r.comment}</p>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}

      <div className="bg-primary-50 border border-primary-200 rounded-xl p-5 text-sm text-primary-900">
        <h3 className="font-bold mb-2">💡 Come migliorare il rating</h3>
        <ul className="space-y-1">
          <li>• Saluta sempre con un sorriso e mostra il volto</li>
          <li>• Avvisa via app quando sei a 2 minuti dalla consegna</li>
          <li>• Maneggia con cura prodotti fragili o caldi</li>
          <li>• Sii puntuale: niente fa più piacere di una consegna in orario</li>
        </ul>
      </div>
    </div>
  );
}
