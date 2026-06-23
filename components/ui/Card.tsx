'use client';

import { cn } from '@/lib/cn';

/**
 * Card primitive — surface contenitore standard.
 *
 * Esperti consultati:
 * - Design System Lead: "Card varia per: bordered/elevated/flat. Padding
 *   3 size: sm/md/lg. Composition con Card.Header/Body/Footer in v2."
 */

type Variant = 'bordered' | 'elevated' | 'flat';
type Padding = 'none' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  bordered: 'bg-white border border-cream-300',
  elevated: 'bg-white border border-cream-300 shadow-warm',
  flat:     'bg-cream-50',
};

const PADDINGS: Record<Padding, string> = {
  none: '',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-6',
};

type Props = {
  variant?: Variant;
  padding?: Padding;
  className?: string;
  children: React.ReactNode;
  as?: 'div' | 'article' | 'section' | 'aside';
  /** Aggiunge sollevamento + ombra al passaggio del mouse (per card cliccabili). */
  hover?: boolean;
};

export function Card({ variant = 'bordered', padding = 'md', className, children, as: Tag = 'div', hover = false }: Props) {
  return (
    <Tag
      className={cn(
        'rounded-lg',
        VARIANTS[variant],
        PADDINGS[padding],
        hover && 'transition-transform hover:-translate-y-[3px] hover:shadow-[var(--shadow-hover)]',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
