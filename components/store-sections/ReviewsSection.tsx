'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Star, StarHalf, User, BadgeCheck, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase/client';
import { sizedImage } from '@/lib/image-url';
import type { SectionContext, SectionReview } from './SectionContext';
import { RatingStars } from '@/components/ui/RatingStars';

/**
 * Media a stelle con mezza-stella: arrotonda al mezzo punto (es. 4,3 → 4,5) e
 * rende 5 icone — piene, una mezza, vuote. Parità token col mockup: accent-500.
 */
function AverageStars({ value }: { value: number }) {
  const rounded = Math.round(value * 2) / 2;
  const full = Math.floor(rounded);
  const hasHalf = rounded - full === 0.5;
  return (
    <span className="inline-flex items-center" aria-label={`${value.toFixed(1)} su 5 stelle`}>
      {Array.from({ length: 5 }, (_, i) => {
        if (i < full) return <Star key={i} size={16} className="fill-accent-500 text-accent-500" aria-hidden />;
        if (i === full && hasHalf) return <StarHalf key={i} size={16} className="fill-accent-500 text-accent-500" aria-hidden />;
        return <Star key={i} size={16} className="fill-cream-200 text-cream-200" aria-hidden />;
      })}
    </span>
  );
}

/**
 * Recensione singola arricchita con dati reali (store_reviews + profilo autore):
 * - nome autore reale (fallback "Cliente");
 * - pill "Acquisto verificato" quando `order_id` è valorizzato;
 * - miniature foto da `photo_urls` (text[]);
 * - risposta del negozio;
 * - azione "Utile" PERSISTENTE via `review_helpful` (insert/delete own-row): il
 *   conteggio `helpful_count` è mantenuto da un trigger DB. UX ottimistica: il
 *   bottone ribalta subito stato e conteggio, con rollback in caso di errore.
 *   L'utente non autenticato che vota riceve un invito ad accedere.
 */
function ReviewItem({ r, accent }: { r: SectionReview; accent: string }) {
  const author = r.author ?? null;
  const verified = r.order_id != null;
  const photos = Array.isArray(r.photo_urls) ? r.photo_urls : [];

  // Stato voto "Utile": parte dal conteggio reale; lo stato own-voted viene
  // risolto a runtime (review_helpful own-row) e poi mantenuto ottimisticamente.
  const [hasVoted, setHasVoted] = useState(false);
  const [count, setCount] = useState<number>(r.helpful_count ?? 0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setCount(r.helpful_count ?? 0);
  }, [r.helpful_count]);

  // Risolve se l'utente corrente ha già votato questa recensione (own-row).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !active) return;
      const { data } = await supabase
        .from('review_helpful')
        .select('review_id')
        .eq('review_id', r.id)
        .eq('user_id', user.id)
        .maybeSingle();
      if (active) setHasVoted(!!data);
    })();
    return () => { active = false; };
  }, [r.id]);

  const toggleHelpful = async () => {
    if (pending) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Accedi per segnalare una recensione utile');
      return;
    }
    // Ottimistico: ribalta subito stato + conteggio.
    const next = !hasVoted;
    setHasVoted(next);
    setCount((c) => Math.max(0, c + (next ? 1 : -1)));
    setPending(true);
    try {
      if (next) {
        const { error } = await supabase
          .from('review_helpful')
          .insert({ review_id: r.id, user_id: user.id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('review_helpful')
          .delete()
          .eq('review_id', r.id)
          .eq('user_id', user.id);
        if (error) throw error;
      }
    } catch {
      // Rollback in caso di errore.
      setHasVoted(!next);
      setCount((c) => Math.max(0, c + (next ? -1 : 1)));
      toast.error('Non è stato possibile registrare il voto');
    } finally {
      setPending(false);
    }
  };

  return (
    <li className="rounded-2xl border border-cream-300 bg-white p-4 shadow-warm-sm">
      <div className="mb-1.5 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-200 text-primary-700">
          <User size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong className="text-sm text-ink-900">{author ?? 'Cliente'}</strong>
            <RatingStars rating={r.rating} size={14} />
            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full bg-olive-50 px-2 py-0.5 text-[11px] font-bold text-olive-700">
                <BadgeCheck size={11} aria-hidden /> Acquisto verificato
              </span>
            )}
          </div>
          <span className="text-xs text-ink-400">{new Date(r.created_at).toLocaleDateString('it-IT')}</span>
        </div>
      </div>

      {r.comment && <p className="text-sm leading-relaxed text-ink-700">{r.comment}</p>}

      {photos.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {photos.slice(0, 4).map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block h-[72px] w-[72px] overflow-hidden rounded-lg bg-cream-100 transition-opacity hover:opacity-80"
            >
              <Image
                src={sizedImage(url, 'thumb')}
                alt="Foto recensione"
                width={72}
                height={72}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {r.seller_reply && (
        <div className="mt-2.5 ml-3 rounded-r-lg border-l-2 border-primary-200 bg-cream-50 py-1.5 pl-3 pr-2">
          <p className="text-xs font-semibold text-primary-700">Risposta del negozio</p>
          <p className="whitespace-pre-wrap text-sm text-ink-700">{r.seller_reply}</p>
        </div>
      )}

      <button
        type="button"
        onClick={toggleHelpful}
        aria-pressed={hasVoted}
        className={`mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
          hasVoted ? '' : 'border-cream-300 text-ink-500 hover:text-ink-800'
        }`}
        style={
          hasVoted
            ? { backgroundColor: `color-mix(in srgb, ${accent} 12%, white)`, color: accent, borderColor: accent }
            : undefined
        }
      >
        <ThumbsUp size={13} aria-hidden /> Utile{count > 0 ? ` · ${count}` : ''}
      </button>
    </li>
  );
}

/** Recensioni clienti (ultime), con titolo serif, media voti e item arricchiti. */
export default function ReviewsSection({ ctx }: { ctx: SectionContext }) {
  const { reviews, accent } = ctx;
  if (reviews.length === 0) return null;

  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-ink-900">
          <Star size={18} className="fill-accent-400 text-accent-500" aria-hidden />
          Recensioni clienti
        </h2>
        <div className="flex items-center gap-1.5">
          <AverageStars value={avgRating} />
          <span className="text-sm font-medium text-ink-600">
            {avgRating.toFixed(1).replace('.', ',')} ({reviews.length})
          </span>
        </div>
      </div>
      <ul className="space-y-3">
        {reviews.slice(0, 6).map((r) => (
          <ReviewItem key={r.id} r={r} accent={accent} />
        ))}
      </ul>
    </div>
  );
}
