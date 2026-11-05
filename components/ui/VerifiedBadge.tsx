import { BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Verified seller badge — solo se `isVerifiedStore(profile)` è true
 * (approvato + Stripe charges + payouts attivi).
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
    >
      <BadgeCheck size={s.icon} strokeWidth={2.4} className="fill-olive-100" aria-hidden />
      {/* S10 (5/11/2026) — Un aria-label su uno <span> senza ruolo i lettori di
          schermo non lo leggono: il bollino era muto. Il nome adesso è testo. */}
      {showLabel ? (
        <span className="font-semibold">
          Verificato<span className="sr-only"> da MyCity</span>
        </span>
      ) : (
        <span className="sr-only">Negozio verificato</span>
      )}
    </span>
  );
}
