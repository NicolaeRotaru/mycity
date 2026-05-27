import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Empty state riusabile con CTA.
 *
 * Esperti consultati:
 * - Content Designer: "Empty state = opportunità di engagement. Mai 'vuoto.',
 *   sempre 'vuoto + cosa fare adesso'."
 * - Behavioral Scientist: "1 CTA chiara = +30% click vs 'vai e scopri tu'."
 * - Accessibility: "role='status' non serve, è informativo non live."
 */

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  variant?: 'default' | 'compact';
};

export default function EmptyState({
  icon: Icon,
  title,
  description,
  ctaLabel,
  ctaHref,
  secondaryLabel,
  secondaryHref,
  variant = 'default',
}: Props) {
  const isCompact = variant === 'compact';
  return (
    <div className={`text-center ${isCompact ? 'py-6' : 'py-12'} px-4`}>
      <div className={`mx-auto rounded-full bg-cream-100 flex items-center justify-center text-ink-400 mb-3 ${
        isCompact ? 'w-12 h-12' : 'w-16 h-16'
      }`}>
        <Icon size={isCompact ? 22 : 30} strokeWidth={1.7} />
      </div>
      <h3 className={`font-serif text-ink-900 font-bold ${isCompact ? 'text-base' : 'text-lg'}`}>{title}</h3>
      {description && (
        <p className={`text-ink-500 mt-1 max-w-md mx-auto ${isCompact ? 'text-xs' : 'text-sm'}`}>
          {description}
        </p>
      )}
      {(ctaLabel || secondaryLabel) && (
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {ctaLabel && ctaHref && (
            <Button href={ctaHref} size="sm" shape="pill">{ctaLabel}</Button>
          )}
          {secondaryLabel && secondaryHref && (
            <Link
              href={secondaryHref}
              className="inline-flex items-center gap-1.5 bg-white border border-cream-300 hover:bg-cream-50 text-ink-700 px-4 py-2 rounded-full font-semibold text-sm"
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
