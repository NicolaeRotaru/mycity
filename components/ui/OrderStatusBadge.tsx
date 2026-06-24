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
        className={className}
        style={{ color: c.color }}
        role="img"
        aria-label={label}
      />
    );
  }

  if (variant === 'inline') {
    return (
      <span className={cn('inline-flex items-center gap-1.5', className)} style={{ color: c.color }}>
        <Icon size={iconSize} strokeWidth={2.2} aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        SIZES_PILL[size],
        className,
      )}
      // Colore semantico via token --status-*: testo + icona (color) e anello
      // (inset box-shadow su currentColor), tinta di sfondo (bg). Nessuna
      // classe off-palette: i colori vivono nei token del design system.
      style={{ color: c.color, background: c.bg, boxShadow: 'inset 0 0 0 1px currentColor' }}
    >
      <Icon size={iconSize} strokeWidth={2.4} aria-hidden />
      {label}
    </span>
  );
}
