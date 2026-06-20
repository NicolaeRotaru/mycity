'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/**
 * Loading state riusabile — skeleton/spinner/inline.
 *
 * Esperti consultati:
 * - Interaction Designer: "Skeleton shimmer è già nel DS (`.skeleton` class).
 *   Usa quello per consistency."
 * - Accessibility: "role=status + aria-live polite per screen reader."
 */

type Variant = 'skeleton' | 'spinner' | 'inline' | 'cards';

type Props = {
  variant?: Variant;
  message?: string;
  /** Sottotitolo descrittivo (solo variant 'cards'). */
  description?: string;
  rows?: number;
  /** Numero di card-skeleton (solo variant 'cards'). */
  cards?: number;
  className?: string;
};

export function LoadingState({ variant = 'spinner', message, description, rows = 3, cards = 8, className }: Props) {
  const t = useTranslations('states');
  const msg = message ?? t('loading');
  if (variant === 'inline') {
    return (
      <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-2 text-sm text-ink-500', className)}>
        <Loader2 size={14} className="animate-spin" aria-hidden />
        {msg}
      </span>
    );
  }

  if (variant === 'spinner') {
    return (
      <div role="status" aria-live="polite" className={cn('py-12 text-center', className)}>
        <Loader2 size={32} className="animate-spin text-primary-700 mx-auto mb-2" strokeWidth={2.2} aria-hidden />
        <p className="text-sm text-ink-500">{msg}</p>
      </div>
    );
  }

  if (variant === 'cards') {
    // Stato di caricamento "branded" — spinner + serif + griglia card-skeleton
    // (trattamento states.html). Riusa la classe .skeleton/shimmer di globals.css.
    return (
      <div role="status" aria-busy="true" aria-live="polite" className={cn('text-center', className)}>
        <Loader2 size={40} className="animate-spin text-primary-700 mx-auto mb-5" strokeWidth={2.2} aria-hidden />
        <h2 className="font-serif text-2xl font-bold text-ink-900 mb-1.5">{msg}</h2>
        {description && <p className="text-base text-ink-600 mb-8">{description}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-left">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="bg-white border border-cream-300 rounded-2xl overflow-hidden" aria-hidden>
              <div className="skeleton aspect-square" />
              <div className="skeleton h-3 rounded m-2.5" />
              <div className="skeleton h-3 rounded m-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // skeleton
  return (
    <div role="status" aria-live="polite" aria-label={msg} className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton h-4 rounded"
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}
