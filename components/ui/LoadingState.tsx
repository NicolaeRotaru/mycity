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

type Variant = 'skeleton' | 'spinner' | 'inline';

type Props = {
  variant?: Variant;
  message?: string;
  rows?: number;
  className?: string;
};

export function LoadingState({ variant = 'spinner', message, rows = 3, className }: Props) {
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
