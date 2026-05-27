'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Button primitive — variants + sizes + loading + icon.
 *
 * Esperti consultati:
 * - Design System Lead: "1 component, 4 variant, 3 size. Niente più. La complessità
 *   muore qui prima di propagarsi."
 * - Accessibility Specialist: "Touch target min 44px su `lg` e `md`. Loading state
 *   con aria-busy + Loader2 animato."
 * - Senior Code Reviewer: "forwardRef per integrazioni Radix/HeadlessUI future."
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';
type Shape = 'rounded' | 'pill';

const VARIANTS: Record<Variant, string> = {
  primary:   'bg-primary-700 hover:bg-primary-800 text-white shadow-warm-sm',
  secondary: 'bg-white border border-cream-300 hover:bg-cream-50 text-ink-900',
  ghost:     'text-primary-700 hover:bg-primary-50',
  danger:    'bg-rose-600 hover:bg-rose-700 text-white',
  success:   'bg-olive-600 hover:bg-olive-700 text-white',
};

const SIZES: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs gap-1 min-h-[32px]',
  md: 'px-4 py-2.5 text-sm gap-1.5 min-h-[44px]',
  lg: 'px-5 py-3 text-base gap-2 min-h-[48px]',
};

const BASE = 'inline-flex items-center justify-center font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

const SHAPES: Record<Shape, string> = {
  rounded: 'rounded-lg',
  pill: 'rounded-full',
};

type CommonProps = {
  variant?: Variant;
  size?: Size;
  shape?: Shape;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  fullWidth?: boolean;
};

type ButtonAsButton = CommonProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type ButtonAsLink   = CommonProps & {
  href: string;
  target?: string;
  rel?: string;
  children?: React.ReactNode;
  className?: string;
  onClick?: never;
  type?: never;
};

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', shape = 'rounded', loading = false, icon: Icon, iconRight: IconRight, fullWidth = false, className, children, ...rest },
  ref,
) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], SHAPES[shape], fullWidth && 'w-full', className);
  const iconSize = size === 'sm' ? 12 : size === 'lg' ? 18 : 14;
  const content = (
    <>
      {loading && <Loader2 size={iconSize} className="animate-spin" aria-hidden />}
      {!loading && Icon && <Icon size={iconSize} strokeWidth={2.4} aria-hidden />}
      {children}
      {!loading && IconRight && <IconRight size={iconSize} strokeWidth={2.4} aria-hidden />}
    </>
  );

  if ('href' in rest && rest.href) {
    const { href, target, rel } = rest;
    return (
      <Link href={href} target={target} rel={rel} className={classes}>
        {content}
      </Link>
    );
  }

  const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
  return (
    <button
      ref={ref}
      type={buttonProps.type ?? 'button'}
      aria-busy={loading || undefined}
      disabled={buttonProps.disabled || loading}
      className={classes}
      {...buttonProps}
    >
      {content}
    </button>
  );
});
