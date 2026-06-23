import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Badge primitive — un'unica fonte di verità per le ~6 pillole inline
 * duplicate in ProductCard / pagina prodotto / checkout.
 *
 * Corregge anche il colore sconto fuori-brand (rose Tailwind) → secondary
 * (vino), coerente col design system "Mediterranean Modern".
 */

export type BadgeVariant =
  | 'discount'   // -X% sconto
  | 'new'        // prodotto nuovo
  | 'soldout'    // esaurito
  | 'lowstock'   // ultimi N — pill piena ad alta visibilità (con pulse)
  | 'lowstocksoft' // ultimi N — pill soft inline (es. ProductCard)
  | 'free'       // spedizione gratis
  | 'cod'        // paga alla consegna / zero rischio
  | 'local'      // venditore locale
  | 'urgency';   // urgenza / countdown

type BadgeSize = 'sm' | 'md';

const VARIANTS: Record<BadgeVariant, string> = {
  discount:     'bg-secondary-600 text-white uppercase tracking-wide',
  new:          'bg-olive-600 text-white uppercase tracking-wide',
  soldout:      'bg-ink-700 text-white uppercase tracking-wide',
  lowstock:     'bg-secondary-500 text-white uppercase tracking-wide',
  lowstocksoft: 'bg-secondary-50 text-secondary-700',
  free:         'bg-olive-50 text-olive-700',
  cod:          'bg-olive-50 text-olive-700',
  local:        'bg-primary-50 text-primary-700',
  urgency:      'bg-accent-500 text-ink-900',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'text-[10px] px-1.5 py-0.5 gap-0.5',
  md: 'text-xs px-2 py-1 gap-1',
};

export function Badge({
  variant,
  size = 'sm',
  icon: Icon,
  className,
  children,
}: {
  variant: BadgeVariant;
  size?: BadgeSize;
  icon?: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold rounded',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {Icon && <Icon size={size === 'sm' ? 11 : 13} strokeWidth={2.4} aria-hidden />}
      {children}
    </span>
  );
}
