'use client';

import { cn } from '@/lib/cn';

/**
 * Card primitive — surface contenitore standard.
 *
 * Esperti consultati:
 * - Design System Lead: "Card varia per: bordered/elevated/flat. Padding
 *   3 size: sm/md/lg. Composition con Card.Header/Body/Footer in v2."
 */

type Variant = 'bordered' | 'elevated' | 'flat' | 'funnel';
type Padding = 'none' | 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  bordered: 'bg-white border border-cream-300',
  elevated: 'bg-white border border-cream-300 shadow-warm',
  flat:     'bg-cream-50',
  /**
   * 3/9/2026 — LA CARD DEL PERCORSO D'ACQUISTO, UNA SOLA.
   *
   * Nel checkout le tre card di sinistra erano `bordered` (bordo sabbia, angoli
   * da 12px, niente ombra) e il riepilogo di destra era scritto a mano
   * (`bg-white border border-surface-200 rounded-xl shadow-card`: bordo grigio,
   * 16px, con ombra). Le due colonne stanno nella stessa griglia e su computer
   * si vedono insieme: angoli diversi, bordi di due tinte, ombra su una sola,
   * nel punto in cui la persona decide se pagare. Adesso è una variante sola,
   * e chi la usa non riscrive più le classi a mano.
   */
  funnel:   'bg-white border border-surface-200 shadow-card',
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
        variant === 'funnel' ? 'rounded-xl' : 'rounded-lg',
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
