'use client';

import {
  ORDER_STATUS_ICON,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_COLOR,
  type OrderStatus,
} from '@/lib/order-status';
import { cn } from '@/lib/cn';

/**
 * Badge stato ordine — icona Lucide + label + colore semantico.
 *
 * Esperti consultati:
 * - Design System Lead: "Pattern ripetuto in 8 file → 1 component. Cambi colore
 *   stato? 1 fix invece di 8."
 * - Accessibility: "Icona ha aria-hidden, label è il testo accessibile."
 */

type Size = 'sm' | 'md';
type Variant = 'pill' | 'inline' | 'icon-only';

type Props = {
  status: OrderStatus;
  size?: Size;
  variant?: Variant;
  className?: string;
};

const SIZES_PILL: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-3 py-1.5 text-sm gap-1.5',
};

export function OrderStatusBadge({ status, size = 'md', variant = 'pill', className }: Props) {
  const Icon = ORDER_STATUS_ICON[status];
  const label = ORDER_STATUS_LABEL[status];
  const c = ORDER_STATUS_COLOR[status];
  const iconSize = size === 'sm' ? 12 : 14;

  if (variant === 'icon-only') {
    return (
      <Icon
        size={iconSize}
        strokeWidth={2.2}
        className={cn(c.text, className)}
        aria-label={label}
      />
    );
  }

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5', c.text, className)}>
        <Icon size={iconSize} strokeWidth={2.2} aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium ring-1',
        SIZES_PILL[size],
        c.bg, c.text, c.ring,
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  );
}
