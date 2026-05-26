import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Verified seller badge — appare quando profilo.is_approved = true.
 *
 * Esperti consultati:
 * - Trust & Safety: "Badge verified = trust signal #1 marketplace. Etsy +12%
 *   conversion sui sellers verified vs non. Stripe Connect best-practice."
 * - Content Designer: "Hover/tooltip spiega cosa significa 'verificato'.
 *   No solo icona muta."
 */

type Props = {
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
};

const SIZES = {
  sm: { icon: 12, text: 'text-xs' },
  md: { icon: 14, text: 'text-sm' },
  lg: { icon: 18, text: 'text-base' },
};

export function VerifiedBadge({ size = 'md', showLabel = false, className }: Props) {
  const s = SIZES[size];
  return (
    <span
      className={cn('inline-flex items-center gap-1 text-olive-700', s.text, className)}
      title="Negozio verificato da MyCity"
      aria-label="Negozio verificato"
    >
      <BadgeCheck size={s.icon} strokeWidth={2.4} className="fill-olive-100" aria-hidden />
      {showLabel && <span className="font-semibold">Verificato</span>}
    </span>
  );
}
