'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Card primitive — surface contenitore standard.
 *
 * Esperti consultati:
 * - Design System Lead: "Card varia per: bordered/elevated/flat. Padding
 *   3 size: sm/md/lg. Composition con Card.Header/Body/Footer in v2."
 */

type Variant = 'bordered' | 'elevated' | 'flat' | 'funnel' | 'surface' | 'quiet';
type Padding = 'none' | 'sm' | 'md' | 'lg';
/**
 * 12/11/2026 (R10-010) — IL RAGGIO PER CONTESTO, DETTO QUI.
 *
 * La primitiva aveva angoli da 12px (rounded-lg), cioe' il raggio MENO usato: le card scritte
 * a mano con lo stesso schema erano 71 da 20px e 56 da 16px, 14 da 12px. La regola adesso:
 * card di contenuto = 16px (xl, il valore di base), card prodotto/negozio = 20px (2xl),
 * riquadri dentro un'altra card = 12px (lg).
 */
type Radius = 'lg' | 'xl' | '2xl';
const RADIUS: Record<Radius, string> = { lg: 'rounded-lg', xl: 'rounded-xl', '2xl': 'rounded-2xl' };

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
  /** Card a mano con fondo `surface-0` e bordo sabbia (righe di elenco, riquadri dei cruscotti). */
  surface:  'bg-surface-0 border border-cream-300',
  /** Card a mano con bordo sabbia chiaro e ombra lieve (le più comuni dopo `bordered`). */
  quiet:    'bg-white border border-cream-200 shadow-warm-sm',
};

const PADDINGS: Record<Padding, string> = {
  none: '',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-6',
};

type Props = Omit<React.HTMLAttributes<HTMLElement>, 'className' | 'children'> & {
  variant?: Variant;
  padding?: Padding;
  className?: string;
  children: React.ReactNode;
  /** `details`: il riquadro che si apre e si chiude (es. «Articoli» nella consegna del fattorino). */
  as?: 'div' | 'article' | 'section' | 'aside' | 'details';
  /** Aggiunge sollevamento + ombra al passaggio del mouse (per card cliccabili). */
  hover?: boolean;
  /** R10-010 — 'xl' (contenuto, di base), '2xl' (prodotto/negozio), 'lg' (riquadro interno). */
  radius?: Radius;
  /** Con `href` la card è un link (`<a>` di Next): le card cliccabili non si scrivono più a mano. */
  href?: string;
  /** Solo con `href`: etichetta per chi legge con lo screen reader. */
  'aria-label'?: string;
};

export function Card({ variant = 'bordered', padding = 'md', className, children, as: Tag = 'div', hover = false, radius = 'xl', href, ...resto }: Props) {
  const classi = cn(
    RADIUS[radius],
    VARIANTS[variant],
    PADDINGS[padding],
    hover && 'transition-transform hover:-translate-y-[3px] hover:shadow-[var(--shadow-hover)]',
    className,
  );
  if (href) {
    return (
      <Link {...resto} href={href} className={cn('block', classi)}>
        {children}
      </Link>
    );
  }
  // R10-001 — il resto delle prop HTML (aria-label, aria-live, id, role…) arriva all'elemento.
  const Elemento = Tag as 'div';
  return <Elemento {...resto} className={classi}>{children}</Elemento>;
}
