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

type Tone = 'primary' | 'olive' | 'accent' | 'secondary';

type Props = {
  icon: LucideIcon;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
  variant?: 'default' | 'compact';
  tone?: Tone;
};

const TONES: Record<Tone, string> = {
  primary:   'bg-primary-50 text-primary-700',
  olive:     'bg-olive-50 text-olive-700',
  accent:    'bg-accent-50 text-accent-600',
  secondary: 'bg-secondary-50 text-secondary-700',
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
  tone = 'primary',
}: Props) {
  const isCompact = variant === 'compact';
  return (
    <div className={`text-center ${isCompact ? 'py-6' : 'py-12'} px-4`}>
      <div className={`mx-auto rounded-full flex items-center justify-center mb-3 ${TONES[tone]} ${
        isCompact ? 'w-12 h-12' : 'w-16 h-16'
      }`}>
        <Icon size={isCompact ? 22 : 28} strokeWidth={2} />
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
