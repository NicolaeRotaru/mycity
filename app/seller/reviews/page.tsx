'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, MessageCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/Button';
import SellerPageTitle from '@/components/seller/SellerPageTitle';
import { queryKeys } from '@/lib/queries/keys';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer: { full_name: string | null } | null;
  order_id: string | null;
  seller_reply: string | null;
  seller_reply_at: string | null;
};

const Stars = ({ rating }: { rating: number }) => (
  <span className="text-accent-500 tracking-tight">
    {'★'.repeat(Math.round(rating))}
    <span className="text-ink-300">{'★'.repeat(5 - Math.round(rating))}</span>
  </span>
);

export default function SellerReviewsPage() {
  const [filter, setFilter] = useState<'all' | 5 | 4 | 3 | 2 | 1>('all');

  const { data: reviews = [], isLoading } = useQuery<Review[]>({
    queryKey: queryKeys.seller.reviews,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non autenticato');
      const { data, error } = await supabase
        .from('store_reviews')
        .select(`
          id, rating, comment, created_at, order_id, seller_reply, seller_reply_at,
          reviewer:profiles!store_reviews_reviewer_id_fkey ( full_name )
        `)
        .eq('store_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      type StoreReviewRow = { id: string; rating: number; comment: string | null; created_at: string; order_id: string; seller_reply: string | null; seller_reply_at: string | null; reviewer: { full_name: string | null } | null };
      return (data ?? []) as unknown as StoreReviewRow[];
    },
  });

  const stats = useMemo(() => {
    if (reviews.length === 0) {
      return { avg: 0, count: 0, distribution: [0, 0, 0, 0, 0] };
    }
    const distribution = [0, 0, 0, 0, 0]; // index 0 = 5★, 1 = 4★, ...
    let sum = 0;
    for (const r of reviews) {
      sum += r.rating;
      const idx = Math.min(5, Math.max(1, Math.round(r.rating))) - 1;
      distribution[4 - idx] += 1;
    }
    return {
      avg: sum / reviews.length,
      count: reviews.length,
      distribution,
    };
  }, [reviews]);

  const filtered = filter === 'all'
    ? reviews
    : reviews.filter((r) => Math.round(r.rating) === filter);

  return (
    <div className="space-y-6">
      <SellerPageTitle eyebrow="Reputazione" title="Recensioni" sub="Cosa pensano i clienti del tuo negozio" className="mb-0" />

      {isLoading ? (
        <LoadingState />
      ) : reviews.length === 0 ? (
        <div className="bg-white border border-cream-300 rounded-xl p-12 text-center">
          <FileText size={48} className="mx-auto mb-3 text-ink-300" aria-hidden />
          <p className="font-semibold text-ink-700">Nessuna recensione ancora</p>
          <p className="text-sm text-ink-500 mt-1">
            Quando i clienti riceveranno l'ordine potranno lasciarti una recensione.
          </p>
        </div>
      ) : (
        <>
          {/* Riepilogo + distribuzione */}
          <section className="bg-white border border-cream-300 rounded-xl p-6 grid md:grid-cols-[200px_1fr] gap-6">
            <div className="text-center">
              <div className="text-6xl font-extrabold font-serif text-ink-900">{stats.avg.toFixed(1)}</div>
              <Stars rating={stats.avg} />
              <p className="text-sm text-ink-500 mt-1">{stats.count} recensioni</p>
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
                    className={`w-full flex items-center gap-3 px-2 py-1 rounded hover:bg-cream-50 transition-colors ${
                      filter === star ? 'bg-accent-50' : ''
                    }`}
                  >
                    <span className="text-xs font-semibold w-10 text-right">{star}★</span>
                    <div className="flex-1 bg-cream-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-accent-400 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-ink-500 w-10">{count}</span>
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

          {/* Lista recensioni */}
          <div className="space-y-3">
            {filtered.map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const [showReply, setShowReply] = useState(false);
  const [reply, setReply] = useState(review.seller_reply ?? '');
  const [savedReply, setSavedReply] = useState<string | null>(review.seller_reply);
  const [sending, setSending] = useState(false);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch(`/api/seller/reviews/${review.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: text }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error?.message ?? 'Errore durante il salvataggio');
      setSavedReply(text);
      setShowReply(false);
      toast.success('Risposta pubblicata');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Impossibile pubblicare la risposta');
    } finally {
      setSending(false);
    }
  };

  const initial = review.reviewer?.full_name?.[0]?.toUpperCase() ?? '?';

  return (
    <article className="bg-white border border-cream-300 rounded-xl p-5">
      <header className="flex items-start gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-800 font-bold flex items-center justify-center shrink-0">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="font-semibold text-ink-900">{review.reviewer?.full_name ?? 'Cliente'}</p>
            <span className="text-xs text-ink-400">{formatDate(review.created_at)}</span>
          </div>
          <Stars rating={review.rating} />
        </div>
      </header>

      {review.comment && (
        <p className="text-sm text-ink-700 leading-relaxed mt-2">{review.comment}</p>
      )}

      {savedReply && !showReply && (
        <div className="mt-3 ml-3 pl-3 border-l-2 border-primary-200 bg-cream-50 rounded-r-lg py-2 pr-2">
          <p className="text-xs font-semibold text-primary-700 mb-0.5">La tua risposta</p>
          <p className="text-sm text-ink-700 whitespace-pre-wrap">{savedReply}</p>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-cream-200 flex items-center justify-between gap-2">
        {!showReply ? (
          <button
            type="button"
            onClick={() => { setReply(savedReply ?? ''); setShowReply(true); }}
            className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:underline font-semibold"
          >
            <MessageCircle size={16} aria-hidden /> {savedReply ? 'Modifica risposta' : 'Rispondi'}
          </button>
        ) : null}
        {review.order_id && (
          <span className="text-xs text-ink-400 font-mono">Ordine #{review.order_id.slice(0, 6).toUpperCase()}</span>
        )}
      </div>

      {showReply && (
        <div className="mt-3">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Ringrazia il cliente o spiega cosa farete di diverso…"
            className="w-full border border-cream-300 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => { setShowReply(false); setReply(savedReply ?? ''); }}
              className="px-3 py-1.5 rounded text-sm text-ink-600 hover:bg-cream-100"
            >
              Annulla
            </button>
            <Button
              type="button"
              onClick={sendReply}
              loading={sending}
              disabled={!reply.trim()}
              size="sm"
            >Pubblica risposta</Button>
          </div>
        </div>
      )}
    </article>
  );
}
