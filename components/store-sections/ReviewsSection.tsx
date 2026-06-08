'use client';

import { Star } from 'lucide-react';
import type { SectionContext } from './SectionContext';

/** Recensioni clienti (ultime, con risposta del negozio). */
export default function ReviewsSection({ ctx }: { ctx: SectionContext }) {
  const { reviews } = ctx;
  if (reviews.length === 0) return null;

  const avgRating = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;

  return (
    <div className="bg-white border border-cream-300 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="font-semibold text-lg text-ink-900 flex items-center gap-2">
          <Star size={18} className="text-accent-500 fill-accent-400" aria-hidden />
          Recensioni clienti
        </h2>
        <div className="flex items-center gap-1">
          <span className="text-accent-400 text-lg">
            {'★'.repeat(Math.round(avgRating))}
            {'☆'.repeat(5 - Math.round(avgRating))}
          </span>
          <span className="text-sm text-ink-600 font-medium">
            {avgRating.toFixed(1)} ({reviews.length})
          </span>
        </div>
      </div>
      <ul className="space-y-3">
        {reviews.slice(0, 5).map((r) => (
          <li key={r.id} className="border-b border-cream-200 last:border-0 pb-3 last:pb-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-accent-400 text-sm">
                {'★'.repeat(r.rating)}
                {'☆'.repeat(5 - r.rating)}
              </span>
              <span className="text-xs text-ink-400">{new Date(r.created_at).toLocaleDateString('it-IT')}</span>
            </div>
            {r.comment && <p className="text-sm text-ink-700">{r.comment}</p>}
            {r.seller_reply && (
              <div className="mt-2 ml-3 pl-3 border-l-2 border-primary-200 bg-cream-50 rounded-r-lg py-1.5 pr-2">
                <p className="text-xs font-semibold text-primary-700">Risposta del negozio</p>
                <p className="text-sm text-ink-700 whitespace-pre-wrap">{r.seller_reply}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
